import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq, desc, and, or, sql, arrayContains } from 'drizzle-orm';
import { db } from '../database/index.js';
import { workflows, workflowSteps, triggers, workflowExecutions, users, agents } from '../database/schema.js';
import { authMiddleware, uuidSchema } from '@oao/shared';
import { emitEvent, EVENT_NAMES } from '../services/system-events.js';
import {
  captureWorkflowHistoricalVersion,
  getWorkflowVersionView,
  listWorkflowVersionViews,
} from '../services/versioning.js';

const workflowsRouter = new OpenAPIHono();
workflowsRouter.use('/*', authMiddleware);

const WorkflowIdParam = z.object({
  id: z.string().uuid().openapi({ description: 'Workflow UUID' }),
});

const WorkflowVersionParam = WorkflowIdParam.extend({
  version: z.string().openapi({ description: 'Workflow version number' }),
});

const PaginationQuery = z.object({
  page: z.string().optional().openapi({ description: 'Page number (default: 1)' }),
  limit: z.string().optional().openapi({ description: 'Items per page (default: 50, max: 100)' }),
});

const ErrorResponse = z.object({ error: z.string() });

const listWorkflowVersionsRoute = createRoute({
  method: 'get',
  path: '/{id}/versions',
  tags: ['Workflows'],
  summary: 'List workflow version history',
  request: {
    params: WorkflowIdParam,
    query: PaginationQuery,
  },
  responses: {
    200: {
      description: 'Workflow version history',
      content: {
        'application/json': {
          schema: z.object({
            versions: z.array(z.any()),
            total: z.number(),
            page: z.number(),
            limit: z.number(),
          }),
        },
      },
    },
    404: { description: 'Workflow not found', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

const getWorkflowVersionRoute = createRoute({
  method: 'get',
  path: '/{id}/versions/{version}',
  tags: ['Workflows'],
  summary: 'Get workflow version snapshot',
  request: {
    params: WorkflowVersionParam,
  },
  responses: {
    200: {
      description: 'Workflow version snapshot',
      content: {
        'application/json': {
          schema: z.object({
            version: z.any(),
          }),
        },
      },
    },
    404: { description: 'Workflow version not found', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// GET / — list workflows visible to user: user-scoped (own) + workspace-scoped
// Query params: ?labels=label1,label2 — filter by ALL specified labels (AND logic)
workflowsRouter.get('/', async (c) => {
  const user = c.get('user');
  if (!user.workspaceId) return c.json({ workflows: [], total: 0 });

  const page = Math.max(1, Number(c.req.query('page') || 1));
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 50)));
  const offset = (page - 1) * limit;

  const labelsParam = c.req.query('labels');
  const labelFilter = labelsParam ? labelsParam.split(',').map(l => l.trim()).filter(Boolean) : [];

  const conditions = [
    eq(workflows.workspaceId, user.workspaceId),
    or(
      eq(workflows.scope, 'workspace'),
      eq(workflows.userId, user.userId),
    ),
  ];

  // Filter by labels if provided (array containment: workflow.labels ⊇ filterLabels)
  if (labelFilter.length > 0) {
    conditions.push(arrayContains(workflows.labels, labelFilter));
  }

  const whereClause = and(...conditions);

  const [workflowList, countResult] = await Promise.all([
    db.query.workflows.findMany({
      where: whereClause,
      orderBy: desc(workflows.createdAt),
      limit,
      offset,
    }),
    db.select({ count: sql<number>`count(*)::int` }).from(workflows).where(whereClause),
  ]);

  // Fetch last execution time for each workflow
  const lastExecMap: Record<string, string | null> = {};
  for (const wf of workflowList) {
    const lastExec = await db.query.workflowExecutions.findFirst({
      where: eq(workflowExecutions.workflowId, wf.id),
      orderBy: desc(workflowExecutions.createdAt),
      columns: { createdAt: true, status: true },
    });
    lastExecMap[wf.id] = lastExec?.createdAt?.toISOString() ?? null;
  }

  // Fetch owner names
  const ownerIds = [...new Set(workflowList.map((w) => w.userId))];
  const ownerMap: Record<string, string> = {};
  for (const ownerId of ownerIds) {
    const owner = await db.query.users.findFirst({
      where: eq(users.id, ownerId),
      columns: { name: true },
    });
    if (owner) ownerMap[ownerId] = owner.name;
  }

  const enriched = workflowList.map((w) => ({
    ...w,
    lastExecutionAt: lastExecMap[w.id] ?? null,
    ownerName: ownerMap[w.userId] ?? 'Unknown',
  }));

  return c.json({ workflows: enriched, total: countResult[0]?.count ?? 0, page, limit });
});

// GET /labels — list all distinct labels used in workflows (for filter UI)
workflowsRouter.get('/labels', async (c) => {
  const user = c.get('user');
  if (!user.workspaceId) return c.json({ labels: [] });

  const rows = await db.execute(
    sql`SELECT DISTINCT unnest(labels) AS label FROM workflows WHERE workspace_id = ${user.workspaceId} ORDER BY label`,
  );
  const labels = (rows as unknown as Array<{ label: string }>).map((r) => r.label);
  return c.json({ labels });
});

// POST / — create workflow with steps and optional triggers
const stepSchema = z.object({
  name: z.string().min(1).max(200),
  promptTemplate: z.string().min(1),
  stepOrder: z.number().int().min(1),
  agentId: z.string().uuid().optional(), // optional — falls back to workflow defaultAgentId
  model: z.string().max(100).optional(),
  reasoningEffort: z.enum(['high', 'medium', 'low']).optional(),
  workerRuntime: z.enum(['static', 'ephemeral']).optional(),
  timeoutSeconds: z.number().int().min(30).max(3600).default(300),
});

const triggerSchema = z.object({
  triggerType: z.enum(['time_schedule', 'exact_datetime', 'webhook', 'event']),
  configuration: z.record(z.unknown()).default({}),
});

const createWorkflowSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  labels: z.array(z.string().min(1).max(50)).max(10).default([]),
  defaultAgentId: z.string().uuid().optional(),
  defaultModel: z.string().max(100).optional(),
  defaultReasoningEffort: z.enum(['high', 'medium', 'low']).optional(),
  workerRuntime: z.enum(['static', 'ephemeral']).default('static'),
  stepAllocationTimeoutSeconds: z.number().int().min(15).max(3600).default(300),
  scope: z.enum(['user', 'workspace']).default('user'),
  steps: z.array(stepSchema).min(1).max(20),
  triggers: z.array(triggerSchema).optional(),
});

workflowsRouter.post('/', async (c) => {
  const user = c.get('user');
  if (!user.workspaceId) return c.json({ error: 'No workspace context' }, 403);
  if (user.role === 'view_user') return c.json({ error: 'View-only users cannot create workflows' }, 403);
  const body = createWorkflowSchema.parse(await c.req.json());

  // Only workspace_admin/super_admin can create workspace-scoped workflows
  if (body.scope === 'workspace' && user.role !== 'workspace_admin' && user.role !== 'super_admin') {
    return c.json({ error: 'Only admins can create workspace-level workflows' }, 403);
  }

  // Validate that referenced agentId belongs to same workspace and is accessible
  // Workspace-scoped workflows can only use workspace-scoped agents
  if (body.defaultAgentId) {
    const agent = await db.query.agents.findFirst({ where: eq(agents.id, body.defaultAgentId) });
    if (!agent || agent.workspaceId !== user.workspaceId) {
      return c.json({ error: 'Default agent not found in this workspace' }, 400);
    }
  }

  // Validate webhook path uniqueness if any webhook triggers
  if (body.triggers) {
    for (const t of body.triggers) {
      if (t.triggerType === 'webhook' && t.configuration.path) {
        const existingTrigger = await db.query.triggers.findFirst({
          where: and(
            eq(triggers.triggerType, 'webhook'),
            sql`configuration->>'path' = ${String(t.configuration.path)}`,
          ),
        });
        if (existingTrigger) {
          return c.json({ error: `Webhook path "${t.configuration.path}" is already in use` }, 409);
        }
      }
    }
  }

  const result = await db.transaction(async (tx) => {
    const [workflow] = await tx
      .insert(workflows)
      .values({
        workspaceId: user.workspaceId!,
        userId: user.userId,
        scope: body.scope,
        name: body.name,
        description: body.description,
        labels: body.labels,
        defaultAgentId: body.defaultAgentId,
        defaultModel: body.defaultModel,
        defaultReasoningEffort: body.defaultReasoningEffort,
        workerRuntime: body.workerRuntime,
        stepAllocationTimeoutSeconds: body.stepAllocationTimeoutSeconds,
        version: 1,
      })
      .returning();

    const steps = await tx
      .insert(workflowSteps)
      .values(
        body.steps.map((s) => ({
          workflowId: workflow.id,
          name: s.name,
          promptTemplate: s.promptTemplate,
          stepOrder: s.stepOrder,
          agentId: s.agentId,
          model: s.model,
          reasoningEffort: s.reasoningEffort,
          workerRuntime: s.workerRuntime,
          timeoutSeconds: s.timeoutSeconds,
        })),
      )
      .returning();

    // Create triggers if provided
    let workflowTriggers: Array<typeof triggers.$inferSelect> = [];
    if (body.triggers && body.triggers.length > 0) {
      workflowTriggers = await tx
        .insert(triggers)
        .values(
          body.triggers.map((t) => ({
            workflowId: workflow.id,
            triggerType: t.triggerType,
            configuration: t.configuration,
          })),
        )
        .returning();
    }

    return { workflow, steps, triggers: workflowTriggers };
  });

  emitEvent({
    eventScope: body.scope === 'workspace' ? 'workspace' : 'user',
    scopeId: body.scope === 'workspace' ? user.workspaceId! : user.userId,
    eventName: EVENT_NAMES.WORKFLOW_CREATED,
    eventData: { workflowId: result.workflow.id, workflowName: body.name, scope: body.scope },
    actorId: user.userId,
  });

  return c.json(result, 201);
});

// GET /:id — workflow detail + steps + triggers + owner (workspace-scoped)
workflowsRouter.get('/:id', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));

  const workflow = await db.query.workflows.findFirst({ where: eq(workflows.id, id) });
  if (!workflow) return c.json({ error: 'Workflow not found' }, 404);
  if (workflow.workspaceId !== user.workspaceId) return c.json({ error: 'Workflow not found' }, 404);

  // Scope check: user-scoped workflows only visible to owner and admins
  if (workflow.scope === 'user' && workflow.userId !== user.userId && user.role !== 'workspace_admin' && user.role !== 'super_admin') {
    return c.json({ error: 'Workflow not found' }, 404);
  }

  const [steps, workflowTriggers, owner, lastExec] = await Promise.all([
    db.query.workflowSteps.findMany({
      where: eq(workflowSteps.workflowId, id),
      orderBy: workflowSteps.stepOrder,
    }),
    db.query.triggers.findMany({
      where: eq(triggers.workflowId, id),
    }),
    db.query.users.findFirst({
      where: eq(users.id, workflow.userId),
      columns: { name: true, email: true },
    }),
    db.query.workflowExecutions.findFirst({
      where: eq(workflowExecutions.workflowId, id),
      orderBy: desc(workflowExecutions.createdAt),
      columns: { createdAt: true, status: true },
    }),
  ]);

  return c.json({
    workflow: {
      ...workflow,
      ownerName: owner?.name ?? 'Unknown',
      ownerEmail: owner?.email,
      lastExecutionAt: lastExec?.createdAt?.toISOString() ?? null,
      lastExecutionStatus: lastExec?.status ?? null,
    },
    steps,
    triggers: workflowTriggers,
  });
});

