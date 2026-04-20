import { Queue } from 'bullmq';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../database/index.js';
import {
  workflowExecutions,
  stepExecutions,
  workflowSteps,
  workflows,
  agents,
  agentVariables,
  userVariables,
  workspaceVariables,
  agentQuotaUsage,
  mcpServerConfigs,
  creditUsage,
  models,
} from '../database/schema.js';
import { createLogger } from '@oao/shared';
import { decrypt } from '@oao/shared';
import { getRedisConnection } from './redis.js';
import { CopilotClient, approveAll } from '@github/copilot-sdk';
import { prepareAgentWorkspace, prepareDbAgentWorkspace } from './agent-workspace.js';
import { createAgentTools } from './agent-tools.js';
import { connectToMcpServer } from './mcp-client.js';
import { renderTemplate, buildTemplateContext } from './jinja-renderer.js';

import { createAgentPod, waitForPodCompletion, deleteAgentPod } from './k8s-provisioner.js';
import { registerEphemeralInstance, terminateEphemeralInstance } from './agent-instance-registry.js';
import { AGENT_STEP_QUEUE } from '../workers/agent-worker.js';
import { publishRealtimeEvent } from './realtime-bus.js';

const logger = createLogger('workflow-engine');

// ─── Redis Distributed Session Lock ──────────────────────────────────

const SESSION_LOCK_PREFIX = 'agent-session-lock:';
const SESSION_LOCK_TTL_SECONDS = 600; // 10 minutes
const SESSION_LOCK_WAIT_SECONDS = parseInt(process.env.AGENT_SESSION_LOCK_WAIT_SECONDS || '60', 10);
const SESSION_LOCK_POLL_MS = 1000;
const STEP_COMPLETION_GRACE_SECONDS = parseInt(process.env.STEP_COMPLETION_GRACE_SECONDS || '30', 10);
const DEFAULT_STEP_ALLOCATION_TIMEOUT_SECONDS = parseInt(process.env.DEFAULT_STEP_ALLOCATION_TIMEOUT_SECONDS || '300', 10);
const STEP_STATUS_POLL_MS = 3000;

interface SessionLockInfo {
  agentId: string;
  agentName: string;
  executionId: string;
  stepExecutionId?: string;
  workflowId: string;
  workerRuntime: 'static' | 'ephemeral';
  stepName: string;
  acquiredAt: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSessionLockValue(info: SessionLockInfo): string {
  return JSON.stringify(info);
}

function parseSessionLockInfo(value: string | null): SessionLockInfo | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as SessionLockInfo;
  } catch {
    return null;
  }
}

async function getSessionLockInfo(agentId: string): Promise<SessionLockInfo | null> {
  const redis = getRedisConnection();
  const key = `${SESSION_LOCK_PREFIX}${agentId}`;
  const current = await redis.get(key);
  return parseSessionLockInfo(current);
}

function getStepExecutionBudgetSeconds(timeoutSeconds: number | null): number {
  return (timeoutSeconds ?? 600) + SESSION_LOCK_WAIT_SECONDS + STEP_COMPLETION_GRACE_SECONDS;
}

