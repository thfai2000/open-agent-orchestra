import { CopilotClient, approveAll } from '@github/copilot-sdk';
import { and, desc, eq, sql } from 'drizzle-orm';
import { createLogger, decrypt } from '@oao/shared';
import { db } from '../database/index.js';
import {
  agentQuotaUsage,
  agents,
  agentVariables,
  conversations,
  conversationMessages,
  creditUsage,
  models,
  userVariables,
  workspaceVariables,
} from '../database/schema.js';
import { prepareAgentWorkspace, prepareDbAgentWorkspace } from './agent-workspace.js';
import { createAgentTools } from './agent-tools.js';
import { buildTemplateContext } from './jinja-renderer.js';
import { loadConfiguredMcpTools } from './platform-mcp.js';
import { publishRealtimeEvent } from './realtime-bus.js';
import { getRedisConnection } from './redis.js';

const logger = createLogger('conversation-service');

const SESSION_LOCK_PREFIX = 'agent-session-lock:';
const SESSION_LOCK_TTL_SECONDS = 600;
const SESSION_LOCK_WAIT_SECONDS = parseInt(process.env.AGENT_SESSION_LOCK_WAIT_SECONDS || '60', 10);
const SESSION_LOCK_POLL_MS = 1000;
const WORKFLOW_CONTEXT_REQUIRED_TOOLS = new Set([
  'schedule_next_workflow_execution',
  'manage_webhook_trigger',
  'edit_workflow',
]);
const MAX_TRANSCRIPT_MESSAGES = 40;
const DEFAULT_CONVERSATION_TIMEOUT_SECONDS = parseInt(process.env.DEFAULT_CONVERSATION_TIMEOUT_SECONDS || '300', 10);

interface SessionLockInfo {
  agentId: string;
  agentName: string;
  executionId: string;
  workflowId: string;
  workerRuntime: 'static' | 'ephemeral';
  stepName: string;
  acquiredAt: string;
  stepExecutionId?: string;
  conversationId?: string;
}

interface ResolvedScopedCredential {
  key: string;
  valueEncrypted: string;
  credentialSubType: string | null;
}

interface ConversationTranscriptMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
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

async function acquireSessionLock(agentId: string, info: SessionLockInfo): Promise<string | null> {
  const redis = getRedisConnection();
  const key = `${SESSION_LOCK_PREFIX}${agentId}`;
  const lockValue = buildSessionLockValue(info);
  const result = await redis.set(key, lockValue, 'EX', SESSION_LOCK_TTL_SECONDS, 'NX');
  return result === 'OK' ? lockValue : null;
}

async function releaseSessionLock(agentId: string, lockValue: string): Promise<void> {
  const redis = getRedisConnection();
  const key = `${SESSION_LOCK_PREFIX}${agentId}`;
  const current = await redis.get(key);
  if (current === lockValue) {
    await redis.del(key);
  }
}

async function extendSessionLock(agentId: string): Promise<void> {
  const redis = getRedisConnection();
  const key = `${SESSION_LOCK_PREFIX}${agentId}`;
  await redis.expire(key, SESSION_LOCK_TTL_SECONDS);
}

async function acquireSessionLockWithWait(agentId: string, info: SessionLockInfo): Promise<{ lockValue: string | null; blockingSession: SessionLockInfo | null }> {
  const waitDeadline = Date.now() + SESSION_LOCK_WAIT_SECONDS * 1000;
  let blockingSession: SessionLockInfo | null = null;

  while (Date.now() < waitDeadline) {
    const lockValue = await acquireSessionLock(agentId, info);
    if (lockValue) return { lockValue, blockingSession: null };

    blockingSession = await getSessionLockInfo(agentId);
    if (Date.now() + SESSION_LOCK_POLL_MS > waitDeadline) break;
    await sleep(SESSION_LOCK_POLL_MS);
  }

  return { lockValue: null, blockingSession };
}

