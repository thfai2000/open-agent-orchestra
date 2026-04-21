// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck — Copilot SDK's Tool/defineTool generics have incompatible Zod type constraints
import { defineTool, type Tool } from '@github/copilot-sdk';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { createLogger, encrypt } from '@oao/shared';
import { db } from '../database/index.js';
import {
  triggers, webhookRegistrations, agentDecisions, agentMemories,
  workflows, workflowSteps, agentVariables, userVariables, agents,
} from '../database/schema.js';
import { generateEmbedding } from './embedding-service.js';
import { renderTemplate } from './jinja-renderer.js';
import { TriggerServiceError } from './trigger-errors.js';
import { creatableTriggerTypeSchema } from './trigger-definitions.js';
import { createWorkflowTrigger, deleteWorkflowTrigger, updateWorkflowTrigger } from './trigger-manager.js';
import {
  captureAgentHistoricalVersion,
  captureWorkflowHistoricalVersion,
  captureVariableHistoricalVersion,
} from './versioning.js';

const logger = createLogger('agent-tools');

async function loadWorkflowForHistory(workflowId: string) {
  if (!db.query?.workflows?.findFirst) return null;
  return db.query.workflows.findFirst({ where: eq(workflows.id, workflowId) });
}

async function bumpWorkflowVersion(workflowId: string) {
  await db
    .update(workflows)
    .set({ version: sql`${workflows.version} + 1`, updatedAt: new Date() })
    .where(eq(workflows.id, workflowId));
}

async function loadAgentForHistory(agentId: string) {
  if (!db.query?.agents?.findFirst) return null;
  return db.query.agents.findFirst({ where: eq(agents.id, agentId) });
}

async function bumpAgentVersion(agentId: string) {
  await db
    .update(agents)
    .set({ version: sql`${agents.version} + 1`, updatedAt: new Date() })
    .where(eq(agents.id, agentId));
}

/**
 * Context for tools that interact with the agent's own resources.
 */
export interface AgentToolContext {
  agentId: string;
  workflowId: string;
  executionId?: string;
  userId?: string;
  workspaceId?: string;
}

/**
 * Creates the set of **built-in** tools available to agents during Copilot sessions.
 *
 * These tools operate on the open-agent-orchestra's own database (agent_db).
 * Domain-specific tools are provided externally via MCP servers configured per-agent.
 *
 * Built-in tools:
 *   - record_decision                    — Audit trail for agent decisions
 *   - schedule_next_workflow_execution  — Self-scheduling (exact datetime triggers)
 *   - manage_webhook_trigger             — Webhook lifecycle management
 *   - memory_store           — Store semantic memories (pgvector)
 *   - memory_retrieve        — Retrieve memories via similarity search
 *   - edit_workflow           — Edit workflow triggers and steps
 *   - read_variables          — Read agent/user variables
 *   - edit_variables          — Create/update/delete variables
 */
