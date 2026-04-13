import { Queue } from 'bullmq';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../database/index.js';
import {
  workflowExecutions,
  stepExecutions,
  workflowSteps,
  workflows,
  agents,
  userVariables,
  workspaceVariables,
  agentQuotaUsage,
  mcpServerConfigs,
  creditUsage,
  models,
} from '../database/schema.js';
import { createLogger } from '@oao/shared';
import { getRedisConnection } from './redis.js';
import { CopilotClient, approveAll, defineTool } from '@github/copilot-sdk';
import { z } from 'zod';
import { prepareAgentWorkspace, prepareDbAgentWorkspace } from './agent-workspace.js';
import { createAgentTools } from './agent-tools.js';
import { connectToMcpServer } from './mcp-client.js';
import { loadAgentPlugins, readPluginSkills, getPluginMcpServers, getPluginToolDefs } from './plugin-loader.js';
import { renderTemplate, buildTemplateContext } from './jinja-renderer.js';

import { createAgentPod, waitForPodCompletion, deleteAgentPod, acquireAgentSlot, releaseAgentSlot } from './k8s-provisioner.js';
import { registerEphemeralInstance, terminateEphemeralInstance } from './agent-instance-registry.js';
import { AGENT_STEP_QUEUE } from '../workers/agent-worker.js';

const logger = createLogger('workflow-engine');

// ─── Redis Distributed Session Lock ──────────────────────────────────

const SESSION_LOCK_PREFIX = 'agent-session-lock:';
const SESSION_LOCK_TTL_SECONDS = 600; // 10 minutes

/**
 * Acquire a Redis distributed lock to prevent concurrent Copilot sessions
 * for the same agent. Uses SET NX with TTL for automatic expiry.
 * Returns a unique lock value for owner-aware release.
 */