function buildBusyError(agent: typeof agents.$inferSelect, blockingSession: SessionLockInfo | null): string {
  if (!blockingSession) {
    return `Agent ${agent.name} (${agent.id}) is still busy after waiting ${SESSION_LOCK_WAIT_SECONDS}s for its active Copilot session to finish.`;
  }

  const owner = blockingSession.conversationId
    ? `conversation ${blockingSession.conversationId}`
    : blockingSession.executionId
      ? `execution ${blockingSession.executionId}`
      : 'another session';

  return `Agent ${agent.name} (${agent.id}) is still busy after waiting ${SESSION_LOCK_WAIT_SECONDS}s for its active Copilot session to finish. Current owner: ${owner}, acquired at ${blockingSession.acquiredAt}.`;
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

async function resolveConversationVariables(params: {
  agentId: string;
  userId: string;
  workspaceId: string;
}): Promise<{
  credentials: Map<string, string>;
  properties: Map<string, string>;
  envVariables: Map<string, string>;
}> {
  const [workspaceVars, userVars, agentVars] = await Promise.all([
    db.query.workspaceVariables.findMany({
      where: eq(workspaceVariables.workspaceId, params.workspaceId),
    }),
    db.query.userVariables.findMany({
      where: eq(userVariables.userId, params.userId),
    }),
    db.query.agentVariables.findMany({
      where: eq(agentVariables.agentId, params.agentId),
    }),
  ]);

  const workspaceCredentialMap = new Map(
    workspaceVars
      .filter((variable) => variable.variableType === 'credential')
      .map((variable) => [variable.key, decrypt(variable.valueEncrypted)] as [string, string]),
  );
  const workspacePropertyMap = new Map(
    workspaceVars
      .filter((variable) => variable.variableType === 'property')
      .map((variable) => [variable.key, decrypt(variable.valueEncrypted)] as [string, string]),
  );
  const workspaceEnvVarMap = new Map(
    workspaceVars
      .filter((variable) => variable.injectAsEnvVariable)
      .map((variable) => [variable.key, decrypt(variable.valueEncrypted)] as [string, string]),
  );

  const userCredentialMap = new Map([
    ...workspaceCredentialMap,
    ...userVars
      .filter((variable) => variable.variableType === 'credential')
      .map((variable) => [variable.key, decrypt(variable.valueEncrypted)] as [string, string]),
  ]);
  const userPropertyMap = new Map([
    ...workspacePropertyMap,
    ...userVars
      .filter((variable) => variable.variableType === 'property')
      .map((variable) => [variable.key, decrypt(variable.valueEncrypted)] as [string, string]),
  ]);
  const userEnvVarMap = new Map([
    ...workspaceEnvVarMap,
    ...userVars
      .filter((variable) => variable.injectAsEnvVariable)
      .map((variable) => [variable.key, decrypt(variable.valueEncrypted)] as [string, string]),
  ]);

  const mergedCredentials = new Map(userCredentialMap);
  const mergedProperties = new Map(userPropertyMap);
  const mergedEnvVars = new Map(userEnvVarMap);

  for (const variable of agentVars) {
    const decrypted = decrypt(variable.valueEncrypted);
    if (variable.variableType === 'credential') mergedCredentials.set(variable.key, decrypted);
    if (variable.variableType === 'property') mergedProperties.set(variable.key, decrypted);
    if (variable.injectAsEnvVariable) mergedEnvVars.set(variable.key, decrypted);
  }

  return {
    credentials: mergedCredentials,
    properties: mergedProperties,
    envVariables: mergedEnvVars,
  };
}

function buildConversationPrompt(messages: ConversationTranscriptMessage[]): string {
  const boundedMessages = messages.slice(-MAX_TRANSCRIPT_MESSAGES);
  const transcript = boundedMessages
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}:\n${message.content}`)
    .join('\n\n');

  return [
    'You are continuing an interactive conversation with the user.',
    'Use the full conversation history below for context, but respond only as the assistant to the latest user message.',
    'Do not repeat the transcript or role labels in your final answer.',
    'Conversation history:',
    transcript,
  ].join('\n\n');
}

async function runConversationSession(params: {
  agent: typeof agents.$inferSelect;
  conversationId: string;
  assistantMessageId: string;
  prompt: string;
  credentials: Map<string, string>;
  properties: Map<string, string>;
  envVariables: Map<string, string>;
  userId: string;
  workspaceId: string;
  enabledTools: string[];
  onProgress?: (events: Array<{ type: string; content?: string }>) => Promise<void> | void;
}): Promise<{ output: string; model: string; reasoningTrace: Record<string, unknown> }> {
  const {
    agent,
    conversationId,
    assistantMessageId,
    prompt,
    credentials,
    properties,
    envVariables,
    userId,
    workspaceId,
    enabledTools,
    onProgress,
  } = params;

  const { lockValue, blockingSession } = await acquireSessionLockWithWait(agent.id, {
    agentId: agent.id,
    agentName: agent.name,
    executionId: `conversation:${conversationId}`,
    workflowId: '',
    workerRuntime: 'static',
    stepName: `Conversation ${conversationId}`,
    conversationId,
    acquiredAt: new Date().toISOString(),
  });

  if (!lockValue) {
    throw new Error(buildBusyError(agent, blockingSession));
  }

  const lockExtendTimer = setInterval(() => {
    extendSessionLock(agent.id).catch((error) => {
      logger.warn({ agentId: agent.id, error }, 'Failed to extend conversation session lock');
    });
  }, 5 * 60 * 1000);

  let workspace: Awaited<ReturnType<typeof prepareAgentWorkspace>> | Awaited<ReturnType<typeof prepareDbAgentWorkspace>> | null = null;
  const toolCalls: Array<{ tool: string; args: unknown }> = [];
  const mcpCleanups: Array<() => Promise<void>> = [];
  const originalGithubToken = process.env.GITHUB_TOKEN;
  let copilotTokenOverride: string | null = null;

  try {
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

    if (envVariables.size > 0 && workspace.workdir) {
      const { writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const envContent = [...envVariables.entries()].map(([key, value]) => `${key}=${value}`).join('\n');
      await writeFile(join(workspace.workdir, '.env'), envContent, 'utf-8');
    }

    const skillsContent = workspace.skills.length
      ? `\n\n## Agent Skills\n\n${workspace.skills.join('\n\n---\n\n')}`
      : '';
    const systemContent = `${workspace.agentMarkdown}${skillsContent}`;
    const templateContext = buildTemplateContext({ properties, credentials, envVariables });

    const builtInTools = createAgentTools(
      credentials,
      {
        agentId: agent.id,
        workflowId: '',
        executionId: `conversation:${conversationId}`,
        userId,
        workspaceId,
      },
      enabledTools,
      templateContext,
    );

    const mcpTools = await loadConfiguredMcpTools({
      agent,
      credentials,
      templateContext,
      authContext: {
        agentId: agent.id,
        userId,
        workspaceId,
      },
      mcpCleanups,
      logContext: 'conversation',
    });

    const allTools = [...builtInTools, ...mcpTools];

    if (copilotTokenOverride) {
      process.env.GITHUB_TOKEN = copilotTokenOverride;
    }

    const client = new CopilotClient();
    const model = process.env.DEFAULT_AGENT_MODEL ?? 'gpt-4.1';
    const session = await client.createSession({
      model,
      tools: allTools,
      onPermissionRequest: approveAll,
      systemMessage: {
        mode: 'customize',
        sections: {
          code_change_rules: { action: 'remove' },
          guidelines: {
            action: 'append',
            content:
              '\n* You are in an interactive user conversation, not a workflow step.\n* Continue the conversation naturally, using tools when they are helpful.\n* Some workflow-management tools are intentionally unavailable in this context.',
          },
        },
        content: systemContent,
      },
    } as Parameters<typeof client.createSession>[0]);

    const liveEvents: Array<{ type: string; content?: string }> = [];
    let progressFlushTimer: ReturnType<typeof setInterval> | null = null;
    let lastFlushedLength = 0;

    const pushLiveEvent = (event: { type: string; content?: string }) => {
      liveEvents.push(event);
    };

    if (onProgress) {
      progressFlushTimer = setInterval(async () => {
        if (liveEvents.length > lastFlushedLength) {
          lastFlushedLength = liveEvents.length;
          try {
            await onProgress([...liveEvents]);
          } catch {
            // ignore streaming flush errors
          }
        }
      }, 2000);
    }

    session.on('tool.execution_start', (event) => {
      const toolName = event.data?.toolName ?? 'unknown';
      toolCalls.push({ tool: toolName, args: event.data?.arguments });
    });

    session.on('assistant.message_delta', (event) => {
      const deltaContent = event.data?.deltaContent ?? '';
      if (deltaContent) {
        pushLiveEvent({ type: 'message_delta', content: deltaContent });
      }
    });

    const response = await session.sendAndWait({ prompt }, DEFAULT_CONVERSATION_TIMEOUT_SECONDS * 1000);
    const output = response?.data?.content ?? '[No response from Copilot session]';

    if (progressFlushTimer) clearInterval(progressFlushTimer);
    if (onProgress && liveEvents.length > lastFlushedLength) {
      try {
        await onProgress([...liveEvents]);
      } catch {
        // ignore final streaming flush errors
      }
    }

    await session.disconnect();
    await client.stop();

    try {
      const today = new Date().toISOString().split('T')[0];
      await db
        .insert(agentQuotaUsage)
        .values({
          agentId: agent.id,
          date: today,
          promptTokensUsed: prompt.length,
          completionTokensUsed: output.length,
          sessionCount: 1,
        })
        .onConflictDoUpdate({
          target: [agentQuotaUsage.agentId, agentQuotaUsage.date],
          set: {
            promptTokensUsed: sql`${agentQuotaUsage.promptTokensUsed} + ${prompt.length}`,
            completionTokensUsed: sql`${agentQuotaUsage.completionTokensUsed} + ${output.length}`,
            sessionCount: sql`${agentQuotaUsage.sessionCount} + 1`,
          },
        });
    } catch (error) {
      logger.warn({ error, conversationId }, 'Failed to update agent quota usage for conversation');
    }

    try {
      const today = new Date().toISOString().split('T')[0];
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
    } catch (error) {
      logger.warn({ error, conversationId }, 'Failed to update credit usage for conversation');
    }

    return {
      output,
      model,
      reasoningTrace: {
        conversationId,
        assistantMessageId,
        workerRuntime: 'static',
        agentFile: agent.agentFilePath,
        skills: agent.skillsPaths,
        promptTokens: prompt.length,
        completionTokens: output.length,
        toolCalls,
      },
    };
  } finally {
    clearInterval(lockExtendTimer);
    if (copilotTokenOverride) {
      if (originalGithubToken !== undefined) {
        process.env.GITHUB_TOKEN = originalGithubToken;
      } else {
        delete process.env.GITHUB_TOKEN;
      }
    }

    for (const cleanup of mcpCleanups) {
      try {
        await cleanup();
      } catch {
        // ignore cleanup failures
      }
    }

    if (workspace) {
      await workspace.cleanup();
    }

    await releaseSessionLock(agent.id, lockValue);
  }
}