function parseWorkerRuntime(value: unknown): 'static' | 'ephemeral' | null {
  return value === 'static' || value === 'ephemeral' ? value : null;
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function getWorkflowSnapshotConfig(execution: typeof workflowExecutions.$inferSelect): Record<string, unknown> | null {
  const snapshot = execution.workflowSnapshot as Record<string, unknown> | null;
  const workflowConfig = snapshot?.workflow;
  return workflowConfig && typeof workflowConfig === 'object'
    ? workflowConfig as Record<string, unknown>
    : null;
}

function getStepSnapshotConfig(
  execution: typeof workflowExecutions.$inferSelect,
  step: typeof workflowSteps.$inferSelect,
): Record<string, unknown> | null {
  const snapshot = execution.workflowSnapshot as Record<string, unknown> | null;
  const steps = snapshot?.steps;
  if (!Array.isArray(steps)) return null;

  const match = steps.find((candidate) => {
    if (!candidate || typeof candidate !== 'object') return false;
    const snapshotStep = candidate as Record<string, unknown>;
    return snapshotStep.id === step.id || snapshotStep.stepOrder === step.stepOrder;
  });

  return match && typeof match === 'object' ? match as Record<string, unknown> : null;
}

function resolveStepWorkerRuntime(
  execution: typeof workflowExecutions.$inferSelect,
  workflow: typeof workflows.$inferSelect,
  step: typeof workflowSteps.$inferSelect,
): 'static' | 'ephemeral' {
  const workflowSnapshot = getWorkflowSnapshotConfig(execution);
  const stepSnapshot = getStepSnapshotConfig(execution, step);

  return (
    parseWorkerRuntime(stepSnapshot?.workerRuntime)
    ?? parseWorkerRuntime(workflowSnapshot?.workerRuntime)
    ?? parseWorkerRuntime(step.workerRuntime)
    ?? parseWorkerRuntime(workflow.workerRuntime)
    ?? 'static'
  );
}

function resolveStepAllocationTimeoutSeconds(
  execution: typeof workflowExecutions.$inferSelect,
  workflow: typeof workflows.$inferSelect,
): number {
  const workflowSnapshot = getWorkflowSnapshotConfig(execution);

  return (
    parsePositiveInt(workflowSnapshot?.stepAllocationTimeoutSeconds)
    ?? workflow.stepAllocationTimeoutSeconds
    ?? DEFAULT_STEP_ALLOCATION_TIMEOUT_SECONDS
  );
}

interface ResolvedScopedCredential {
  key: string;
  valueEncrypted: string;
  credentialSubType: string | null;
  scope: 'agent' | 'user' | 'workspace';
}

async function resolveScopedCredentialById(params: {
  credentialId: string;
  agentId: string;
  userId: string;
  workspaceId?: string | null;
}): Promise<ResolvedScopedCredential | null> {
  const agentCredential = await db.query.agentVariables.findFirst({
    where: and(eq(agentVariables.id, params.credentialId), eq(agentVariables.agentId, params.agentId)),
  });
  if (agentCredential) {
    return {
      key: agentCredential.key,
      valueEncrypted: agentCredential.valueEncrypted,
      credentialSubType: agentCredential.credentialSubType,
      scope: 'agent',
    };
  }

  const userCredential = await db.query.userVariables.findFirst({
    where: and(eq(userVariables.id, params.credentialId), eq(userVariables.userId, params.userId)),
  });
  if (userCredential) {
    return {
      key: userCredential.key,
      valueEncrypted: userCredential.valueEncrypted,
      credentialSubType: userCredential.credentialSubType,
      scope: 'user',
    };
  }

  if (params.workspaceId) {
    const workspaceCredential = await db.query.workspaceVariables.findFirst({
      where: and(eq(workspaceVariables.id, params.credentialId), eq(workspaceVariables.workspaceId, params.workspaceId)),
    });
    if (workspaceCredential) {
      return {
        key: workspaceCredential.key,
        valueEncrypted: workspaceCredential.valueEncrypted,
        credentialSubType: workspaceCredential.credentialSubType,
        scope: 'workspace',
      };
    }
  }

  return null;
}

function ensureSupportedCopilotCredentialSubType(credential: ResolvedScopedCredential): void {
  const credentialSubType = credential.credentialSubType || 'secret_text';
  if (credentialSubType !== 'secret_text' && credentialSubType !== 'github_token') {
    throw new Error(
      `Copilot authentication does not support credential subtype "${credentialSubType}" for variable ${credential.key}. Use a GitHub Token or Secret Text credential instead.`,
    );
  }
}

async function getStepExecutionRecord(stepExecutionId: string) {
  return db.query.stepExecutions.findFirst({
    where: eq(stepExecutions.id, stepExecutionId),
  });
}

async function waitForStepAllocation(
  stepExecutionId: string,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<typeof stepExecutions.$inferSelect> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const updated = await getStepExecutionRecord(stepExecutionId);
    if (!updated) throw new Error(`Step execution ${stepExecutionId} not found`);

    if (updated.status === 'running' || updated.status === 'completed' || updated.status === 'failed') {
      return updated;
    }

    await sleep(STEP_STATUS_POLL_MS);
  }

  throw new Error(timeoutMessage);
}

async function waitForStepCompletion(
  stepExecutionId: string,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<typeof stepExecutions.$inferSelect> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const updated = await getStepExecutionRecord(stepExecutionId);
    if (!updated) throw new Error(`Step execution ${stepExecutionId} not found`);

    if (updated.status === 'completed' || updated.status === 'failed') {
      return updated;
    }

    await sleep(STEP_STATUS_POLL_MS);
  }

  throw new Error(timeoutMessage);
}

/**
 * Acquire a Redis distributed lock to prevent concurrent Copilot sessions
 * for the same agent. Uses SET NX with TTL for automatic expiry.
 * Returns a unique lock value for owner-aware release.
 */
async function acquireSessionLock(agentId: string, info: SessionLockInfo): Promise<string | null> {
  const redis = getRedisConnection();
  const key = `${SESSION_LOCK_PREFIX}${agentId}`;
  const lockValue = buildSessionLockValue(info);
  const result = await redis.set(key, lockValue, 'EX', SESSION_LOCK_TTL_SECONDS, 'NX');
  return result === 'OK' ? lockValue : null;
}

/**
 * Release the session lock for an agent, but only if we own it (compare-and-delete).
 * Prevents releasing a lock acquired by another process after TTL expiry.
 */
async function releaseSessionLock(agentId: string, lockValue: string): Promise<void> {
  const redis = getRedisConnection();
  const key = `${SESSION_LOCK_PREFIX}${agentId}`;
  // Lua script for atomic compare-and-delete
  const script = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
  await redis.eval(script, 1, key, lockValue);
}

/**
 * Extend the session lock TTL (call periodically during long sessions).
 */
async function extendSessionLock(agentId: string): Promise<void> {
  const redis = getRedisConnection();
  const key = `${SESSION_LOCK_PREFIX}${agentId}`;
  await redis.expire(key, SESSION_LOCK_TTL_SECONDS);
}

async function acquireSessionLockWithWait(agentId: string, info: SessionLockInfo): Promise<{ lockValue: string | null; blockingSession: SessionLockInfo | null }> {
  const waitDeadline = Date.now() + SESSION_LOCK_WAIT_SECONDS * 1000;
  let blockingSession: SessionLockInfo | null = null;

  while (Date.now() <= waitDeadline) {
    const lockValue = await acquireSessionLock(agentId, info);
    if (lockValue) return { lockValue, blockingSession: null };

    blockingSession = await getSessionLockInfo(agentId);
    if (Date.now() + SESSION_LOCK_POLL_MS > waitDeadline) break;
    await sleep(SESSION_LOCK_POLL_MS);
  }

  return { lockValue: null, blockingSession };
}

let workflowQueue: Queue | null = null;
let stepQueue: Queue | null = null;

function getQueue(): Queue {
  if (!workflowQueue) {
    workflowQueue = new Queue('workflow-execution', {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 200,
        attempts: 1,
      },
    });
  }
  return workflowQueue;
}

function getStepQueue(): Queue {
  if (!stepQueue) {
    stepQueue = new Queue(AGENT_STEP_QUEUE, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 200,
        attempts: 1,
      },
    });
  }
  return stepQueue;
}

