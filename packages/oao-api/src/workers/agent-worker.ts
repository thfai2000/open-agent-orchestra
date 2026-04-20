/**
 * Agent Worker — Long-running static agent instance for executing workflow steps.
 *
 * Architecture (Jenkins Static Agent pattern):
 *   This process registers itself as a "static" agent instance, then listens on
 *   the `agent-step-execution` BullMQ queue. When a job arrives, it loads the
 *   step configuration from the database, executes a Copilot session, and writes
 *   results back. Unlike ephemeral K8s pods, this worker survives across multiple
 *   step executions.
 *
 * Usage:
 *   node --import tsx packages/oao-api/src/workers/agent-worker.ts
 *
 * Environment:
 *   AGENT_WORKER_NAME — Optional instance name (defaults to hostname-pid)
 *   AGENT_DATABASE_URL — PostgreSQL connection
 *   REDIS_URL — Redis connection
 *   GITHUB_TOKEN — For Copilot SDK
 */
import { Worker } from 'bullmq';
import { eq, and } from 'drizzle-orm';
import { createLogger, decrypt } from '@oao/shared';
import { db } from '../database/index.js';
import {
  stepExecutions,
  workflowExecutions,
  workflows,
  workflowSteps,
  agents,
  agentVariables,
  userVariables,
  workspaceVariables,
} from '../database/schema.js';
import { executeCopilotSession, type LiveOutputEvent } from '../services/workflow-engine.js';
import { getRedisConnectionOpts } from '../services/redis.js';
import { publishRealtimeEvent } from '../services/realtime-bus.js';
import {
  registerStaticInstance,
  startHeartbeat,
  deregisterStaticInstance,
  markInstanceBusy,
  markInstanceIdle,
} from '../services/agent-instance-registry.js';
import os from 'node:os';

const logger = createLogger('agent-worker');

export const AGENT_STEP_QUEUE = 'agent-step-execution';

let worker: Worker | null = null;
let instanceId: string | null = null;

/**
 * Execute a single step — the core logic shared with agent-runner.ts (ephemeral).
 * Loads step config, resolves variables, runs Copilot session, writes results.
 */
