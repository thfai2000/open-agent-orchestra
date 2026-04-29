import { Queue } from 'bullmq';
import { eq, and, sql, asc } from 'drizzle-orm';
import { db } from '../database/index.js';
import {
  workflowExecutions,
  stepExecutions,
  workflowSteps,
  workflows,
  agentVariables,
  userVariables,
  workspaceVariables,
  agentQuotaUsage,
  creditUsage,
  models,
  triggers,
  workflowNodes,
  workflowEdges,
} from '../database/schema.js';
import type { agents } from '../database/schema.js';
import { createLogger } from '@oao/shared';
import { decrypt } from '@oao/shared';
import { getRedisConnection } from './redis.js';
import { CopilotClient, approveAll } from '@github/copilot-sdk';
import { prepareAgentWorkspace, prepareDbAgentWorkspace } from './agent-workspace.js';
import { createAgentTools } from './agent-tools.js';
import { resolveAgentToolSelection } from './agent-tool-selection.js';
import { renderTemplate, buildTemplateContext } from './jinja-renderer.js';
import { loadConfiguredMcpTools } from './platform-mcp.js';
import { resolveUserModelSession } from './user-models.js';
import { checkLlmCreditQuota } from './quota-enforcement.js';
import { publishRealtimeEvent } from './realtime-bus.js';
import { publishAgentSessionEvent, workflowStepScope } from './agent-session-events.js';

const logger = createLogger('workflow-engine');

// ─── Redis Distributed Session Lock ──────────────────────────────────