/** Create an execution record and enqueue a BullMQ job. */
export async function enqueueWorkflowExecution(
  workflowId: string,
  triggerId: string | null,
  triggerMetadata: Record<string, unknown>,
) {
  const workflow = await db.query.workflows.findFirst({
    where: eq(workflows.id, workflowId),
  });
  if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

  const steps = await db.query.workflowSteps.findMany({
    where: eq(workflowSteps.workflowId, workflowId),
    orderBy: workflowSteps.stepOrder,
  });

  // Snapshot the workflow + steps at current version
  const workflowSnapshot = {
    workflow: {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      userId: workflow.userId,
      defaultAgentId: workflow.defaultAgentId,
      defaultModel: workflow.defaultModel,
      defaultReasoningEffort: workflow.defaultReasoningEffort,
      workerRuntime: workflow.workerRuntime,
      stepAllocationTimeoutSeconds: workflow.stepAllocationTimeoutSeconds,
    },
    steps: steps.map((s) => ({
      id: s.id,
      name: s.name,
      promptTemplate: s.promptTemplate,
      stepOrder: s.stepOrder,
      agentId: s.agentId,
      model: s.model,
      reasoningEffort: s.reasoningEffort,
      workerRuntime: s.workerRuntime,
      timeoutSeconds: s.timeoutSeconds,
    })),
  };

  // Create execution record
  const [execution] = await db
    .insert(workflowExecutions)
    .values({
      workflowId,
      triggerId,
      triggerMetadata,
      workflowVersion: workflow.version,
      workflowSnapshot,
      status: 'pending',
      currentStep: 0,
      totalSteps: steps.length,
    })
    .returning();

  // Pre-create step execution records
  await db.insert(stepExecutions).values(
    steps.map((step) => ({
      workflowExecutionId: execution.id,
      workflowStepId: step.id,
      stepOrder: step.stepOrder,
      status: 'pending' as const,
    })),
  );

  // Enqueue BullMQ job
  await getQueue().add(
    'execute-workflow',
    {
      executionId: execution.id,
      workflowId,
    },
    { jobId: `exec-${execution.id}` },
  );

  logger.info({ executionId: execution.id, workflowId, version: workflow.version }, 'Workflow execution enqueued');

  // Broadcast realtime event for new execution
  publishRealtimeEvent({
    type: 'execution.created',
    executionId: execution.id,
    workflowId,
    workspaceId: workflow.workspaceId ?? undefined,
    data: { status: 'pending', totalSteps: steps.length, workflowName: workflow.name },
    timestamp: new Date().toISOString(),
  });

  return execution;
}

/**
 * Retry a failed execution from the last failed step.
 * Creates a new execution record, copies completed step outputs, and re-runs from the failed step.
 */
export async function retryWorkflowExecution(failedExecutionId: string) {
  const failedExecution = await db.query.workflowExecutions.findFirst({
    where: eq(workflowExecutions.id, failedExecutionId),
  });
  if (!failedExecution) throw new Error(`Execution ${failedExecutionId} not found`);
  if (failedExecution.status !== 'failed') throw new Error('Only failed executions can be retried');

  const workflow = await db.query.workflows.findFirst({
    where: eq(workflows.id, failedExecution.workflowId),
  });
  if (!workflow) throw new Error(`Workflow ${failedExecution.workflowId} not found`);

  const failedSteps = await db.query.stepExecutions.findMany({
    where: eq(stepExecutions.workflowExecutionId, failedExecutionId),
    orderBy: stepExecutions.stepOrder,
  });

  // Find the first failed step
  const failedStepIdx = failedSteps.findIndex((s) => s.status === 'failed');
  if (failedStepIdx === -1) throw new Error('No failed step found');

  const steps = await db.query.workflowSteps.findMany({
    where: eq(workflowSteps.workflowId, workflow.id),
    orderBy: workflowSteps.stepOrder,
  });

  // Create new execution record using same workflow snapshot from the original execution
  const [newExecution] = await db
    .insert(workflowExecutions)
    .values({
      workflowId: workflow.id,
      triggerId: failedExecution.triggerId,
      triggerMetadata: {
        ...(failedExecution.triggerMetadata as Record<string, unknown> ?? {}),
        retryOf: failedExecutionId,
        retriedAt: new Date().toISOString(),
      },
      workflowVersion: failedExecution.workflowVersion,
      workflowSnapshot: failedExecution.workflowSnapshot,
      status: 'pending',
      currentStep: 0,
      totalSteps: steps.length,
    })
    .returning();

  // Pre-create step executions: completed steps get copied, rest are pending
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const oldStepExec = failedSteps[i];

    if (i < failedStepIdx && oldStepExec?.status === 'completed') {
      // Copy completed step output from the failed execution
      await db.insert(stepExecutions).values({
        workflowExecutionId: newExecution.id,
        workflowStepId: step.id,
        stepOrder: step.stepOrder,
        resolvedPrompt: oldStepExec.resolvedPrompt,
        output: oldStepExec.output,
        reasoningTrace: oldStepExec.reasoningTrace,
        status: 'completed',
        startedAt: oldStepExec.startedAt,
        completedAt: oldStepExec.completedAt,
      });
    } else {
      await db.insert(stepExecutions).values({
        workflowExecutionId: newExecution.id,
        workflowStepId: step.id,
        stepOrder: step.stepOrder,
        status: 'pending',
      });
    }
  }

  // Enqueue BullMQ job with startFromStep to skip completed steps
  await getQueue().add(
    'execute-workflow',
    {
      executionId: newExecution.id,
      workflowId: workflow.id,
      startFromStep: failedStepIdx, // 0-indexed: skip to this step
    },
    { jobId: `exec-${newExecution.id}` },
  );

  logger.info(
    { executionId: newExecution.id, retryOf: failedExecutionId, startFromStep: failedStepIdx + 1 },
    'Retry execution enqueued',
  );

  publishRealtimeEvent({
    type: 'execution.created',
    executionId: newExecution.id,
    workflowId: workflow.id,
    workspaceId: workflow.workspaceId ?? undefined,
    data: { status: 'pending', totalSteps: steps.length, retryOf: failedExecutionId },
    timestamp: new Date().toISOString(),
  });

  return newExecution;
}