async function executeStep(stepExecutionId: string, executionId: string): Promise<void> {
  // 1. Load step execution record
  const stepExec = await db.query.stepExecutions.findFirst({
    where: eq(stepExecutions.id, stepExecutionId),
  });
  if (!stepExec) throw new Error(`Step execution ${stepExecutionId} not found`);

  // Guard: skip if the step was already marked failed/cancelled (e.g. parent timed out)
  if (stepExec.status === 'failed' || stepExec.status === 'completed') {
    logger.warn({ stepExecutionId, status: stepExec.status }, 'Step already finished, skipping orphaned job');
    return;
  }

  // 2. Load parent workflow execution
  const execution = await db.query.workflowExecutions.findFirst({
    where: eq(workflowExecutions.id, executionId),
  });
  if (!execution) throw new Error(`Execution ${executionId} not found`);

  // Guard: skip if parent execution is already done (timeout, cancel, etc.)
  if (execution.status === 'failed' || execution.status === 'completed' || execution.status === 'cancelled') {
    logger.warn({ executionId, status: execution.status }, 'Parent execution already finished, skipping orphaned step job');
    return;
  }

  // 3. Load workflow
  const workflow = await db.query.workflows.findFirst({
    where: eq(workflows.id, execution.workflowId),
  });
  if (!workflow) throw new Error(`Workflow ${execution.workflowId} not found`);

  // 4. Load workflow step definition
  const step = await db.query.workflowSteps.findFirst({
    where: eq(workflowSteps.id, stepExec.workflowStepId),
  });
  if (!step) throw new Error(`Workflow step ${stepExec.workflowStepId} not found`);

  // 5. Resolve agent for this step
  const resolvedAgentId = step.agentId || workflow.defaultAgentId;
  if (!resolvedAgentId) throw new Error(`No agent configured for step "${step.name}"`);

  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, resolvedAgentId),
  });
  if (!agent) throw new Error(`Agent ${resolvedAgentId} not found`);

  // 6. Load 3-tier variables: workspace → user → agent
  const workspaceVars = workflow.workspaceId
    ? await db.query.workspaceVariables.findMany({
        where: eq(workspaceVariables.workspaceId, workflow.workspaceId),
      })
    : [];

  const wsCredentialMap = new Map(workspaceVars.filter(v => v.variableType === 'credential').map(c => [c.key, decrypt(c.valueEncrypted)]));
  const wsPropertyMap = new Map(workspaceVars.filter(v => v.variableType === 'property').map(c => [c.key, decrypt(c.valueEncrypted)]));
  const wsEnvVarMap = new Map(workspaceVars.filter(v => v.injectAsEnvVariable).map(c => [c.key, decrypt(c.valueEncrypted)]));

  const userVars = await db.query.userVariables.findMany({
    where: eq(userVariables.userId, workflow.userId),
  });

  const userCredentialMap = new Map([...wsCredentialMap, ...userVars.filter(v => v.variableType === 'credential').map(c => [c.key, decrypt(c.valueEncrypted)] as [string, string])]);
  const userPropertyMap = new Map([...wsPropertyMap, ...userVars.filter(v => v.variableType === 'property').map(c => [c.key, decrypt(c.valueEncrypted)] as [string, string])]);
  const userEnvVarMap = new Map([...wsEnvVarMap, ...userVars.filter(v => v.injectAsEnvVariable).map(c => [c.key, decrypt(c.valueEncrypted)] as [string, string])]);

  const agentVars = await db.query.agentVariables.findMany({
    where: eq(agentVariables.agentId, agent.id),
  });

  const mergedCredentials = new Map(userCredentialMap);
  const mergedProperties = new Map(userPropertyMap);
  const mergedEnvVars = new Map(userEnvVarMap);
  for (const v of agentVars) {
    const decrypted = decrypt(v.valueEncrypted);
    if (v.variableType === 'credential') mergedCredentials.set(v.key, decrypted);
    if (v.variableType === 'property') mergedProperties.set(v.key, decrypted);
    if (v.injectAsEnvVariable) mergedEnvVars.set(v.key, decrypted);
  }

  // 7. Recover precedent output and inputs from trigger metadata
  let precedentOutput = '';
  const meta = execution.triggerMetadata as Record<string, unknown> | null;

  // Extract inputs from trigger metadata (webhook params or manual run inputs)
  const inputs = (meta?.inputs as Record<string, unknown>) ?? {};

  if (stepExec.stepOrder > 1) {
    const prevStepExec = await db.query.stepExecutions.findFirst({
      where: and(
        eq(stepExecutions.workflowExecutionId, executionId),
        eq(stepExecutions.stepOrder, stepExec.stepOrder - 1),
      ),
    });
    if (prevStepExec?.output) {
      precedentOutput = prevStepExec.output;
    }
  }

  // 8. Mark step as running (store raw template initially; will be updated with rendered prompt after session)
  const startedStep = await db
    .update(stepExecutions)
    .set({ status: 'running', resolvedPrompt: step.promptTemplate, startedAt: new Date() })
    .where(and(eq(stepExecutions.id, stepExecutionId), eq(stepExecutions.status, 'pending')))
    .returning({ id: stepExecutions.id });

  if (startedStep.length === 0) {
    logger.warn({ stepExecutionId }, 'Step could not transition to running, skipping orphaned job');
    return;
  }

  publishRealtimeEvent({
    type: 'step.started',
    executionId,
    workflowId: workflow.id,
    workspaceId: workflow.workspaceId ?? undefined,
    stepExecutionId,
    stepOrder: stepExec.stepOrder,
    data: { status: 'running', stepName: step.name },
    timestamp: new Date().toISOString(),
  });

  // 9. Execute the Copilot session with live progress streaming
  let lastPublishedLength = 0;
  const onProgress = async (events: LiveOutputEvent[]) => {
    try {
      await db
        .update(stepExecutions)
        .set({ liveOutput: events })
        .where(eq(stepExecutions.id, stepExecutionId));
    } catch (err) {
      logger.warn({ stepExecutionId, error: err }, 'Failed to flush live output to DB');
    }
    // Publish only the new events since last publish
    if (events.length > lastPublishedLength) {
      const newEvents = events.slice(lastPublishedLength);
      lastPublishedLength = events.length;
      publishRealtimeEvent({
        type: 'step.progress',
        executionId,
        workflowId: workflow.id,
        workspaceId: workflow.workspaceId ?? undefined,
        stepExecutionId,
        stepOrder: stepExec.stepOrder,
        data: { events: newEvents, totalEvents: events.length },
        timestamp: new Date().toISOString(),
      });
    }
  };

  const result = await executeCopilotSession({
    agent,
    step,
    stepExecutionId,
    resolvedPrompt: step.promptTemplate,
    precedentOutput,
    credentials: mergedCredentials,
    properties: mergedProperties,
    envVariables: mergedEnvVars,
    workerRuntime: 'static',
    inputs,
    workflowId: workflow.id,
    workspaceId: workflow.workspaceId ?? '',
    executionId,
    userId: workflow.userId,
    workflowDefaultModel: workflow.defaultModel,
    workflowDefaultReasoningEffort: workflow.defaultReasoningEffort,
    onProgress,
  });

  const latestStepExec = await db.query.stepExecutions.findFirst({
    where: eq(stepExecutions.id, stepExecutionId),
  });
  const latestExecution = await db.query.workflowExecutions.findFirst({
    where: eq(workflowExecutions.id, executionId),
  });

  if (
    latestStepExec?.status === 'failed'
    || latestStepExec?.status === 'skipped'
    || latestExecution?.status === 'failed'
    || latestExecution?.status === 'cancelled'
  ) {
    logger.warn(
      { stepExecutionId, executionId, stepStatus: latestStepExec?.status, executionStatus: latestExecution?.status },
      'Late step result ignored because the step or execution is already terminal',
    );
    return;
  }

  // 10. Write success result to DB (including the actual rendered prompt)
  await db
    .update(stepExecutions)
    .set({
      status: 'completed',
      resolvedPrompt: result.resolvedPrompt,
      output: result.output,
      reasoningTrace: result.reasoningTrace,
      completedAt: new Date(),
    })
    .where(eq(stepExecutions.id, stepExecutionId));

  publishRealtimeEvent({
    type: 'step.completed',
    executionId,
    workflowId: workflow.id,
    workspaceId: workflow.workspaceId ?? undefined,
    stepExecutionId,
    stepOrder: stepExec.stepOrder,
    data: { status: 'completed', output: result.output?.substring(0, 200) },
    timestamp: new Date().toISOString(),
  });
}