export function createAgentTools(
  _credentials: Map<string, string>,
  context?: AgentToolContext,
  enabledTools?: string[],
  templateContext?: Record<string, unknown>,
): Tool[] {
  const toolMap: Record<string, Tool> = {};

  // ── Self-Scheduling Tools ────────────────────────────────────────

  toolMap['schedule_next_workflow_execution'] = defineTool('schedule_next_workflow_execution', {
      description:
        'Schedule the next workflow execution at an exact future datetime. Creates or updates an exact_datetime trigger for this workflow. The trigger fires once at the specified time and then deactivates.',
      parameters: z.object({
        datetime: z
          .string()
          .describe('ISO 8601 datetime for when to run next (e.g. "2025-01-15T09:00:00Z")'),
        reason: z.string().optional().describe('Why this schedule was chosen'),
      }),
      handler: async ({
        datetime,
        reason,
      }: {
        datetime: string;
        reason?: string;
      }) => {
        if (!context?.workflowId) return { error: 'No workflow context available' };

        // Validate the datetime
        const scheduledTime = new Date(datetime);
        if (isNaN(scheduledTime.getTime())) return { error: 'Invalid datetime format. Use ISO 8601 format.' };
        if (scheduledTime <= new Date()) return { error: 'Datetime must be in the future.' };

        logger.info({ datetime, workflowId: context.workflowId, reason }, 'Tool: schedule_next_workflow_execution');

        // Check for existing exact_datetime trigger and update it, or create new
        const existing = await db.query.triggers.findFirst({
          where: and(
            eq(triggers.workflowId, context.workflowId),
            eq(triggers.triggerType, 'exact_datetime'),
          ),
        });

        const workflow = await loadWorkflowForHistory(context.workflowId);
        if (workflow) {
          await captureWorkflowHistoricalVersion(workflow, context.userId ?? null);
        }

        if (existing) {
          await db
            .update(triggers)
            .set({
              configuration: { datetime, reason },
              isActive: true,
            })
            .where(eq(triggers.id, existing.id));
          await bumpWorkflowVersion(context.workflowId);
          return { updated: true, triggerId: existing.id, datetime, reason };
        }

        const [newTrigger] = await db
          .insert(triggers)
          .values({
            workflowId: context.workflowId,
            triggerType: 'exact_datetime',
            configuration: { datetime, reason },
            isActive: true,
          })
          .returning({ id: triggers.id });

        await bumpWorkflowVersion(context.workflowId);

        return { created: true, triggerId: newTrigger.id, datetime, reason };
      },
    });

    toolMap['manage_webhook_trigger'] = defineTool('manage_webhook_trigger', {
      description:
        'Create, update, or deactivate a webhook trigger for this agent. Webhook triggers allow external systems to invoke agent workflows.',
      parameters: z.object({
        action: z
          .enum(['create', 'deactivate'])
          .describe('Action to perform on the webhook trigger'),
        endpointPath: z
          .string()
          .optional()
          .describe('Custom endpoint path (e.g. "/my-agent/trade-signal"). Required for create.'),
      }),
      handler: async ({
        action,
        endpointPath,
      }: {
        action: 'create' | 'deactivate';
        endpointPath?: string;
      }) => {
        if (!context?.agentId || !context.workflowId)
          return { error: 'No agent context available' };
        logger.info({ action, endpointPath, agentId: context.agentId }, 'Tool: manage_webhook_trigger');

        if (action === 'deactivate') {
          const existing = await db.query.webhookRegistrations.findFirst({
            where: and(
              eq(webhookRegistrations.agentId, context.agentId),
              eq(webhookRegistrations.isActive, true),
            ),
          });
          if (!existing) return { error: 'No active webhook found for this agent' };
          await db
            .update(webhookRegistrations)
            .set({ isActive: false })
            .where(eq(webhookRegistrations.id, existing.id));
          return { deactivated: true, webhookId: existing.id };
        }

        // Create
        if (!endpointPath) return { error: 'endpointPath is required for create action' };

        const workflow = await loadWorkflowForHistory(context.workflowId);
        if (workflow) {
          await captureWorkflowHistoricalVersion(workflow, context.userId ?? null);
        }

        // Create trigger first
        const [trigger] = await db
          .insert(triggers)
          .values({
            workflowId: context.workflowId,
            triggerType: 'webhook',
            configuration: { endpointPath },
            isActive: true,
          })
          .returning({ id: triggers.id });

        // Generate a simple HMAC secret
        const hmacSecret = crypto.randomUUID() + crypto.randomUUID();
        const { encrypt } = await import('@oao/shared');
        const hmacSecretEncrypted = encrypt(hmacSecret);

        const [webhook] = await db
          .insert(webhookRegistrations)
          .values({
            agentId: context.agentId,
            triggerId: trigger.id,
            endpointPath,
            hmacSecretEncrypted,
            isActive: true,
          })
          .returning({ id: webhookRegistrations.id });

        await bumpWorkflowVersion(context.workflowId);

        return {
          created: true,
          webhookId: webhook.id,
          triggerId: trigger.id,
          endpointPath,
          hmacSecret, // returned once for the caller to configure
        };
      },
    });

    // ── Decision Audit Trail ─────────────────────────────────────────

    toolMap['record_decision'] = defineTool('record_decision', {
      description:
        'Record a decision with reasoning and outcome. Creates an audit trail for post-analysis. Use for any significant agent decision.',
      parameters: z.object({
        category: z.string().describe('Decision category (e.g. "trade", "analysis", "action", "review")'),
        action: z.string().describe('Action taken or recommended (e.g. "buy", "approve", "escalate")'),
        summary: z.string().optional().describe('Brief human-readable summary of the decision'),
        confidence: z.number().min(0).max(1).describe('Confidence level (0-1)'),
        signals: z
          .array(z.string())
          .describe('List of signals or factors that led to this decision'),
        reasoning: z.string().describe('Full reasoning text'),
        details: z.record(z.unknown()).optional().describe('Additional structured data specific to this decision'),
        outcome: z
          .enum(['executed', 'rejected', 'skipped'])
          .optional()
          .describe('What happened with this decision'),
        referenceId: z.string().optional().describe('External reference ID (e.g. order ID, ticket ID)'),
      }),
      handler: async ({
        category,
        action,
        summary,
        confidence,
        signals,
        reasoning,
        details,
        outcome,
        referenceId,
      }: {
        category: string;
        action: string;
        summary?: string;
        confidence: number;
        signals: string[];
        reasoning: string;
        details?: Record<string, unknown>;
        outcome?: string;
        referenceId?: string;
      }) => {
        if (!context?.agentId) return { error: 'No agent context available' };
        logger.info({ category, action, confidence, agentId: context.agentId }, 'Tool: record_decision');

        const [decision] = await db
          .insert(agentDecisions)
          .values({
            agentId: context.agentId,
            executionId: context.executionId,
            category,
            action,
            summary: summary ?? null,
            decision: { confidence, signals, reasoning, details },
            outcome: outcome ?? null,
            referenceId: referenceId ?? null,
          })
          .returning({ id: agentDecisions.id, createdAt: agentDecisions.createdAt });

        return {
          recorded: true,
          decisionId: decision.id,
          createdAt: decision.createdAt,
          category,
          action,
          confidence,
        };
      },
    });

    // ── Vector Memory Tools ──────────────────────────────────────────

    toolMap['memory_store'] = defineTool('memory_store', {
      description:
        'Store a memory with semantic embedding for later retrieval. Use this to remember important observations, insights, strategies, or lessons learned.',
      parameters: z.object({
        content: z.string().describe('The memory content to store (e.g. observation, reasoning, insight)'),
        memoryType: z
          .enum(['observation', 'insight', 'strategy', 'lesson_learned', 'general'])
          .default('general')
          .describe('Type of memory'),
        tags: z.array(z.string()).optional().describe('Tags for filtering (e.g. ["important", "recurring"])'),
        metadata: z.record(z.unknown()).optional().describe('Additional structured data'),
      }),
      handler: async ({
        content,
        memoryType,
        tags,
        metadata,
      }: {
        content: string;
        memoryType: 'observation' | 'insight' | 'strategy' | 'lesson_learned' | 'general';
        tags?: string[];
        metadata?: Record<string, unknown>;
      }) => {
        if (!context?.agentId) return { error: 'No agent context available' };
        logger.info({ agentId: context.agentId, memoryType, tags }, 'Tool: memory_store');

        // Generate embedding for semantic search
        const embedding = await generateEmbedding(content);

        const [memory] = await db
          .insert(agentMemories)
          .values({
            agentId: context.agentId,
            content,
            memoryType,
            tags: tags ?? [],
            metadata: metadata ?? null,
            embedding,
          })
          .returning({ id: agentMemories.id, createdAt: agentMemories.createdAt });

        return {
          stored: true,
          memoryId: memory.id,
          memoryType,
          tags: tags ?? [],
          createdAt: memory.createdAt,
        };
      },
    });

    toolMap['memory_retrieve'] = defineTool('memory_retrieve', {
      description:
        'Retrieve relevant memories using semantic search. Finds memories similar to the query using vector similarity. Use this to recall past observations, decisions, or strategies.',
      parameters: z.object({
        query: z.string().describe('Search query describing what you want to remember'),
        memoryType: z
          .enum(['observation', 'insight', 'strategy', 'lesson_learned', 'general'])
          .optional()
          .describe('Filter by memory type'),
        tags: z.array(z.string()).optional().describe('Filter by tags (matches any)'),
        limit: z.number().min(1).max(20).default(5).describe('Number of memories to retrieve'),
      }),
      skipPermission: true,
      handler: async ({
        query,
        memoryType,
        tags,
        limit,
      }: {
        query: string;
        memoryType?: string;
        tags?: string[];
        limit: number;
      }) => {
        if (!context?.agentId) return { error: 'No agent context available' };
        logger.info({ agentId: context.agentId, query, memoryType, tags, limit }, 'Tool: memory_retrieve');

        // Generate query embedding for similarity search
        const queryEmbedding = await generateEmbedding(query);
        // Validate embedding values are actual numbers to prevent SQL injection
        if (!queryEmbedding.every((v) => typeof v === 'number' && Number.isFinite(v))) {
          return { error: 'Invalid embedding generated' };
        }
        const embeddingStr = `[${queryEmbedding.join(',')}]`;

        // Build pgvector cosine distance query with parameterized conditions
        let baseQuery = sql`
          SELECT
            id,
            content,
            memory_type,
            tags,
            metadata,
            created_at,
            1 - (embedding <=> ${embeddingStr}::vector) AS similarity
          FROM agent_memories
          WHERE agent_id = ${context.agentId}
            AND embedding IS NOT NULL
        `;

        if (memoryType) {
          baseQuery = sql`${baseQuery} AND memory_type = ${memoryType}`;
        }

        if (tags && tags.length > 0) {
          baseQuery = sql`${baseQuery} AND tags && ${tags}::varchar[]`;
        }

        baseQuery = sql`${baseQuery} ORDER BY embedding <=> ${embeddingStr}::vector LIMIT ${limit}`;

        const results = await db.execute(baseQuery);

        const memories = (results.rows ?? results) as Array<{
          id: string;
          content: string;
          memory_type: string;
          tags: string[];
          metadata: unknown;
          created_at: string;
          similarity: number;
        }>;

        return {
          query,
          count: memories.length,
          memories: memories.map((m) => ({
            id: m.id,
            content: m.content,
            memoryType: m.memory_type,
            tags: m.tags,
            metadata: m.metadata,
            similarity: Number(Number(m.similarity).toFixed(4)),
            createdAt: m.created_at,
          })),
        };
      },
    });

    // ── Workflow Editing Tools ────────────────────────────────────────

    toolMap['edit_workflow'] = defineTool('edit_workflow', {
      description:
        'Edit workflow configuration: update triggers or steps for the current workflow. Use to modify schedule, add/remove steps, or change trigger settings.',
      parameters: z.object({
        action: z.enum(['list_triggers', 'add_trigger', 'update_trigger', 'delete_trigger', 'list_steps', 'update_steps'])
          .describe('Action to perform'),
        triggerData: z.object({
          triggerId: z.string().optional(),
          triggerType: creatableTriggerTypeSchema.optional(),
          configuration: z.record(z.unknown()).optional(),
          isActive: z.boolean().optional(),
        }).optional().describe('Trigger data for add/update/delete actions'),
        steps: z.array(z.object({
          name: z.string(),
          promptTemplate: z.string(),
          stepOrder: z.number(),
          agentId: z.string().optional(),
          model: z.string().optional(),
          timeoutSeconds: z.number().optional(),
        })).optional().describe('Steps array for update_steps action'),
      }),
      handler: async ({ action, triggerData, steps }: {
        action: string;
        triggerData?: { triggerId?: string; triggerType?: string; configuration?: Record<string, unknown>; isActive?: boolean };
        steps?: Array<{ name: string; promptTemplate: string; stepOrder: number; agentId?: string; model?: string; timeoutSeconds?: number }>;
      }) => {
        if (!context?.workflowId) return { error: 'No workflow context available' };
        logger.info({ action, workflowId: context.workflowId }, 'Tool: edit_workflow');

        const workflow = await loadWorkflowForHistory(context.workflowId);

        if (action === 'list_triggers') {
          const trigs = await db.query.triggers.findMany({ where: eq(triggers.workflowId, context.workflowId) });
          return { triggers: trigs };
        }
        if (action === 'add_trigger' && triggerData?.triggerType) {
          if (!workflow) return { error: 'Workflow not found' };
          if (workflow) await captureWorkflowHistoricalVersion(workflow, context.userId ?? null);
          try {
            const t = await createWorkflowTrigger({
              workflow,
              triggerType: triggerData.triggerType,
              configuration: triggerData.configuration ?? {},
              isActive: triggerData.isActive ?? true,
            });
            await bumpWorkflowVersion(context.workflowId);
            return { created: true, trigger: t };
          } catch (error) {
            if (error instanceof TriggerServiceError) {
              return { error: error.message, issues: error.issues };
            }
            throw error;
          }
        }
        if (action === 'update_trigger' && triggerData?.triggerId) {
          if (!workflow) return { error: 'Workflow not found' };
          if (workflow) await captureWorkflowHistoricalVersion(workflow, context.userId ?? null);
          const existingTrigger = await db.query.triggers.findFirst({
            where: and(eq(triggers.id, triggerData.triggerId), eq(triggers.workflowId, context.workflowId)),
          });
          if (!existingTrigger) return { error: 'Trigger not found' };

          try {
            const t = await updateWorkflowTrigger({
              workflow,
              trigger: existingTrigger,
              triggerType: triggerData.triggerType,
              configuration: triggerData.configuration,
              isActive: triggerData.isActive,
            });
            await bumpWorkflowVersion(context.workflowId);
            return { updated: true, trigger: t };
          } catch (error) {
            if (error instanceof TriggerServiceError) {
              return { error: error.message, issues: error.issues };
            }
            throw error;
          }
        }
        if (action === 'delete_trigger' && triggerData?.triggerId) {
          if (!workflow) return { error: 'Workflow not found' };
          if (workflow) await captureWorkflowHistoricalVersion(workflow, context.userId ?? null);
          const existingTrigger = await db.query.triggers.findFirst({
            where: and(eq(triggers.id, triggerData.triggerId), eq(triggers.workflowId, context.workflowId)),
          });
          if (!existingTrigger) return { error: 'Trigger not found' };

          await deleteWorkflowTrigger({ workflow, trigger: existingTrigger });
          await bumpWorkflowVersion(context.workflowId);
          return { deleted: true };
        }
        if (action === 'list_steps') {
          const s = await db.query.workflowSteps.findMany({ where: eq(workflowSteps.workflowId, context.workflowId) });
          return { steps: s };
        }
        if (action === 'update_steps' && steps) {
          if (workflow) await captureWorkflowHistoricalVersion(workflow, context.userId ?? null);
          await db.delete(workflowSteps).where(eq(workflowSteps.workflowId, context.workflowId));
          const inserted = [];
          for (const step of steps) {
            const [s] = await db.insert(workflowSteps).values({
              workflowId: context.workflowId,
              name: step.name,
              promptTemplate: step.promptTemplate,
              stepOrder: step.stepOrder,
              agentId: step.agentId ?? null,
              model: step.model ?? null,
              timeoutSeconds: step.timeoutSeconds ?? 300,
            }).returning();
            inserted.push(s);
          }
          // Increment workflow version
          await bumpWorkflowVersion(context.workflowId);
          return { updated: true, steps: inserted };
        }
        return { error: 'Invalid action or missing data' };
      },
    });

    // ── Variable Reading Tools ───────────────────────────────────────

    toolMap['read_variables'] = defineTool('read_variables', {
      description:
        'Read agent-level or user-level variables (properties and credentials). Credential values are masked for security.',
      parameters: z.object({
        scope: z.enum(['agent', 'user']).describe('Read agent-level or user-level variables'),
        variableType: z.enum(['property', 'credential', 'all']).default('all').describe('Filter by variable type'),
      }),
      skipPermission: true,
      handler: async ({ scope, variableType }: { scope: 'agent' | 'user'; variableType: string }) => {
        logger.info({ scope, variableType, agentId: context?.agentId }, 'Tool: read_variables');

        if (scope === 'agent' && context?.agentId) {
          let vars = await db.query.agentVariables.findMany({ where: eq(agentVariables.agentId, context.agentId) });
          if (variableType !== 'all') vars = vars.filter(v => v.variableType === variableType);
          return {
            variables: vars.map(v => ({
              id: v.id, key: v.key, variableType: v.variableType,
              description: v.description, injectAsEnvVariable: v.injectAsEnvVariable,
              value: v.variableType === 'property' ? '(use {{ Properties.' + v.key + ' }} in prompts)' : '••••••••',
            })),
          };
        }
        if (scope === 'user' && context?.userId) {
          let vars = await db.query.userVariables.findMany({ where: eq(userVariables.userId, context.userId) });
          if (variableType !== 'all') vars = vars.filter(v => v.variableType === variableType);
          return {
            variables: vars.map(v => ({
              id: v.id, key: v.key, variableType: v.variableType,
              description: v.description, injectAsEnvVariable: v.injectAsEnvVariable,
              value: v.variableType === 'property' ? '(use {{ Properties.' + v.key + ' }} in prompts)' : '••••••••',
            })),
          };
        }
        return { error: 'No context available for the requested scope' };
      },
    });

    // ── Variable Editing Tools ───────────────────────────────────────

    toolMap['edit_variables'] = defineTool('edit_variables', {
      description:
        'Create, update, or delete agent-level variables (properties and credentials). Values are encrypted at rest.',
      parameters: z.object({
        action: z.enum(['create', 'update', 'delete']).describe('Action to perform'),
        key: z.string().describe('Variable key (UPPER_SNAKE_CASE)'),
        value: z.string().optional().describe('Variable value (required for create/update)'),
        description: z.string().optional().describe('Description of the variable'),
        variableType: z.enum(['property', 'credential']).optional().describe('Type of variable'),
        injectAsEnvVariable: z.boolean().optional().describe('Whether to inject as .env variable'),
        variableId: z.string().optional().describe('Variable ID for update/delete'),
      }),
      handler: async ({ action, key, value, description, variableType, injectAsEnvVariable, variableId }: {
        action: string; key: string; value?: string; description?: string;
        variableType?: string; injectAsEnvVariable?: boolean; variableId?: string;
      }) => {
        if (!context?.agentId) return { error: 'No agent context available' };
        logger.info({ action, key, agentId: context.agentId }, 'Tool: edit_variables');

        const agent = await loadAgentForHistory(context.agentId);

        if (action === 'create') {
          if (!value) return { error: 'Value is required for create' };
          if (agent) await captureAgentHistoricalVersion(agent, context.userId ?? null);
          const [v] = await db.insert(agentVariables).values({
            agentId: context.agentId,
            key,
            valueEncrypted: encrypt(value),
            variableType: (variableType as 'property' | 'credential') ?? 'credential',
            injectAsEnvVariable: injectAsEnvVariable ?? false,
            description: description ?? null,
          }).returning({ id: agentVariables.id, key: agentVariables.key });
          await bumpAgentVersion(context.agentId);
          return { created: true, variable: v };
        }
        if (action === 'update' && variableId) {
          const existing = db.query?.agentVariables?.findFirst
            ? await db.query.agentVariables.findFirst({
                where: and(eq(agentVariables.id, variableId), eq(agentVariables.agentId, context.agentId)),
              })
            : null;

          if (agent) await captureAgentHistoricalVersion(agent, context.userId ?? null);
          if (existing) {
            await captureVariableHistoricalVersion({
              id: existing.id,
              scope: 'agent',
              scopeId: existing.agentId,
              workspaceId: agent?.workspaceId ?? context.workspaceId ?? null,
              key: existing.key,
              variableType: existing.variableType,
              credentialSubType: existing.credentialSubType,
              injectAsEnvVariable: existing.injectAsEnvVariable,
              description: existing.description,
              version: existing.version,
              createdAt: existing.createdAt,
              updatedAt: existing.updatedAt,
            }, context.userId ?? null);
          }

          const updateData: Record<string, unknown> = { updatedAt: new Date() };
          if (value) updateData.valueEncrypted = encrypt(value);
          if (description !== undefined) updateData.description = description;
          if (variableType) updateData.variableType = variableType;
          if (injectAsEnvVariable !== undefined) updateData.injectAsEnvVariable = injectAsEnvVariable;
          updateData.version = sql`${agentVariables.version} + 1`;
          const [v] = await db.update(agentVariables).set(updateData).where(eq(agentVariables.id, variableId)).returning({ id: agentVariables.id, key: agentVariables.key });
          await bumpAgentVersion(context.agentId);
          return { updated: true, variable: v };
        }
        if (action === 'delete' && variableId) {
          const existing = db.query?.agentVariables?.findFirst
            ? await db.query.agentVariables.findFirst({
                where: and(eq(agentVariables.id, variableId), eq(agentVariables.agentId, context.agentId)),
              })
            : null;

          if (agent) await captureAgentHistoricalVersion(agent, context.userId ?? null);
          if (existing) {
            await captureVariableHistoricalVersion({
              id: existing.id,
              scope: 'agent',
              scopeId: existing.agentId,
              workspaceId: agent?.workspaceId ?? context.workspaceId ?? null,
              key: existing.key,
              variableType: existing.variableType,
              credentialSubType: existing.credentialSubType,
              injectAsEnvVariable: existing.injectAsEnvVariable,
              description: existing.description,
              version: existing.version,
              createdAt: existing.createdAt,
              updatedAt: existing.updatedAt,
            }, context.userId ?? null, { deleted: true });
          }

          await db.delete(agentVariables).where(eq(agentVariables.id, variableId));
          await bumpAgentVersion(context.agentId);
          return { deleted: true };
        }
        return { error: 'Invalid action or missing data' };
      },
    });

    // ── Simple HTTP Request Tool (curl-like with Jinja2 templating) ──

    // ── Security: header masking for safe logging ──────────────────
    // Headers may contain credentials injected via Jinja2 templates.
    // NEVER log raw header values — always mask them.
    const SENSITIVE_HEADER_PATTERNS = /^(authorization|x-api-key|cookie|x-auth|x-token|proxy-authorization|x-secret)/i;
    const maskHeadersForLog = (headers: Record<string, string>): Record<string, string> => {
      const masked: Record<string, string> = {};
      for (const [k, v] of Object.entries(headers)) {
        masked[k] = SENSITIVE_HEADER_PATTERNS.test(k) ? '***MASKED***' : v;
      }
      return masked;
    };

    toolMap['simple_http_request'] = defineTool('simple_http_request', {
      description:
        `Make HTTP requests with curl-like control. Supports all HTTP methods, custom headers, ` +
        `request bodies, query parameters, timeouts, redirects, basic/bearer auth, and response control. ` +
        `\n\n**Jinja2 Templating:** All string input arguments support Jinja2 template syntax. ` +
        `Available variables: \`{{ properties.KEY }}\`, \`{{ credentials.KEY }}\`, \`{{ env.KEY }}\`. ` +
        `Example: url="{{ properties.API_BASE_URL }}/v1/data", headers='{"Authorization": "Bearer {{ credentials.API_TOKEN }}"}'. ` +
        `Templates are rendered before the request is made, so you can dynamically construct URLs, headers, bodies, etc.`,
      parameters: z.object({
        url: z.string().describe('Request URL (supports Jinja2 templating, e.g. "{{ properties.API_BASE }}/endpoint")'),
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).default('GET').describe('HTTP method'),
        headers: z.string().optional().describe('JSON string of request headers (supports Jinja2 templating). Example: \'{"Content-Type": "application/json", "Authorization": "Bearer {{ credentials.TOKEN }}"}\''),
        body: z.string().optional().describe('Request body as string (supports Jinja2 templating). For JSON payloads, pass a JSON string.'),
        query_params: z.string().optional().describe('JSON string of query parameters (supports Jinja2 templating). Example: \'{"page": "1", "limit": "50"}\''),
        content_type: z.string().optional().describe('Shorthand for Content-Type header (e.g. "application/json", "application/x-www-form-urlencoded", "multipart/form-data")'),
        auth_type: z.enum(['none', 'basic', 'bearer']).default('none').describe('Authentication type'),
        auth_value: z.string().optional().describe('Auth value (supports Jinja2): for basic = "user:pass", for bearer = token string. Example: "{{ credentials.API_TOKEN }}"'),
        timeout_ms: z.number().default(30000).describe('Request timeout in milliseconds (default: 30000)'),
        follow_redirects: z.boolean().default(true).describe('Follow HTTP redirects (default: true)'),
        max_redirects: z.number().default(10).describe('Maximum number of redirects to follow (default: 10)'),
        include_response_headers: z.boolean().default(false).describe('Include response headers in the result'),
        max_response_size: z.number().default(1048576).describe('Maximum response body size in bytes (default: 1MB)'),
        verify_ssl: z.boolean().default(true).describe('Verify SSL certificates (default: true). Set to false for self-signed certs.'),
        user_agent: z.string().optional().describe('Custom User-Agent header'),
        accept: z.string().optional().describe('Shorthand for Accept header (e.g. "application/json")'),
        cookies: z.string().optional().describe('JSON string of cookies to send. Example: \'{"session": "abc123"}\''),
      }),
      handler: async (args: {
        url: string;
        method: string;
        headers?: string;
        body?: string;
        query_params?: string;
        content_type?: string;
        auth_type: string;
        auth_value?: string;
        timeout_ms: number;
        follow_redirects: boolean;
        max_redirects: number;
        include_response_headers: boolean;
        max_response_size: number;
        verify_ssl: boolean;
        user_agent?: string;
        accept?: string;
        cookies?: string;
      }) => {
        try {
          // Render all string arguments through Jinja2 if templateContext is available
          const ctx = templateContext ?? {};
          const render = (val: string | undefined): string | undefined =>
            val ? renderTemplate(val, ctx) : val;

          const url = renderTemplate(args.url, ctx);
          const headersStr = render(args.headers);
          const bodyStr = render(args.body);
          const queryParamsStr = render(args.query_params);
          const authValue = render(args.auth_value);
          const userAgent = render(args.user_agent);
          const cookiesStr = render(args.cookies);
          const contentType = render(args.content_type);
          const accept = render(args.accept);

          // Build URL with query params
          const urlObj = new URL(url);
          if (queryParamsStr) {
            const qp = JSON.parse(queryParamsStr) as Record<string, string>;
            for (const [k, v] of Object.entries(qp)) {
              urlObj.searchParams.set(k, v);
            }
          }

          // Build headers
          const reqHeaders: Record<string, string> = {};
          if (headersStr) {
            Object.assign(reqHeaders, JSON.parse(headersStr));
          }
          if (contentType) reqHeaders['Content-Type'] = contentType;
          if (accept) reqHeaders['Accept'] = accept;
          if (userAgent) reqHeaders['User-Agent'] = userAgent;

          // Auth
          if (args.auth_type === 'bearer' && authValue) {
            reqHeaders['Authorization'] = `Bearer ${authValue}`;
          } else if (args.auth_type === 'basic' && authValue) {
            const encoded = Buffer.from(authValue).toString('base64');
            reqHeaders['Authorization'] = `Basic ${encoded}`;
          }

          // Cookies
          if (cookiesStr) {
            const cookies = JSON.parse(cookiesStr) as Record<string, string>;
            reqHeaders['Cookie'] = Object.entries(cookies)
              .map(([k, v]) => `${k}=${v}`)
              .join('; ');
          }

          // SECURITY: Log request with masked headers — never log raw credential values
          logger.info(
            { url: urlObj.toString(), method: args.method, headers: maskHeadersForLog(reqHeaders) },
            'Tool: simple_http_request',
          );

          // Perform fetch with timeout
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), args.timeout_ms);

          // Build fetch options
          const fetchOptions: RequestInit & { redirect?: RequestRedirect } = {
            method: args.method,
            headers: reqHeaders,
            signal: controller.signal,
            redirect: args.follow_redirects ? 'follow' : 'manual',
          };

          if (bodyStr && !['GET', 'HEAD'].includes(args.method)) {
            fetchOptions.body = bodyStr;
          }

          // SSL verification: Node.js fetch doesn't directly support disabling SSL
          // via fetch options, but we set the env variable for the request if needed
          const prevRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
          if (!args.verify_ssl) {
            process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
          }

          let response: Response;
          try {
            response = await fetch(urlObj.toString(), fetchOptions);
          } finally {
            clearTimeout(timeoutId);
            // Restore SSL setting
            if (!args.verify_ssl) {
              if (prevRejectUnauthorized !== undefined) {
                process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevRejectUnauthorized;
              } else {
                delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
              }
            }
          }

          // Read response body with size limit
          const contentLength = response.headers.get('content-length');
          if (contentLength && parseInt(contentLength) > args.max_response_size) {
            return {
              error: `Response too large: ${contentLength} bytes exceeds max_response_size of ${args.max_response_size} bytes`,
              status: response.status,
              statusText: response.statusText,
            };
          }

          const responseBuffer = await response.arrayBuffer();
          if (responseBuffer.byteLength > args.max_response_size) {
            return {
              error: `Response body truncated: ${responseBuffer.byteLength} bytes exceeds max_response_size`,
              status: response.status,
              statusText: response.statusText,
            };
          }

          const responseBody = new TextDecoder().decode(responseBuffer);

          // Build result
          const result: Record<string, unknown> = {
            status: response.status,
            statusText: response.statusText,
            body: responseBody,
          };

          // Try to parse as JSON for convenience
          try {
            result.json = JSON.parse(responseBody);
          } catch {
            // Not JSON — that's fine, body is available as string
          }

          if (args.include_response_headers) {
            const respHeaders: Record<string, string> = {};
            response.headers.forEach((v, k) => { respHeaders[k] = v; });
            result.headers = respHeaders;
          }

          return result;
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            return { error: `Request timed out after ${args.timeout_ms}ms` };
          }
          return { error: err instanceof Error ? err.message : 'HTTP request failed' };
        }
      },
    });

    // ── Filter by enabled tools ──────────────────────────────────────

    if (enabledTools && enabledTools.length > 0) {
      return enabledTools
        .filter((name) => toolMap[name])
        .map((name) => toolMap[name]);
    }
    return Object.values(toolMap);
}