// PUT /:id — update workflow (increments version)
const updateWorkflowSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  labels: z.array(z.string().min(1).max(50)).max(10).optional(),
  isActive: z.boolean().optional(),
  defaultAgentId: z.string().uuid().nullable().optional(),
  defaultModel: z.string().max(100).nullable().optional(),
  defaultReasoningEffort: z.enum(['high', 'medium', 'low']).nullable().optional(),
  workerRuntime: z.enum(['static', 'ephemeral']).optional(),
  stepAllocationTimeoutSeconds: z.number().int().min(15).max(3600).optional(),
});

workflowsRouter.put('/:id', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));
  const body = updateWorkflowSchema.parse(await c.req.json());

  const existing = await db.query.workflows.findFirst({ where: eq(workflows.id, id) });
  if (!existing) return c.json({ error: 'Workflow not found' }, 404);
  if (existing.workspaceId !== user.workspaceId) return c.json({ error: 'Forbidden' }, 403);

  // Scope-based authorization
  if (existing.scope === 'workspace' && user.role !== 'workspace_admin' && user.role !== 'super_admin') {
    return c.json({ error: 'Only admins can modify workspace-level workflows' }, 403);
  }
  if (existing.scope === 'user' && existing.userId !== user.userId && user.role !== 'workspace_admin' && user.role !== 'super_admin') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  await captureWorkflowHistoricalVersion(existing, user.userId);

  const [updated] = await db
    .update(workflows)
    .set({
      ...body,
      version: sql`${workflows.version} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(workflows.id, id))
    .returning();

  emitEvent({
    eventScope: existing.scope === 'workspace' ? 'workspace' : 'user',
    scopeId: existing.scope === 'workspace' ? existing.workspaceId : existing.userId,
    eventName: EVENT_NAMES.WORKFLOW_UPDATED,
    eventData: { workflowId: id, changes: Object.keys(body) },
    actorId: user.userId,
  });

  return c.json({ workflow: updated });
});

// PUT /:id/steps — replace all steps atomically (increments version)
workflowsRouter.put('/:id/steps', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));
  const { steps } = z
    .object({ steps: z.array(stepSchema).min(1).max(20) })
    .parse(await c.req.json());

  // Verify workflow exists and belongs to user's workspace
  const existing = await db.query.workflows.findFirst({ where: eq(workflows.id, id) });
  if (!existing) return c.json({ error: 'Workflow not found' }, 404);
  if (existing.workspaceId !== user.workspaceId) return c.json({ error: 'Forbidden' }, 403);

  // Scope-based authorization (same as PUT /:id)
  if (existing.scope === 'workspace' && user.role !== 'workspace_admin' && user.role !== 'super_admin') {
    return c.json({ error: 'Only admins can modify workspace-level workflows' }, 403);
  }
  if (existing.scope === 'user' && existing.userId !== user.userId && user.role !== 'workspace_admin' && user.role !== 'super_admin') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  await captureWorkflowHistoricalVersion(existing, user.userId);

  const result = await db.transaction(async (tx) => {
    await tx.delete(workflowSteps).where(eq(workflowSteps.workflowId, id));
    const newSteps = await tx
      .insert(workflowSteps)
      .values(
        steps.map((s) => ({
          workflowId: id,
          name: s.name,
          promptTemplate: s.promptTemplate,
          stepOrder: s.stepOrder,
          agentId: s.agentId,
          model: s.model,
          reasoningEffort: s.reasoningEffort,
          workerRuntime: s.workerRuntime,
          timeoutSeconds: s.timeoutSeconds,
        })),
      )
      .returning();

    await tx
      .update(workflows)
      .set({ version: sql`${workflows.version} + 1`, updatedAt: new Date() })
      .where(eq(workflows.id, id));

    return newSteps;
  });

  return c.json({ steps: result });
});

// GET /:id/versions — list workflow version history
workflowsRouter.openapi(listWorkflowVersionsRoute, async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const workflow = await db.query.workflows.findFirst({ where: eq(workflows.id, id) });
  if (!workflow) return c.json({ error: 'Workflow not found' }, 404);
  if (workflow.workspaceId !== user.workspaceId) return c.json({ error: 'Workflow not found' }, 404);
  if (workflow.scope === 'user' && workflow.userId !== user.userId && user.role !== 'workspace_admin' && user.role !== 'super_admin') {
    return c.json({ error: 'Workflow not found' }, 404);
  }

  const { page: pageStr, limit: limitStr } = c.req.valid('query');
  const page = Math.max(1, Number(pageStr || 1));
  const limit = Math.min(100, Math.max(1, Number(limitStr || 50)));
  const versions = await listWorkflowVersionViews(workflow);
  const offset = (page - 1) * limit;

  return c.json({
    versions: versions.slice(offset, offset + limit),
    total: versions.length,
    page,
    limit,
  }, 200);
});

// GET /:id/versions/:version — get specific workflow version snapshot
workflowsRouter.openapi(getWorkflowVersionRoute, async (c) => {
  const user = c.get('user');
  const { id, version: versionStr } = c.req.valid('param');
  const version = Number(versionStr);

  if (!Number.isInteger(version) || version < 1) {
    return c.json({ error: 'Version not found' }, 404);
  }

  const workflow = await db.query.workflows.findFirst({ where: eq(workflows.id, id) });
  if (!workflow) return c.json({ error: 'Workflow not found' }, 404);
  if (workflow.workspaceId !== user.workspaceId) return c.json({ error: 'Workflow not found' }, 404);
  if (workflow.scope === 'user' && workflow.userId !== user.userId && user.role !== 'workspace_admin' && user.role !== 'super_admin') {
    return c.json({ error: 'Workflow not found' }, 404);
  }

  const versionRecord = await getWorkflowVersionView(workflow, version);
  if (!versionRecord) return c.json({ error: 'Version not found' }, 404);

  return c.json({ version: versionRecord }, 200);
});

// DELETE /:id
workflowsRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));

  const existing = await db.query.workflows.findFirst({ where: eq(workflows.id, id) });
  if (!existing) return c.json({ error: 'Workflow not found' }, 404);
  if (existing.workspaceId !== user.workspaceId) return c.json({ error: 'Forbidden' }, 403);

  if (existing.scope === 'workspace' && user.role !== 'workspace_admin' && user.role !== 'super_admin') {
    return c.json({ error: 'Only admins can delete workspace-level workflows' }, 403);
  }
  if (existing.scope === 'user' && existing.userId !== user.userId && user.role !== 'workspace_admin' && user.role !== 'super_admin') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  await db.delete(workflows).where(eq(workflows.id, id));

  emitEvent({
    eventScope: existing.scope === 'workspace' ? 'workspace' : 'user',
    scopeId: existing.scope === 'workspace' ? existing.workspaceId : existing.userId,
    eventName: EVENT_NAMES.WORKFLOW_DELETED,
    eventData: { workflowId: id, workflowName: existing.name },
    actorId: user.userId,
  });

  return c.json({ success: true });
});

// POST /:id/run — manually run a workflow (requires a webhook trigger with parameters)
const manualRunSchema = z.object({
  inputs: z.record(z.unknown()).default({}),
});

workflowsRouter.post('/:id/run', async (c) => {
  const id = uuidSchema.parse(c.req.param('id'));
  const user = c.get('user');
  const body = manualRunSchema.parse(await c.req.json().catch(() => ({})));

  const workflow = await db.query.workflows.findFirst({ where: eq(workflows.id, id) });
  if (!workflow) return c.json({ error: 'Workflow not found' }, 404);
  if (workflow.workspaceId !== user.workspaceId) return c.json({ error: 'Forbidden' }, 403);

  // Scope check: user-scoped workflows can only be run by owner or admins
  if (workflow.scope === 'user' && workflow.userId !== user.userId && user.role !== 'workspace_admin' && user.role !== 'super_admin') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  if (!workflow.isActive) {
    return c.json({ error: 'Workflow is not active' }, 400);
  }

  // Find the first active webhook trigger for parameter definitions
  const webhookTrigger = await db.query.triggers.findFirst({
    where: and(
      eq(triggers.workflowId, id),
      eq(triggers.triggerType, 'webhook'),
      eq(triggers.isActive, true),
    ),
  });

  if (!webhookTrigger) {
    return c.json({ error: 'No active webhook trigger found. Add a webhook trigger to enable Manual Run.' }, 400);
  }

  // Validate inputs against webhook parameter definitions
  const config = webhookTrigger.configuration as Record<string, unknown>;
  const paramDefs = Array.isArray(config.parameters) ? config.parameters as Array<{ name: string; required?: boolean }> : [];
  if (paramDefs.length > 0) {
    const missing = paramDefs.filter(p => p.required && (body.inputs[p.name] === undefined || body.inputs[p.name] === null || body.inputs[p.name] === ''));
    if (missing.length > 0) {
      return c.json({ error: `Missing required inputs: ${missing.map(p => p.name).join(', ')}` }, 400);
    }
  }

  // Build validated inputs
  const inputs: Record<string, unknown> = {};
  for (const p of paramDefs) {
    if (body.inputs[p.name] !== undefined) inputs[p.name] = body.inputs[p.name];
  }
  // Also allow extra inputs when no parameters are defined
  if (paramDefs.length === 0) {
    Object.assign(inputs, body.inputs);
  }

  // Emit webhook.received event — Manual Run flows through the event system like all triggers
  await emitEvent({
    eventScope: 'workspace',
    scopeId: workflow.workspaceId,
    eventName: EVENT_NAMES.WEBHOOK_RECEIVED,
    eventData: {
      triggerId: webhookTrigger.id,
      workflowId: workflow.id,
      authMethod: 'manual_run',
      inputs,
      receivedAt: new Date().toISOString(),
    },
    actorId: user.userId,
  });

  return c.json({ status: 'accepted' }, 202);
});

export default workflowsRouter;