// ─── Worker Lifecycle ─────────────────────────────────────────────────

/**
 * Start the static agent worker. Registers with the instance registry,
 * starts heartbeat, and begins processing step execution jobs.
 */
export async function startAgentWorker(): Promise<Worker> {
  if (worker) return worker;

  const workerName = process.env.AGENT_WORKER_NAME || `agent-${os.hostname()}-${process.pid}`;

  // Register as a static instance
  instanceId = await registerStaticInstance(workerName);
  startHeartbeat(instanceId);

  worker = new Worker(
    AGENT_STEP_QUEUE,
    async (job) => {
      const { stepExecutionId, executionId } = job.data;
      logger.info(
        { stepExecutionId, executionId, jobId: job.id, instanceId },
        'Processing step execution',
      );

      // Mark instance as busy
      if (instanceId) await markInstanceBusy(instanceId, stepExecutionId);

      try {
        await executeStep(stepExecutionId, executionId);
        logger.info({ stepExecutionId, jobId: job.id }, 'Step execution completed');
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        logger.error({ stepExecutionId, error: errorMsg }, 'Step execution failed');

        // Write failure to DB
        try {
          await db
            .update(stepExecutions)
            .set({ status: 'failed', error: errorMsg, completedAt: new Date() })
            .where(eq(stepExecutions.id, stepExecutionId));

          publishRealtimeEvent({
            type: 'step.failed',
            executionId,
            stepExecutionId,
            data: { status: 'failed', error: errorMsg },
            timestamp: new Date().toISOString(),
          });
        } catch (dbError) {
          logger.error({ dbError }, 'Failed to write error to database');
        }

        throw error; // Let BullMQ handle the failure
      } finally {
        // Mark instance as idle
        if (instanceId) await markInstanceIdle(instanceId);
      }
    },
    {
      connection: getRedisConnectionOpts(),
      concurrency: 1, // One step at a time per worker instance
      lockDuration: 600_000, // 10 minutes
    },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Step job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, error: err.message }, 'Step job failed');
  });

  worker.on('error', (err) => {
    logger.error({ error: err.message }, 'Agent worker error');
  });

  logger.info({ instanceId, workerName }, 'Static agent worker started, waiting for jobs...');
  return worker;
}

/**
 * Gracefully stop the agent worker.
 */
export async function stopAgentWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (instanceId) {
    await deregisterStaticInstance(instanceId);
    instanceId = null;
  }
}

// ─── Entry point (when run directly as a process) ─────────────────────

async function main() {
  logger.info('Starting static agent worker...');

  await startAgentWorker();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down agent worker...');
    await stopAgentWorker();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Only run main when executed directly (not imported)
const isDirectRun = process.argv[1]?.includes('agent-worker');
if (isDirectRun) {
  main().catch((err) => {
    logger.error({ error: err.message }, 'Agent worker startup failed');
    process.exit(1);
  });
}