/**
 * Execute a workflow: run each step sequentially as a Copilot session.
 * Called by the workflow worker. Supports startFromStep for retry.
 */
export async function executeWorkflow(executionId: string, startFromStep = 0) {
  const execution = await db.query.workflowExecutions.findFirst({
    where: eq(workflowExecutions.id, executionId),
  });
  if (!execution) throw new Error(`Execution ${executionId} not found`);

  const workflow = await db.query.workflows.findFirst({
    where: eq(workflows.id, execution.workflowId),
  });
  if (!workflow) throw new Error(`Workflow ${execution.workflowId} not found`);

  const steps = await db.query.workflowSteps.findMany({
    where: eq(workflowSteps.workflowId, workflow.id),
    orderBy: workflowSteps.stepOrder,
  });

  const stepExecs = await db.query.stepExecutions.findMany({
    where: eq(stepExecutions.workflowExecutionId, executionId),
    orderBy: stepExecutions.stepOrder,
  });

  const allocationTimeoutSeconds = resolveStepAllocationTimeoutSeconds(execution, workflow);

  // Mark execution as running
  await db
    .update(workflowExecutions)
    .set({ status: 'running', startedAt: new Date(), currentStep: startFromStep + 1 })
    .where(eq(workflowExecutions.id, executionId));

  publishRealtimeEvent({
    type: 'execution.started',
    executionId,
    workflowId: workflow.id,
    workspaceId: workflow.workspaceId ?? undefined,
    data: { status: 'running', totalSteps: steps.length, startFromStep },
    timestamp: new Date().toISOString(),
  });

  // Execute each step using the configured execution mode
  for (let i = startFromStep; i < steps.length; i++) {
    const step = steps[i];
    const stepExec = stepExecs[i];

    await db
      .update(workflowExecutions)
      .set({ currentStep: i + 1 })
      .where(eq(workflowExecutions.id, executionId));

    // Resolve agent ID for this step
    const resolvedAgentId = step.agentId || workflow.defaultAgentId;
    if (!resolvedAgentId) {
      const errorMsg = `No agent configured for step "${step.name}" and no workflow default agent set`;
      await markStepAndExecutionFailed(stepExec.id, executionId, stepExecs, i, errorMsg);
      logger.error({ executionId, stepOrder: step.stepOrder, error: errorMsg }, 'Step failed (no agent)');
      return;
    }

    const stepAgent = await db.query.agents.findFirst({
      where: eq(agents.id, resolvedAgentId),
    });
    if (!stepAgent) {
      const errorMsg = `Agent ${resolvedAgentId} not found for step "${step.name}"`;
      await markStepAndExecutionFailed(stepExec.id, executionId, stepExecs, i, errorMsg);
      logger.error({ executionId, stepOrder: step.stepOrder, error: errorMsg }, 'Step failed (agent missing)');
      return;
    }

    try {
      const stepWorkerRuntime = resolveStepWorkerRuntime(execution, workflow, step);

      if (stepWorkerRuntime === 'ephemeral') {
        await executeStepEphemeral(
          stepExec,
          step,
          stepAgent,
          executionId,
          workflow.id,
          allocationTimeoutSeconds,
          stepExecs,
          i,
        );
      } else {
        await executeStepStatic(stepExec, step, executionId, allocationTimeoutSeconds, stepExecs, i);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await markStepAndExecutionFailed(stepExec.id, executionId, stepExecs, i, errorMsg);
      logger.error({ executionId, stepOrder: step.stepOrder, error: errorMsg }, 'Step failed');
      return;
    }

    // Check if step was marked as failed (by the worker/pod)
    const updatedStepExec = await db.query.stepExecutions.findFirst({
      where: eq(stepExecutions.id, stepExec.id),
    });
    if (updatedStepExec?.status === 'failed') {
      const errorMsg = updatedStepExec.error || 'Step execution failed';
      // Mark remaining steps as skipped
      for (let j = i + 1; j < stepExecs.length; j++) {
        await db
          .update(stepExecutions)
          .set({ status: 'skipped' })
          .where(eq(stepExecutions.id, stepExecs[j].id));
      }
      await db
        .update(workflowExecutions)
        .set({ status: 'failed', error: errorMsg, completedAt: new Date() })
        .where(eq(workflowExecutions.id, executionId));

      publishRealtimeEvent({
        type: 'execution.failed',
        executionId,
        workflowId: workflow.id,
        workspaceId: workflow.workspaceId ?? undefined,
        data: { status: 'failed', error: errorMsg, stepOrder: step.stepOrder },
        timestamp: new Date().toISOString(),
      });

      logger.error({ executionId, stepOrder: step.stepOrder, error: errorMsg }, 'Step failed');
      return;
    }

    logger.info({ executionId, stepOrder: step.stepOrder }, 'Step completed');
  }

  // All steps completed: mark execution as completed
  await db
    .update(workflowExecutions)
    .set({ status: 'completed', completedAt: new Date() })
    .where(eq(workflowExecutions.id, executionId));

  publishRealtimeEvent({
    type: 'execution.completed',
    executionId,
    workflowId: workflow.id,
    workspaceId: workflow.workspaceId ?? undefined,
    data: { status: 'completed', totalSteps: steps.length },
    timestamp: new Date().toISOString(),
  });

  // Update lastSessionAt for all agents used in the workflow
  const agentIdsUsed = [...new Set(steps.map((s) => s.agentId || workflow.defaultAgentId).filter(Boolean))] as string[];
  for (const agentId of agentIdsUsed) {
    await db.update(agents).set({ lastSessionAt: new Date() }).where(eq(agents.id, agentId));
  }

  logger.info({ executionId }, 'Workflow execution completed');
}

// ─── Step Execution: Static Mode ──────────────────────────────────────

/**
 * Execute a step via static agent workers (BullMQ queue).
 * Enqueues the step job and polls DB for completion.
 */
async function executeStepStatic(
  stepExec: { id: string },
  step: { timeoutSeconds: number | null },
  executionId: string,
  allocationTimeoutSeconds: number,
  _stepExecs: Array<{ id: string }>,
  _stepIndex: number,
): Promise<void> {
  const queue = getStepQueue();
  const allocationTimeoutMs = allocationTimeoutSeconds * 1000;
  const executionTimeoutMs = getStepExecutionBudgetSeconds(step.timeoutSeconds) * 1000;

  // Enqueue the step execution job for a static agent worker to pick up
  await queue.add('step-execution', {
    stepExecutionId: stepExec.id,
    executionId,
  });

  logger.info(
    { stepExecutionId: stepExec.id, executionId, allocationTimeoutSeconds },
    'Step enqueued for static agent allocation',
  );

  const allocatedStep = await waitForStepAllocation(
    stepExec.id,
    allocationTimeoutMs,
    `Timed out waiting ${allocationTimeoutSeconds}s to allocate the step to an available static worker.`,
  );

  if (allocatedStep.status === 'completed' || allocatedStep.status === 'failed') {
    return;
  }

  await waitForStepCompletion(
    stepExec.id,
    executionTimeoutMs,
    'Step execution timed out after allocation to a static worker',
  );
}

// ─── Step Execution: Ephemeral Mode ───────────────────────────────────

/**
 * Execute a step via ephemeral K8s pod (original pattern).
 * Currently unused — all steps route through static workers.
 * Retained for future per-step ephemeral isolation support.
 */
async function executeStepEphemeral(
  stepExec: { id: string },
  step: { stepOrder: number; timeoutSeconds: number | null },
  stepAgent: { id: string; name: string },
  executionId: string,
  workflowId: string,
  allocationTimeoutSeconds: number,
  _stepExecs: Array<{ id: string }>,
  _stepIndex: number,
): Promise<void> {
  let podName: string | null = null;
  const executionBudgetSeconds = getStepExecutionBudgetSeconds(step.timeoutSeconds);
  try {
    // Create a dedicated K8s pod for this step
    podName = await createAgentPod({
      stepExecutionId: stepExec.id,
      executionId,
      workflowId,
      stepOrder: step.stepOrder,
      agentId: stepAgent.id,
      agentName: stepAgent.name,
      timeoutSeconds: allocationTimeoutSeconds + executionBudgetSeconds,
    });

    // Register in instance registry
    await registerEphemeralInstance(podName, stepExec.id, { executionId, workflowId });

    logger.info(
      { executionId, stepOrder: step.stepOrder, podName, agentName: stepAgent.name, allocationTimeoutSeconds },
      'Ephemeral agent instance created for step execution',
    );

    const allocationResult = await waitForStepAllocation(
      stepExec.id,
      allocationTimeoutSeconds * 1000,
      `Timed out waiting ${allocationTimeoutSeconds}s for ephemeral worker pod readiness.`,
    );

    if (allocationResult.status === 'completed' || allocationResult.status === 'failed') {
      return;
    }

    // Wait for the dedicated pod to finish once the step has been allocated.
    const podResult = await waitForPodCompletion(podName, executionBudgetSeconds);

    if (podResult === 'Succeeded') {
      const pollTimeoutMs = 10_000;
      const pollIntervalMs = 1_000;
      const pollStart = Date.now();

      while (Date.now() - pollStart < pollTimeoutMs) {
        const updatedStepExec = await db.query.stepExecutions.findFirst({
          where: eq(stepExecutions.id, stepExec.id),
        });

        if (updatedStepExec?.status === 'completed') return;
        if (updatedStepExec?.status === 'failed') {
          throw new Error(updatedStepExec.error || 'Ephemeral agent instance failed');
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }

      throw new Error('Ephemeral agent instance completed but step status was not persisted');
    }

    if (podResult === 'Failed') {
      const updatedStepExec = await db.query.stepExecutions.findFirst({
        where: eq(stepExecutions.id, stepExec.id),
      });
      const errorMsg = updatedStepExec?.error || 'Ephemeral agent instance failed';

      if (updatedStepExec?.status !== 'failed') {
        await db
          .update(stepExecutions)
          .set({ status: 'failed', error: errorMsg, completedAt: new Date() })
          .where(eq(stepExecutions.id, stepExec.id));
      }

      throw new Error(errorMsg);
    }
  } finally {
    if (podName) {
      await deleteAgentPod(podName).catch(() => {});
      await terminateEphemeralInstance(podName).catch(() => {});
    }
  }
}

/**
 * Helper: mark a step as failed, remaining steps as skipped, and execution as failed.
 */
async function markStepAndExecutionFailed(
  stepExecId: string,
  executionId: string,
  stepExecs: Array<{ id: string }>,
  stepIndex: number,
  errorMsg: string,
): Promise<void> {
  await db
    .update(stepExecutions)
    .set({ status: 'failed', error: errorMsg, completedAt: new Date() })
    .where(eq(stepExecutions.id, stepExecId));

  for (let j = stepIndex + 1; j < stepExecs.length; j++) {
    await db
      .update(stepExecutions)
      .set({ status: 'skipped' })
      .where(eq(stepExecutions.id, stepExecs[j].id));
  }

  await db
    .update(workflowExecutions)
    .set({ status: 'failed', error: errorMsg, completedAt: new Date() })
    .where(eq(workflowExecutions.id, executionId));
}

/**
 * Execute a single Copilot session for one workflow step.
 * Uses @github/copilot-sdk to:
 * 1. Clone the agent's Git repo
 * 2. Load agent personality (.md) and skills
 * 3. Initialize a Copilot session with custom tools
 * 4. Run the prompt and capture output
 * 5. Track token usage for quota enforcement
 */
/** A single intermediate event emitted during a Copilot session. */
export interface LiveOutputEvent {
  type: 'tool_call_start' | 'tool_call_end' | 'message_delta' | 'turn_start' | 'turn_end' | 'info';
  timestamp: string;
  tool?: string;
  args?: unknown;
  result?: unknown;
  content?: string;
  message?: string;
}

export async function executeCopilotSession(params: {
  agent: typeof agents.$inferSelect;
  step: typeof workflowSteps.$inferSelect;
  stepExecutionId?: string;
  resolvedPrompt: string;
  precedentOutput: string;
  credentials: Map<string, string>;
  properties: Map<string, string>;
  envVariables: Map<string, string>;
  workerRuntime: 'static' | 'ephemeral';
  inputs?: Record<string, unknown>;
  workflowId: string;
  workspaceId: string;
  executionId: string;
  userId: string;
  workflowDefaultModel?: string | null;
  workflowDefaultReasoningEffort?: string | null;
  onProgress?: (events: LiveOutputEvent[]) => void | Promise<void>;
}): Promise<{ output: string; resolvedPrompt: string; reasoningTrace: Record<string, unknown> }> {
  const { agent, step, stepExecutionId, resolvedPrompt: rawPrompt, precedentOutput, credentials, properties, envVariables, workerRuntime, inputs, workflowId, workspaceId, executionId, userId, workflowDefaultModel, workflowDefaultReasoningEffort, onProgress } = params;

  // Render prompt template using Jinja2 (nunjucks) with full variable context
  const templateContext = buildTemplateContext({
    properties,
    credentials,
    envVariables,
    precedentOutput,
    inputs,
  });
  const resolvedPrompt = renderTemplate(rawPrompt, templateContext);

  logger.info(
    {
      agentName: agent.name,
      stepName: step.name,
      promptLength: resolvedPrompt.length,
      credentialCount: credentials.size,
    },
    'Executing Copilot session',
  );

  // 0. Acquire distributed session lock (prevent concurrent sessions per agent)
  const { lockValue, blockingSession } = await acquireSessionLockWithWait(agent.id, {
    agentId: agent.id,
    agentName: agent.name,
    executionId,
    stepExecutionId,
    workflowId,
    workerRuntime,
    stepName: step.name,
    acquiredAt: new Date().toISOString(),
  });
  if (!lockValue) {
    const blocker = blockingSession
      ? ` Current owner: execution ${blockingSession.executionId}, step execution ${blockingSession.stepExecutionId || 'unknown'}, step "${blockingSession.stepName}", acquired at ${blockingSession.acquiredAt}.`
      : '';
    throw new Error(
      `Agent ${agent.name} (${agent.id}) is still busy after waiting ${SESSION_LOCK_WAIT_SECONDS}s for its active Copilot session to finish.${blocker}`,
    );
  }

  // Extend session lock every 5 minutes to prevent TTL expiry on long sessions
  const lockExtendTimer = setInterval(() => {
    extendSessionLock(agent.id).catch((err) => {
      logger.warn({ agentId: agent.id, error: err }, 'Failed to extend session lock');
    });
  }, 5 * 60 * 1000);

  let workspace: Awaited<ReturnType<typeof prepareAgentWorkspace>> | Awaited<ReturnType<typeof prepareDbAgentWorkspace>> | null = null;
  const toolCalls: Array<{ tool: string; args: unknown }> = [];
  const mcpCleanups: Array<() => Promise<void>> = [];
  const originalGithubToken = process.env.GITHUB_TOKEN;
  let copilotTokenOverride: string | null = null;

  try {
    // 1. Prepare agent workspace based on source type
    // Resolve GitHub token: prefer credential reference over inline encrypted token
    let resolvedGithubTokenEncrypted = agent.githubTokenEncrypted;
    let resolvedGithubCredentialSubType: string | null = null;
    if (agent.githubTokenCredentialId && !resolvedGithubTokenEncrypted) {
      const gitCredential = await resolveScopedCredentialById({
        credentialId: agent.githubTokenCredentialId,
        agentId: agent.id,
        userId,
        workspaceId,
      });

      if (!gitCredential) {
        throw new Error('Configured Git authentication credential was not found in agent, user, or workspace variables.');
      }

      resolvedGithubTokenEncrypted = gitCredential.valueEncrypted;
      resolvedGithubCredentialSubType = gitCredential.credentialSubType;
    }

    // Resolve Copilot CLI token: per-agent override for GITHUB_TOKEN used by CopilotClient
    if (agent.copilotTokenCredentialId) {
      const copilotCredential = await resolveScopedCredentialById({
        credentialId: agent.copilotTokenCredentialId,
        agentId: agent.id,
        userId,
        workspaceId,
      });

      if (!copilotCredential) {
        throw new Error('Configured Copilot authentication credential was not found in agent, user, or workspace variables.');
      }

      ensureSupportedCopilotCredentialSubType(copilotCredential);
      copilotTokenOverride = decrypt(copilotCredential.valueEncrypted);
      if (copilotTokenOverride) {
        logger.info({ agentId: agent.id }, 'Using per-agent Copilot token override');
      }
    }

    workspace = agent.sourceType === 'database'
      ? await prepareDbAgentWorkspace(agent.id)
      : await prepareAgentWorkspace({
        gitRepoUrl: agent.gitRepoUrl!,
        gitBranch: agent.gitBranch,
        agentFilePath: agent.agentFilePath!,
        skillsPaths: agent.skillsPaths ?? [],
        skillsDirectory: agent.skillsDirectory,
        githubTokenEncrypted: resolvedGithubTokenEncrypted,
        githubCredentialSubType: resolvedGithubCredentialSubType,
      });

    // 1.5 Write .env file with variables marked for env injection
    if (envVariables.size > 0 && workspace.workdir) {
      const { writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const envContent = [...envVariables.entries()].map(([k, v]) => `${k}=${v}`).join('\n');
      await writeFile(join(workspace.workdir, '.env'), envContent, 'utf-8');
      logger.info({ envVarCount: envVariables.size }, 'Wrote .env file to agent workspace');
    }

    // 2. Build system message from agent personality + skills
    const skillsContent = workspace.skills.length
      ? `\n\n## Agent Skills\n\n${workspace.skills.join('\n\n---\n\n')}`
      : '';
    const systemContent = `${workspace.agentMarkdown}${skillsContent}`;

    // 3. Create agent tools (built-in + MCP tools from configured servers)
    const builtInTools = createAgentTools(credentials, {
      agentId: agent.id,
      workflowId,
      executionId,
      userId: agent.userId,
      workspaceId,
    }, (agent.builtinToolsEnabled as string[]) ?? undefined, templateContext);

    // 3.1 Load MCP server configurations for this agent from DB
    const mcpConfigs = await db.query.mcpServerConfigs.findMany({
      where: eq(mcpServerConfigs.agentId, agent.id),
    });

    const enabledConfigs = mcpConfigs.filter((c) => c.isEnabled);
    let allTools = builtInTools;

    for (const mcpConfig of enabledConfigs) {
      try {
        // Resolve env vars from agent credentials using envMapping
        const envMapping = (mcpConfig.envMapping ?? {}) as Record<string, string>;
        const resolvedEnv: Record<string, string> = {};
        for (const [credKey, envVar] of Object.entries(envMapping)) {
          const value = credentials.get(credKey);
          if (value) resolvedEnv[envVar] = value;
        }

        const mcp = await connectToMcpServer({
          name: mcpConfig.name,
          command: mcpConfig.command,
          args: (mcpConfig.args ?? []) as string[],
          env: resolvedEnv,
          writeTools: (mcpConfig.writeTools ?? []) as string[],
        });
        allTools = [...allTools, ...mcp.tools];
        mcpCleanups.push(mcp.cleanup);
        logger.info({ server: mcpConfig.name, mcpToolCount: mcp.tools.length }, 'MCP tools loaded');
      } catch (mcpErr) {
        logger.warn({ server: mcpConfig.name, error: mcpErr }, 'Failed to connect to MCP server, skipping');
      }
    }

    // 3.1.5 Render agent's mcp.json.template (Jinja2) and spawn MCP servers from it
    if (agent.mcpJsonTemplate) {
      try {
        const renderedMcpJson = renderTemplate(agent.mcpJsonTemplate, templateContext);
        const mcpJson = JSON.parse(renderedMcpJson) as {
          mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
        };
        if (mcpJson.mcpServers) {
          for (const [serverName, serverConfig] of Object.entries(mcpJson.mcpServers)) {
            try {
              const mcp = await connectToMcpServer({
                name: serverName,
                command: serverConfig.command,
                args: serverConfig.args ?? [],
                env: serverConfig.env ?? {},
              });
              allTools = [...allTools, ...mcp.tools];
              mcpCleanups.push(mcp.cleanup);
              logger.info({ server: serverName, mcpToolCount: mcp.tools.length }, 'MCP tools loaded from mcp.json.template');
            } catch (err) {
              logger.warn({ server: serverName, error: err }, 'Failed to connect MCP server from template, skipping');
            }
          }
        }
      } catch (err) {
        logger.warn({ error: err }, 'Failed to render/parse mcp.json.template, skipping');
      }
    }

    const tools = allTools;

    // 4. Initialize Copilot client + session
    if (copilotTokenOverride) {
      process.env.GITHUB_TOKEN = copilotTokenOverride;
    }
    const client = new CopilotClient();

    // Use step-level model if specified, else workflow default, else env default
    const model = step.model ?? workflowDefaultModel ?? process.env.DEFAULT_AGENT_MODEL ?? 'gpt-4.1';

    const sessionOptions: Record<string, unknown> = {
      model,
      tools,
      onPermissionRequest: approveAll,
      systemMessage: {
        mode: 'customize',
        sections: {
          code_change_rules: { action: 'remove' },
          guidelines: {
            action: 'append',
            content:
              '\n* You are an autonomous AI agent. Execute tools to gather data and make decisions.\n* Always explain your reasoning before and after tool calls.\n* Follow the instructions and personality defined in your agent files.',
          },
        },
        content: systemContent,
      },
    };

    // Pass reasoning effort if specified on the step or workflow default
    const resolvedReasoning = step.reasoningEffort ?? workflowDefaultReasoningEffort;
    if (resolvedReasoning) {
      (sessionOptions as Record<string, unknown>).reasoningEffort = resolvedReasoning;
    }

    const session = await client.createSession(sessionOptions as unknown as Parameters<typeof client.createSession>[0]);

    // 5. Track tool calls for reasoning trace AND live output events
    const liveEvents: LiveOutputEvent[] = [];
    let progressFlushTimer: ReturnType<typeof setInterval> | null = null;
    let lastFlushedLength = 0;

    const pushLiveEvent = (event: LiveOutputEvent) => {
      liveEvents.push(event);
    };

    // Flush live events to the onProgress callback periodically (every 2s)
    if (onProgress) {
      // Send initial "session started" event
      pushLiveEvent({ type: 'info', timestamp: new Date().toISOString(), message: `Copilot session started (model: ${model})` });
      progressFlushTimer = setInterval(async () => {
        if (liveEvents.length > lastFlushedLength) {
          lastFlushedLength = liveEvents.length;
          try { await onProgress([...liveEvents]); } catch { /* ignore flush errors */ }
        }
      }, 2000);
    }

    session.on('tool.execution_start', (event) => {
      const toolName = event.data?.toolName ?? 'unknown';
      toolCalls.push({ tool: toolName, args: event.data?.arguments });
      pushLiveEvent({ type: 'tool_call_start', timestamp: new Date().toISOString(), tool: toolName, args: event.data?.arguments });
    });

    session.on('tool.execution_complete', (event) => {
      pushLiveEvent({ type: 'tool_call_end', timestamp: new Date().toISOString(), tool: event.data?.toolCallId ?? 'unknown', result: event.data?.success });
    });

    session.on('assistant.message_delta', (event) => {
      pushLiveEvent({ type: 'message_delta', timestamp: new Date().toISOString(), content: event.data?.deltaContent ?? '' });
    });

    session.on('assistant.turn_start', () => {
      pushLiveEvent({ type: 'turn_start', timestamp: new Date().toISOString() });
    });

    session.on('assistant.turn_end', () => {
      pushLiveEvent({ type: 'turn_end', timestamp: new Date().toISOString() });
    });

    // 6. Send prompt and wait for response
    const timeoutMs = (step.timeoutSeconds ?? 300) * 1000;
    const response = await session.sendAndWait({ prompt: resolvedPrompt }, timeoutMs);

    const output = response?.data?.content ?? '[No response from Copilot session]';

    // Final flush of live events
    if (progressFlushTimer) clearInterval(progressFlushTimer);
    if (onProgress && liveEvents.length > lastFlushedLength) {
      try { await onProgress([...liveEvents]); } catch { /* ignore */ }
    }

    // 7. Clean up session
    await session.disconnect();
    await client.stop();

    // 8. Track quota usage (best-effort)
    try {
      const today = new Date().toISOString().split('T')[0];
      await db
        .insert(agentQuotaUsage)
        .values({
          agentId: agent.id,
          date: today,
          promptTokensUsed: resolvedPrompt.length, // approximate
          completionTokensUsed: output.length, // approximate
          sessionCount: 1,
        })
        .onConflictDoUpdate({
          target: [agentQuotaUsage.agentId, agentQuotaUsage.date],
          set: {
            promptTokensUsed: sql`${agentQuotaUsage.promptTokensUsed} + ${resolvedPrompt.length}`,
            completionTokensUsed: sql`${agentQuotaUsage.completionTokensUsed} + ${output.length}`,
            sessionCount: sql`${agentQuotaUsage.sessionCount} + 1`,
          },
        });
    } catch (quotaErr) {
      logger.warn({ error: quotaErr }, 'Failed to update quota usage');
    }

    // 9. Track credit usage per user per model (best-effort)
    try {
      const today = new Date().toISOString().split('T')[0];
      // Look up model's credit cost from the models table (scoped to workspace)
      const modelRecord = workspaceId
        ? await db.query.models.findFirst({
            where: and(eq(models.name, model), eq(models.workspaceId, workspaceId)),
          })
        : null;
      const cost = modelRecord ? modelRecord.creditCost : '1.00';

      await db
        .insert(creditUsage)
        .values({
          userId,
          workspaceId,
          modelName: model,
          creditCostSnapshot: cost,
          creditsConsumed: cost,
          sessionCount: 1,
          date: today,
        })
        .onConflictDoUpdate({
          target: [creditUsage.userId, creditUsage.modelName, creditUsage.date, creditUsage.creditCostSnapshot],
          set: {
            creditsConsumed: sql`${creditUsage.creditsConsumed}::numeric + ${cost}::numeric`,
            sessionCount: sql`${creditUsage.sessionCount} + 1`,
          },
        });
    } catch (creditErr) {
      logger.warn({ error: creditErr }, 'Failed to update credit usage');
    }

    return {
      output,
      resolvedPrompt,
      reasoningTrace: {
        model,
        reasoningEffort: step.reasoningEffort ?? null,
        workerRuntime,
        agentFile: agent.agentFilePath,
        skills: agent.skillsPaths,
        promptTokens: resolvedPrompt.length,
        completionTokens: output.length,
        toolCalls,
      },
    };
  } finally {
    clearInterval(lockExtendTimer);
    // Restore original GITHUB_TOKEN if it was overridden
    if (copilotTokenOverride) {
      if (originalGithubToken !== undefined) {
        process.env.GITHUB_TOKEN = originalGithubToken;
      } else {
        delete process.env.GITHUB_TOKEN;
      }
    }
    for (const cleanup of mcpCleanups) {
      try { await cleanup(); } catch { /* ignore */ }
    }
    if (workspace) {
      await workspace.cleanup();
    }
    await releaseSessionLock(agent.id, lockValue);
  }
}
