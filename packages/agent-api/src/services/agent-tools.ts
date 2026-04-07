// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck — Copilot SDK's Tool/defineTool generics have incompatible Zod type constraints
import { defineTool, type Tool } from '@github/copilot-sdk';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { createLogger, encrypt } from '@ai-trader/shared';
import { db } from '../database/index.js';
import {
  triggers, webhookRegistrations, agentDecisions, agentMemories,
  workflows, workflowSteps, agentVariables, userVariables,
} from '../database/schema.js';
import { generateEmbedding } from './embedding-service.js';

const logger = createLogger('agent-tools');

/**
 * Context for tools that interact with the agent's own resources.
 */
export interface AgentToolContext {
  agentId: string;
  workflowId: string;
  executionId?: string;
  userId?: string;
}

/**
 * Creates the set of **built-in** tools available to agents during Copilot sessions.
 *
 * These tools operate on the agent-orchestra's own database (agent_db).
 * Domain-specific tools are provided externally via MCP servers configured per-agent.
 *
 * Built-in tools:
 *   - record_decision        — Audit trail for agent decisions
 *   - schedule_next_wakeup   — Self-scheduling (cron triggers)
 *   - manage_webhook_trigger — Webhook lifecycle management
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
): Tool[] {
  const toolMap: Record<string, Tool> = {};

  // ── Self-Scheduling Tools ────────────────────────────────────────

  toolMap['schedule_next_wakeup'] = defineTool('schedule_next_wakeup', {
      description:
        'Schedule the agent to wake up and run again at a future time. Creates or updates a time_schedule trigger for this workflow.',
      parameters: z.object({
        cronExpression: z
          .string()
          .describe('Cron expression for when to run next (e.g. "0 9 * * 1-5" for weekdays at 9am)'),
        reason: z.string().optional().describe('Why this schedule was chosen'),
      }),
      handler: async ({
        cronExpression,
        reason,
      }: {
        cronExpression: string;
        reason?: string;
      }) => {
        if (!context?.workflowId) return { error: 'No workflow context available' };
        logger.info({ cronExpression, workflowId: context.workflowId, reason }, 'Tool: schedule_next_wakeup');

        // Check for existing time_schedule trigger
        const existing = await db.query.triggers.findFirst({
          where: and(
            eq(triggers.workflowId, context.workflowId),
            eq(triggers.triggerType, 'time_schedule'),
          ),
        });

        if (existing) {
          await db
            .update(triggers)
            .set({
              configuration: { cron: cronExpression, reason },
              isActive: true,
            })
            .where(eq(triggers.id, existing.id));
          return { updated: true, triggerId: existing.id, cronExpression, reason };
        }

        const [newTrigger] = await db
          .insert(triggers)
          .values({
            workflowId: context.workflowId,
            triggerType: 'time_schedule',
            configuration: { cron: cronExpression, reason },
            isActive: true,
          })
          .returning({ id: triggers.id });

        return { created: true, triggerId: newTrigger.id, cronExpression, reason };
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
        const { encrypt } = await import('@ai-trader/shared');
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
          triggerType: z.enum(['time_schedule', 'webhook', 'event']).optional(),
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

        if (action === 'list_triggers') {
          const trigs = await db.query.triggers.findMany({ where: eq(triggers.workflowId, context.workflowId) });
          return { triggers: trigs };
        }
        if (action === 'add_trigger' && triggerData?.triggerType) {
          const [t] = await db.insert(triggers).values({
            workflowId: context.workflowId,
            triggerType: triggerData.triggerType as 'time_schedule' | 'webhook' | 'event',
            configuration: triggerData.configuration ?? {},
            isActive: triggerData.isActive ?? true,
          }).returning();
          return { created: true, trigger: t };
        }
        if (action === 'update_trigger' && triggerData?.triggerId) {
          const updateData: Record<string, unknown> = {};
          if (triggerData.configuration) updateData.configuration = triggerData.configuration;
          if (triggerData.isActive !== undefined) updateData.isActive = triggerData.isActive;
          const [t] = await db.update(triggers).set(updateData).where(eq(triggers.id, triggerData.triggerId)).returning();
          return { updated: true, trigger: t };
        }
        if (action === 'delete_trigger' && triggerData?.triggerId) {
          await db.delete(triggers).where(eq(triggers.id, triggerData.triggerId));
          return { deleted: true };
        }
        if (action === 'list_steps') {
          const s = await db.query.workflowSteps.findMany({ where: eq(workflowSteps.workflowId, context.workflowId) });
          return { steps: s };
        }
        if (action === 'update_steps' && steps) {
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
          await db.update(workflows).set({
            version: sql`version + 1`,
            updatedAt: new Date(),
          }).where(eq(workflows.id, context.workflowId));
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

        if (action === 'create') {
          if (!value) return { error: 'Value is required for create' };
          const [v] = await db.insert(agentVariables).values({
            agentId: context.agentId,
            key,
            valueEncrypted: encrypt(value),
            variableType: (variableType as 'property' | 'credential') ?? 'credential',
            injectAsEnvVariable: injectAsEnvVariable ?? false,
            description: description ?? null,
          }).returning({ id: agentVariables.id, key: agentVariables.key });
          return { created: true, variable: v };
        }
        if (action === 'update' && variableId) {
          const updateData: Record<string, unknown> = { updatedAt: new Date() };
          if (value) updateData.valueEncrypted = encrypt(value);
          if (description !== undefined) updateData.description = description;
          if (variableType) updateData.variableType = variableType;
          if (injectAsEnvVariable !== undefined) updateData.injectAsEnvVariable = injectAsEnvVariable;
          const [v] = await db.update(agentVariables).set(updateData).where(eq(agentVariables.id, variableId)).returning({ id: agentVariables.id, key: agentVariables.key });
          return { updated: true, variable: v };
        }
        if (action === 'delete' && variableId) {
          await db.delete(agentVariables).where(eq(agentVariables.id, variableId));
          return { deleted: true };
        }
        return { error: 'Invalid action or missing data' };
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