async function acquireSessionLock(agentId: string): Promise<string | null> {
  const redis = getRedisConnection();
  const key = `${SESSION_LOCK_PREFIX}${agentId}`;
  const lockValue = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function extendSessionLock(agentId: string): Promise<void> {
  const redis = getRedisConnection();
  const key = `${SESSION_LOCK_PREFIX}${agentId}`;
  await redis.expire(key, SESSION_LOCK_TTL_SECONDS);
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
    },
    steps: steps.map((s) => ({
      id: s.id,
      name: s.name,
      promptTemplate: s.promptTemplate,
      stepOrder: s.stepOrder,
      agentId: s.agentId,
      model: s.model,
      reasoningEffort: s.reasoningEffort,
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

  // Mark execution as running
  await db
    .update(workflowExecutions)
    .set({ status: 'running', startedAt: new Date(), currentStep: startFromStep + 1 })
    .where(eq(workflowExecutions.id, executionId));

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
      // Always dispatch to static agent workers via BullMQ queue.
      // Ephemeral K8s pod execution is handled by the controller when
      // the Kubernetes API is available (per-step isolation option).
      await executeStepStatic(stepExec, step, executionId, stepExecs, i);
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
  _stepExecs: Array<{ id: string }>,
  _stepIndex: number,
): Promise<void> {
  const queue = getStepQueue();
  const timeout = (step.timeoutSeconds ?? 600) * 1000;
  const pollInterval = 3000; // 3 seconds

  // Enqueue the step execution job for a static agent worker to pick up
  await queue.add('step-execution', {
    stepExecutionId: stepExec.id,
    executionId,
  });

  logger.info({ stepExecutionId: stepExec.id, executionId }, 'Step enqueued for static agent');

  // Poll DB for step completion
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    const updated = await db.query.stepExecutions.findFirst({
      where: eq(stepExecutions.id, stepExec.id),
    });

    if (updated?.status === 'completed' || updated?.status === 'failed') {
      return; // Step finished — caller will check the status
    }
  }

  // Timeout
  throw new Error('Step execution timed out waiting for static agent worker');
}

// ─── Step Execution: Ephemeral Mode ───────────────────────────────────

/**
 * Execute a step via ephemeral K8s pod (original pattern).
 * Currently unused — all steps route through static workers.
 * Retained for future per-step ephemeral isolation support.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function executeStepEphemeral(
  stepExec: { id: string },
  step: { stepOrder: number; timeoutSeconds: number | null },
  stepAgent: { id: string; name: string },
  executionId: string,
  workflowId: string,
  _stepExecs: Array<{ id: string }>,
  _stepIndex: number,
): Promise<void> {
  // Acquire an agent slot (semaphore for max concurrent agents)
  let slotAcquired = false;
  const maxWait = 300_000; // 5 minutes
  const slotStart = Date.now();
  while (!slotAcquired && Date.now() - slotStart < maxWait) {
    slotAcquired = await acquireAgentSlot();
    if (!slotAcquired) {
      logger.debug({ stepExecutionId: stepExec.id }, 'Waiting for agent slot...');
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  if (!slotAcquired) {
    throw new Error('Timed out waiting for available agent slot (max concurrent agents reached)');
  }

  let podName: string | null = null;
  try {
    // Create a dedicated K8s pod for this step
    podName = await createAgentPod({
      stepExecutionId: stepExec.id,
      executionId,
      workflowId,
      stepOrder: step.stepOrder,
      agentId: stepAgent.id,
      agentName: stepAgent.name,
      timeoutSeconds: step.timeoutSeconds ?? 600,
    });

    // Register in instance registry
    await registerEphemeralInstance(podName, stepExec.id, { executionId, workflowId });

    logger.info(
      { executionId, stepOrder: step.stepOrder, podName, agentName: stepAgent.name },
      'Ephemeral agent instance created for step execution',
    );

    // Wait for the pod to complete
    const podResult = await waitForPodCompletion(podName, step.timeoutSeconds ?? 600);

    // Release agent slot
    await releaseAgentSlot();
    slotAcquired = false;

    // Cleanup the pod & instance record
    await deleteAgentPod(podName);
    await terminateEphemeralInstance(podName);

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
  } catch (error) {
    if (slotAcquired) await releaseAgentSlot();
    if (podName) {
      await deleteAgentPod(podName).catch(() => {});
      await terminateEphemeralInstance(podName).catch(() => {});
    }
    throw error;
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
export async function executeCopilotSession(params: {
  agent: typeof agents.$inferSelect;
  step: typeof workflowSteps.$inferSelect;
  resolvedPrompt: string;
  precedentOutput: string;
  credentials: Map<string, string>;
  properties: Map<string, string>;
  envVariables: Map<string, string>;
  inputs?: Record<string, unknown>;
  workflowId: string;
  workspaceId: string;
  executionId: string;
  userId: string;
  workflowDefaultModel?: string | null;
  workflowDefaultReasoningEffort?: string | null;
}): Promise<{ output: string; reasoningTrace: Record<string, unknown> }> {
  const { agent, step, resolvedPrompt: rawPrompt, precedentOutput, credentials, properties, envVariables, inputs, workflowId, workspaceId, executionId, userId, workflowDefaultModel, workflowDefaultReasoningEffort } = params;

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
  const lockValue = await acquireSessionLock(agent.id);
  if (!lockValue) {
    throw new Error(
      `Agent ${agent.name} (${agent.id}) already has an active Copilot session. Concurrent execution blocked.`,
    );
  }

  // 1. Prepare agent workspace based on source type
  // Resolve GitHub token: prefer credential reference over inline encrypted token
  let resolvedGithubTokenEncrypted = agent.githubTokenEncrypted;
  if (agent.githubTokenCredentialId && !resolvedGithubTokenEncrypted) {
    const credId = agent.githubTokenCredentialId;
    // Look up in user variables first (scoped to workflow owner), then workspace variables (scoped to workspace)
    const userCred = await db.query.userVariables.findFirst({
      where: and(eq(userVariables.id, credId), eq(userVariables.userId, userId)),
    });
    if (userCred) {
      resolvedGithubTokenEncrypted = userCred.valueEncrypted;
    } else if (workspaceId) {
      const wsCred = await db.query.workspaceVariables.findFirst({
        where: and(eq(workspaceVariables.id, credId), eq(workspaceVariables.workspaceId, workspaceId)),
      });
      if (wsCred) resolvedGithubTokenEncrypted = wsCred.valueEncrypted;
    }
  }

  const workspace = agent.sourceType === 'database'
    ? await prepareDbAgentWorkspace(agent.id)
    : await prepareAgentWorkspace({
      gitRepoUrl: agent.gitRepoUrl!,
      gitBranch: agent.gitBranch,
      agentFilePath: agent.agentFilePath!,
      skillsPaths: agent.skillsPaths ?? [],
      skillsDirectory: agent.skillsDirectory,
      githubTokenEncrypted: resolvedGithubTokenEncrypted,
    });

  const toolCalls: Array<{ tool: string; args: unknown }> = [];
  const mcpCleanups: Array<() => Promise<void>> = [];
  const pluginCleanups: Array<() => Promise<void>> = [];

  try {
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
    let systemContent = `${workspace.agentMarkdown}${skillsContent}`;

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

    // 3.2 Load enabled plugins for this agent
    const loadedPlugins = await loadAgentPlugins(agent.id);
    for (const loaded of loadedPlugins) {
      pluginCleanups.push(loaded.cleanup);

      // 3.2.1 Merge plugin skills into system message
      const pluginSkills = await readPluginSkills(loaded);
      if (pluginSkills.length > 0) {
        systemContent += `\n\n## Plugin Skills (${loaded.manifest.name})\n\n${pluginSkills.join('\n\n---\n\n')}`;
      }

      // 3.2.2 Merge plugin MCP servers
      const pluginMcpServers = getPluginMcpServers(loaded);
      for (const pmcp of pluginMcpServers) {
        try {
          const envMapping = pmcp.envMapping ?? {};
          const resolvedEnv: Record<string, string> = {};
          for (const [credKey, envVar] of Object.entries(envMapping)) {
            const value = credentials.get(credKey);
            if (value) resolvedEnv[envVar] = value;
          }
          const mcp = await connectToMcpServer({
            name: `${loaded.manifest.name}/${pmcp.name}`,
            command: pmcp.command,
            args: pmcp.args,
            env: resolvedEnv,
            writeTools: pmcp.writeTools,
          });
          allTools = [...allTools, ...mcp.tools];
          mcpCleanups.push(mcp.cleanup);
          logger.info({ plugin: loaded.manifest.name, server: pmcp.name, toolCount: mcp.tools.length }, 'Plugin MCP tools loaded');
        } catch (err) {
          logger.warn({ plugin: loaded.manifest.name, server: pmcp.name, error: err }, 'Failed to connect plugin MCP server, skipping');
        }
      }

      // 3.2.3 Load plugin tool scripts as Copilot SDK tools
      const pluginToolDefs = getPluginToolDefs(loaded);
      for (const toolDef of pluginToolDefs) {
        try {
          // Dynamically import the tool script and wrap as a Copilot SDK tool
          const toolModule = await import(toolDef.absolutePath);
          if (typeof toolModule.handler === 'function') {
            // Build a simple Zod schema from JSON Schema properties
            const schema = toolDef.parameters as { properties?: Record<string, { type: string; description?: string }>; required?: string[] };
            const zodShape: Record<string, z.ZodTypeAny> = {};
            if (schema.properties) {
              for (const [key, prop] of Object.entries(schema.properties)) {
                let field: z.ZodTypeAny = prop.type === 'number' ? z.number() : prop.type === 'boolean' ? z.boolean() : z.string();
                if (prop.description) field = field.describe(prop.description);
                if (!schema.required?.includes(key)) field = field.optional();
                zodShape[key] = field;
              }
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const tool = (defineTool as any)(`${loaded.manifest.name}/${toolDef.name}`, {
              description: toolDef.description,
              parameters: z.object(zodShape),
              handler: async (params: Record<string, unknown>) => {
                return toolModule.handler(params, { agentId: agent.id, workflowId, executionId });
              },
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            allTools = [...allTools, tool as any];
            logger.info({ plugin: loaded.manifest.name, tool: toolDef.name }, 'Plugin tool loaded');
          }
        } catch (err) {
          logger.warn({ plugin: loaded.manifest.name, tool: toolDef.name, error: err }, 'Failed to load plugin tool, skipping');
        }
      }
    }

    const tools = allTools;

    // 4. Initialize Copilot client + session
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

    // 5. Track tool calls for reasoning trace
    session.on('tool.execution_start', (event) => {
      toolCalls.push({ tool: event.data?.toolName ?? 'unknown', args: event.data?.arguments });
    });

    // 6. Send prompt and wait for response
    const timeoutMs = (step.timeoutSeconds ?? 300) * 1000;
    const response = await session.sendAndWait({ prompt: resolvedPrompt }, timeoutMs);

    const output = response?.data?.content ?? '[No response from Copilot session]';

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
          creditsConsumed: cost,
          sessionCount: 1,
          date: today,
        })
        .onConflictDoUpdate({
          target: [creditUsage.userId, creditUsage.modelName, creditUsage.date],
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
      reasoningTrace: {
        model,
        reasoningEffort: step.reasoningEffort ?? null,
        agentFile: agent.agentFilePath,
        skills: agent.skillsPaths,
        promptTokens: resolvedPrompt.length,
        completionTokens: output.length,
        toolCalls,
      },
    };
  } finally {
    for (const cleanup of mcpCleanups) {
      try { await cleanup(); } catch { /* ignore */ }
    }
    for (const cleanup of pluginCleanups) {
      try { await cleanup(); } catch { /* ignore */ }
    }
    await workspace.cleanup();
    await releaseSessionLock(agent.id, lockValue);
  }
}