const SESSION_LOCK_PREFIX = 'agent-session-lock:';
const SESSION_LOCK_TTL_SECONDS = 600; // 10 minutes
const SESSION_LOCK_WAIT_SECONDS = parseInt(process.env.AGENT_SESSION_LOCK_WAIT_SECONDS || '60', 10);
const SESSION_LOCK_POLL_MS = 1000;

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
      `GitHub Copilot Token / LLM API Key does not support credential subtype "${credentialSubType}" for variable ${credential.key}. Use a GitHub Token or Secret Text credential instead.`,
    );
  }
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

  // If a trigger is associated and it has a configured entry node, propagate
  // it so the graph engine can route execution directly to that node.
  let resolvedTriggerMetadata: Record<string, unknown> = triggerMetadata;
  if (triggerId) {
    const trigger = await db.query.triggers.findFirst({ where: eq(triggers.id, triggerId) });
    if (trigger?.entryNodeKey) {
      resolvedTriggerMetadata = { ...triggerMetadata, _entryNodeKey: trigger.entryNodeKey };
    }
  }

  const [steps, nodes, edges, workflowTriggers] = await Promise.all([
    db.query.workflowSteps.findMany({
      where: eq(workflowSteps.workflowId, workflowId),
      orderBy: workflowSteps.stepOrder,
    }),
    db.query.workflowNodes.findMany({
      where: eq(workflowNodes.workflowId, workflowId),
      orderBy: [asc(workflowNodes.positionY), asc(workflowNodes.positionX), asc(workflowNodes.nodeKey)],
    }),
    db.query.workflowEdges.findMany({
      where: eq(workflowEdges.workflowId, workflowId),
      orderBy: [asc(workflowEdges.fromNodeKey), asc(workflowEdges.toNodeKey)],
    }),
    db.query.triggers.findMany({
      where: eq(triggers.workflowId, workflowId),
      orderBy: [asc(triggers.createdAt)],
    }),
  ]);

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
    nodes: nodes.map((node) => ({ ...node })),
    edges: edges.map((edge) => ({ ...edge })),
    triggers: workflowTriggers.map((trigger) => ({
      id: trigger.id,
      triggerType: trigger.triggerType,
      configuration: trigger.configuration,
      isActive: trigger.isActive,
      entryNodeKey: trigger.entryNodeKey,
      positionX: trigger.positionX,
      positionY: trigger.positionY,
    })),
  };

  // Create execution record
  const [execution] = await db
    .insert(workflowExecutions)
    .values({
      workflowId,
      triggerId,
      triggerMetadata: resolvedTriggerMetadata,
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

/** Create a fresh graph execution that records which failed execution it retries. */
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

  for (const step of steps) {
    await db.insert(stepExecutions).values({
      workflowExecutionId: newExecution.id,
      workflowStepId: step.id,
      stepOrder: step.stepOrder,
      status: 'pending',
    });
  }

  await getQueue().add(
    'execute-workflow',
    {
      executionId: newExecution.id,
      workflowId: workflow.id,
    },
    { jobId: `exec-${newExecution.id}` },
  );

  logger.info(
    { executionId: newExecution.id, retryOf: failedExecutionId },
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
  nodeExecutionId?: string;
  nodeKey?: string;
  templateExtra?: Record<string, unknown>;
  onProgress?: (events: LiveOutputEvent[]) => void | Promise<void>;
}): Promise<{ output: string; resolvedPrompt: string; reasoningTrace: Record<string, unknown> }> {
  const { agent, step, stepExecutionId, resolvedPrompt: rawPrompt, precedentOutput, credentials, properties, envVariables, workerRuntime, inputs, workflowId, workspaceId, executionId, userId, workflowDefaultModel, workflowDefaultReasoningEffort, nodeExecutionId, nodeKey, templateExtra, onProgress } = params;

  // Render prompt template using Jinja2 (nunjucks) with full variable context
  const templateContext = buildTemplateContext({
    properties,
    credentials,
    envVariables,
    precedentOutput,
    inputs,
    extra: templateExtra,
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

    // Resolve Copilot / BYOK token: used for GitHub provider auth or custom provider auth.
    if (agent.copilotTokenCredentialId) {
      const copilotCredential = await resolveScopedCredentialById({
        credentialId: agent.copilotTokenCredentialId,
        agentId: agent.id,
        userId,
        workspaceId,
      });

      if (!copilotCredential) {
        throw new Error('Configured GitHub Copilot Token / LLM API Key credential was not found in agent, user, or workspace variables.');
      }

      ensureSupportedCopilotCredentialSubType(copilotCredential);
      copilotTokenOverride = decrypt(copilotCredential.valueEncrypted);
      if (copilotTokenOverride) {
        logger.info({ agentId: agent.id }, 'Using per-agent Copilot / LLM API credential override');
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
    const agentToolSelection = resolveAgentToolSelection(agent.builtinToolsEnabled);

    const builtInTools = createAgentTools(credentials, {
      agentId: agent.id,
      workflowId,
      executionId,
      stepExecutionId,
      nodeExecutionId,
      nodeKey,
      userId: agent.userId,
      workspaceId,
    }, agentToolSelection.selectedBuiltinToolNames, templateContext);

    const mcpTools = await loadConfiguredMcpTools({
      agent,
      credentials,
      templateContext,
      authContext: {
        agentId: agent.id,
        userId: agent.userId,
        workspaceId,
      },
      enabledToolNames: agentToolSelection.explicitToolSelection ? agentToolSelection.selectedToolNames : undefined,
      mcpCleanups,
      logContext: 'workflow',
    });

    const tools = [...builtInTools, ...mcpTools];

    // 4. Initialize Copilot client + session
    const resolvedModelSession = await resolveUserModelSession({
      userId,
      requestedModel: step.model ?? workflowDefaultModel,
      envDefaultModel: process.env.DEFAULT_AGENT_MODEL,
      authToken: copilotTokenOverride ?? process.env.DEFAULT_LLM_API_KEY ?? process.env.GITHUB_TOKEN ?? null,
    });

    const quotaCheck = await checkLlmCreditQuota({
      workspaceId,
      userId,
      requestedModel: resolvedModelSession.modelName,
      envDefaultModel: process.env.DEFAULT_AGENT_MODEL,
    });
    if (!quotaCheck.allowed) {
      throw new Error(quotaCheck.message);
    }

    // ── Auth source resolution for Copilot SDK ──────────────────────────────
    const isGithubProvider = !resolvedModelSession.provider;
    const fallbackEnvToken = process.env.DEFAULT_LLM_API_KEY || process.env.GITHUB_TOKEN || '';
    const hasAgentOverride = typeof copilotTokenOverride === 'string' && copilotTokenOverride.length > 0;
    const githubTokenForClient = hasAgentOverride
      ? copilotTokenOverride!
      : (fallbackEnvToken || '');
    const authSource = hasAgentOverride
      ? 'agent_credential'
      : (process.env.DEFAULT_LLM_API_KEY ? 'env_default_llm_api_key' : (process.env.GITHUB_TOKEN ? 'env_github_token' : 'none'));

    logger.info({
      agentId: agent.id,
      agentName: agent.name,
      model: resolvedModelSession.modelName,
      providerType: isGithubProvider ? 'github' : `custom:${resolvedModelSession.modelRecord.customProviderType}`,
      copilotTokenCredentialId: agent.copilotTokenCredentialId ?? null,
      hasAgentOverride,
      hasFallbackEnvToken: !!fallbackEnvToken,
      authSource,
      tokenLength: githubTokenForClient.length,
    }, 'Resolving Copilot SDK auth for workflow step');

    if (isGithubProvider && !githubTokenForClient) {
      throw new Error(
        `No Copilot / LLM authentication is available for model "${resolvedModelSession.modelName}". ` +
        `Configure a GitHub Copilot Token / LLM API Key credential on agent "${agent.name}" ` +
        `(or set DEFAULT_LLM_API_KEY / GITHUB_TOKEN on the OAO server).`,
      );
    }

    const client = isGithubProvider
      ? new CopilotClient({ githubToken: githubTokenForClient })
      : new CopilotClient();
    const model = resolvedModelSession.modelName;

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

    if (resolvedModelSession.provider) {
      sessionOptions.provider = resolvedModelSession.provider;
    }

    // Pass reasoning effort if specified on the step or workflow default
    const resolvedReasoning = step.reasoningEffort ?? workflowDefaultReasoningEffort;
    if (resolvedReasoning) {
      (sessionOptions as Record<string, unknown>).reasoningEffort = resolvedReasoning;
    }

    let session: Awaited<ReturnType<typeof client.createSession>>;
    try {
      session = await client.createSession(sessionOptions as unknown as Parameters<typeof client.createSession>[0]);
    } catch (sessionError) {
      const err = sessionError as { name?: string; message?: string; code?: unknown; stack?: string; cause?: unknown };
      logger.error({
        agentId: agent.id,
        agentName: agent.name,
        model,
        providerType: isGithubProvider ? 'github' : `custom:${resolvedModelSession.modelRecord.customProviderType}`,
        copilotTokenCredentialId: agent.copilotTokenCredentialId ?? null,
        authSource,
        tokenLength: githubTokenForClient.length,
        errorName: err?.name,
        errorMessage: err?.message,
        errorCode: err?.code,
        errorStack: err?.stack,
        errorCause: err?.cause ? String(err.cause) : undefined,
      }, 'client.createSession() threw (workflow step)');
      throw new Error(
        `Failed to create Copilot session for agent "${agent.name}" (model "${model}", ` +
        `auth source "${authSource}", credential id ${agent.copilotTokenCredentialId ?? 'n/a'}): ` +
        `${err?.name ?? 'Error'}: ${err?.message ?? String(sessionError)}`,
        { cause: sessionError },
      );
    }

    // Soft auth-status logging (informational only — see conversation-service for rationale).
    if (isGithubProvider) {
      try {
        const authStatus = await (client as unknown as { getAuthStatus(): Promise<{ authenticated: boolean; authType?: string; user?: { login?: string } }> }).getAuthStatus();
        logger.info({
          agentId: agent.id,
          model,
          authenticated: authStatus?.authenticated,
          authType: authStatus?.authType,
          githubLogin: authStatus?.user?.login,
        }, 'Copilot CLI auth status (informational)');
      } catch (authStatusError) {
        logger.warn({ agentId: agent.id, error: (authStatusError as Error)?.message }, 'getAuthStatus check skipped');
      }
    }

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

    // Build agent.* event scope for the unified streaming UI.
    const agentScope = stepExecutionId
      ? workflowStepScope({
          stepExecutionId,
          workflowExecutionId: executionId,
          workflowId,
          workspaceId,
          stepOrder: step.stepOrder,
        })
      : null;
    const graphNodeEventData = nodeKey ? { nodeKey, nodeExecutionId } : {};

    session.on('tool.execution_start', (event) => {
      const toolName = event.data?.toolName ?? 'unknown';
      toolCalls.push({ tool: toolName, args: event.data?.arguments });
      pushLiveEvent({ type: 'tool_call_start', timestamp: new Date().toISOString(), tool: toolName, args: event.data?.arguments });
      if (agentScope) {
        void publishAgentSessionEvent(agentScope, 'tool.execution_start', {
          ...graphNodeEventData,
          toolName,
          toolCallId: event.data?.toolCallId,
          arguments: event.data?.arguments,
        });
      }
    });

    session.on('tool.execution_complete', (event) => {
      pushLiveEvent({ type: 'tool_call_end', timestamp: new Date().toISOString(), tool: event.data?.toolCallId ?? 'unknown', result: event.data?.success });
      if (agentScope) {
        void publishAgentSessionEvent(agentScope, 'tool.execution_complete', {
          ...graphNodeEventData,
          toolCallId: event.data?.toolCallId,
          success: event.data?.success,
        });
      }
    });

    session.on('assistant.message_delta', (event) => {
      const delta = event.data?.deltaContent ?? '';
      pushLiveEvent({ type: 'message_delta', timestamp: new Date().toISOString(), content: delta });
      if (agentScope && delta) {
        void publishAgentSessionEvent(agentScope, 'message.delta', { ...graphNodeEventData, delta });
      }
    });

    // SDK reasoning events: forward into agent.* stream so the shared UI can render them.
    (session as unknown as { on(name: string, cb: (e: { data?: { delta?: string; deltaContent?: string; reasoning?: string } }) => void): void }).on(
      'assistant.reasoning_delta',
      (event) => {
        const reasoning = event.data?.delta ?? event.data?.deltaContent ?? event.data?.reasoning ?? '';
        if (agentScope && reasoning) {
          void publishAgentSessionEvent(agentScope, 'message.reasoning_delta', { ...graphNodeEventData, delta: reasoning });
        }
      },
    );

    session.on('assistant.turn_start', () => {
      pushLiveEvent({ type: 'turn_start', timestamp: new Date().toISOString() });
      if (agentScope) {
        void publishAgentSessionEvent(agentScope, 'turn.started', graphNodeEventData);
        void publishAgentSessionEvent(agentScope, 'message.started', graphNodeEventData);
      }
    });

    session.on('assistant.turn_end', () => {
      pushLiveEvent({ type: 'turn_end', timestamp: new Date().toISOString() });
      if (agentScope) {
        void publishAgentSessionEvent(agentScope, 'turn.completed', graphNodeEventData);
      }
    });

    // 6. Send prompt and wait for response.
    // If ask_questions is enabled for this agent, give the session enough headroom
    // to wait for the user (ask_questions has its own per-call timeout up to 3600s).
    const baseTimeoutMs = (step.timeoutSeconds ?? 300) * 1000;
    const askQuestionsEnabled = agentToolSelection.selectedBuiltinToolNames.includes('ask_questions');
    const timeoutMs = askQuestionsEnabled
      ? Math.max(baseTimeoutMs, 60 * 60 * 1000) // 1 hour minimum when interactive
      : baseTimeoutMs;
    let response;
    try {
      response = await session.sendAndWait({ prompt: resolvedPrompt }, timeoutMs);
    } catch (sendError) {
      const err = sendError as { name?: string; message?: string; code?: unknown; stack?: string; cause?: unknown };
      logger.error({
        agentId: agent.id,
        agentName: agent.name,
        model,
        providerType: isGithubProvider ? 'github' : `custom:${resolvedModelSession.modelRecord.customProviderType}`,
        copilotTokenCredentialId: agent.copilotTokenCredentialId ?? null,
        authSource,
        tokenLength: githubTokenForClient.length,
        reasoningEffort: resolvedReasoning,
        errorName: err?.name,
        errorMessage: err?.message,
        errorCode: err?.code,
        errorStack: err?.stack,
        errorCause: err?.cause ? String(err.cause) : undefined,
      }, 'session.sendAndWait() threw (workflow step)');
      try { await session.disconnect(); } catch { /* ignore */ }
      try { await client.stop(); } catch { /* ignore */ }
      const detailHints: string[] = [];
      const lowerMessage = (err?.message ?? '').toLowerCase();
      if (lowerMessage.includes('not created with authentication')) {
        detailHints.push(
          `Verify the GitHub Copilot Token credential (id: ${agent.copilotTokenCredentialId ?? 'n/a'}) ` +
          `is a non-expired token with Copilot access, or set DEFAULT_LLM_API_KEY / GITHUB_TOKEN on the server.`,
        );
      }
      if (lowerMessage.includes('reasoning') || lowerMessage.includes('effort')) {
        detailHints.push(
          `The model "${model}" may not accept reasoning_effort="${resolvedReasoning}". ` +
          `Update the model's supported reasoning efforts in Admin > Models.`,
        );
      }
      throw new Error(
        `Copilot session failed for agent "${agent.name}" (model "${model}", ` +
        `reasoning ${resolvedReasoning ?? 'unset'}, auth source "${authSource}"): ` +
        `${err?.name ?? 'Error'}: ${err?.message ?? String(sendError)}` +
        (detailHints.length ? ` — ${detailHints.join(' ')}` : ''),
        { cause: sendError },
      );
    }

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
      const modelRecord = userId
        ? await db.query.models.findFirst({
            where: and(eq(models.name, model), eq(models.userId, userId)),
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
    for (const cleanup of mcpCleanups) {
      try { await cleanup(); } catch { /* ignore */ }
    }
    if (workspace) {
      await workspace.cleanup();
    }
    await releaseSessionLock(agent.id, lockValue);
  }
}