function extractDelta(events: Array<{ type: string; content?: string }>, startIndex: number): string {
  return events
    .slice(startIndex)
    .filter((event) => event.type === 'message_delta' && event.content)
    .map((event) => event.content)
    .join('');
}

export async function sendConversationMessage(params: {
  conversation: typeof conversations.$inferSelect;
  content: string;
  userId: string;
  workspaceId: string;
}): Promise<{
  userMessage: typeof conversationMessages.$inferSelect;
  assistantMessage: typeof conversationMessages.$inferSelect;
}> {
  const { conversation, content, userId, workspaceId } = params;

  if (!conversation.agentId) {
    throw new Error('This conversation is no longer linked to an active agent. Start a new conversation to continue chatting.');
  }

  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, conversation.agentId),
  });

  if (!agent || agent.workspaceId !== workspaceId) {
    throw new Error('Agent not found for this conversation.');
  }

  if (agent.status !== 'active') {
    throw new Error(`Agent ${agent.name} is not active. Activate it before continuing the conversation.`);
  }

  const existingPending = await db.query.conversationMessages.findFirst({
    where: and(
      eq(conversationMessages.conversationId, conversation.id),
      eq(conversationMessages.role, 'assistant'),
      eq(conversationMessages.status, 'pending'),
    ),
  });

  if (existingPending) {
    throw new Error('This conversation already has an assistant response in progress. Wait for it to finish before sending another message.');
  }

  const now = new Date();
  const [userMessage] = await db
    .insert(conversationMessages)
    .values({
      conversationId: conversation.id,
      role: 'user',
      status: 'completed',
      content,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const [assistantMessage] = await db
    .insert(conversationMessages)
    .values({
      conversationId: conversation.id,
      role: 'assistant',
      status: 'pending',
      content: '',
      metadata: {},
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await db
    .update(conversations)
    .set({ lastMessageAt: now, updatedAt: now })
    .where(eq(conversations.id, conversation.id));

  publishRealtimeEvent({
    type: 'conversation.message.started',
    conversationId: conversation.id,
    messageId: assistantMessage.id,
    workspaceId,
    timestamp: now.toISOString(),
    data: {
      agentId: agent.id,
      agentName: agent.name,
      userMessageId: userMessage.id,
    },
  });

  const transcriptRows = await db.query.conversationMessages.findMany({
    where: and(
      eq(conversationMessages.conversationId, conversation.id),
      eq(conversationMessages.status, 'completed'),
    ),
    orderBy: [desc(conversationMessages.createdAt)],
  });

  const transcript = transcriptRows
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
    }))
    .reverse();

  const prompt = buildConversationPrompt(transcript);
  const { credentials, properties, envVariables } = await resolveConversationVariables({
    agentId: agent.id,
    userId,
    workspaceId,
  });

  const enabledTools = ((agent.builtinToolsEnabled as string[]) ?? []).filter(
    (toolName) => !WORKFLOW_CONTEXT_REQUIRED_TOOLS.has(toolName),
  );

  let streamedLength = 0;
  let streamedContent = '';

  try {
    const result = await runConversationSession({
      agent,
      conversationId: conversation.id,
      assistantMessageId: assistantMessage.id,
      prompt,
      credentials,
      properties,
      envVariables,
      userId,
      workspaceId,
      enabledTools,
      onProgress: async (events) => {
        const delta = extractDelta(events, streamedLength);
        streamedLength = events.length;
        if (!delta) return;

        streamedContent += delta;

        await db
          .update(conversationMessages)
          .set({
            content: streamedContent,
            updatedAt: new Date(),
          })
          .where(eq(conversationMessages.id, assistantMessage.id));

        publishRealtimeEvent({
          type: 'conversation.message.delta',
          conversationId: conversation.id,
          messageId: assistantMessage.id,
          workspaceId,
          timestamp: new Date().toISOString(),
          data: { delta },
        });
      },
    });

    const [updatedAssistantMessage] = await db
      .update(conversationMessages)
      .set({
        status: 'completed',
        content: result.output,
        model: result.model,
        error: null,
        metadata: result.reasoningTrace,
        updatedAt: new Date(),
      })
      .where(eq(conversationMessages.id, assistantMessage.id))
      .returning();

    await db
      .update(conversations)
      .set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(conversations.id, conversation.id));

    publishRealtimeEvent({
      type: 'conversation.message.completed',
      conversationId: conversation.id,
      messageId: assistantMessage.id,
      workspaceId,
      timestamp: new Date().toISOString(),
      data: {
        content: updatedAssistantMessage.content,
        model: updatedAssistantMessage.model,
      },
    });

    return {
      userMessage,
      assistantMessage: updatedAssistantMessage,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Conversation failed.';
    const [failedAssistantMessage] = await db
      .update(conversationMessages)
      .set({
        status: 'failed',
        content: streamedContent,
        error: message,
        updatedAt: new Date(),
      })
      .where(eq(conversationMessages.id, assistantMessage.id))
      .returning();

    publishRealtimeEvent({
      type: 'conversation.message.failed',
      conversationId: conversation.id,
      messageId: assistantMessage.id,
      workspaceId,
      timestamp: new Date().toISOString(),
      data: { error: message },
    });

    throw Object.assign(new Error(message), { assistantMessage: failedAssistantMessage, userMessage });
  }
}