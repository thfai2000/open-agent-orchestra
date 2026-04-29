import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq, desc, and, or, sql, arrayContains, inArray } from 'drizzle-orm';
import { db } from '../database/index.js';
import { workflows, workflowSteps, workflowNodes, workflowEdges, triggers, workflowExecutions, users, agents, stepExecutions, agentInstances } from '../database/schema.js';
import { authMiddleware, uuidSchema } from '@oao/shared';
import {
  platformCreateWorkflowBodySchema,
  platformUpdateWorkflowBodySchema,
} from '../contracts/platform-api.js';
import { emitEvent, EVENT_NAMES } from '../services/system-events.js';
import { serializeTriggers } from '../services/trigger-serialization.js';
import { createWorkflowTrigger, deleteWorkflowTrigger } from '../services/trigger-manager.js';
import { TriggerServiceError } from '../services/trigger-errors.js';
import {
  captureWorkflowHistoricalVersion,
  getWorkflowVersionView,
  listWorkflowVersionViews,
} from '../services/versioning.js';
import { buildGraphFromSequentialSteps } from '../services/workflow-graph-sync.js';

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

  // Optional: fetch recent executions sparkline (?include=executionStats)
  const include = (c.req.query('include') || '').split(',').map((s) => s.trim());
  const includeStats = include.includes('executionStats');
  const recentExecMap: Record<string, Array<{ status: string; durationMs: number | null; startedAt: string | null }>> = {};
  if (includeStats) {
    for (const wf of workflowList) {
      const recent = await db.query.workflowExecutions.findMany({
        where: eq(workflowExecutions.workflowId, wf.id),
        orderBy: desc(workflowExecutions.createdAt),
        limit: 10,
        columns: { status: true, startedAt: true, completedAt: true, createdAt: true },
      });
      recentExecMap[wf.id] = recent
        .map((ex) => {
          const start = ex.startedAt ?? ex.createdAt;
          const end = ex.completedAt;
          const durationMs = start && end ? end.getTime() - start.getTime() : null;
          return {
            status: ex.status,
            durationMs,
            startedAt: start?.toISOString() ?? null,
          };
        })
        .reverse(); // oldest → newest for left-to-right sparkline
    }
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
    ...(includeStats ? { recentExecutions: recentExecMap[w.id] ?? [] } : {}),
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
workflowsRouter.post('/', async (c) => {
  const user = c.get('user');
  if (!user.workspaceId) return c.json({ error: 'No workspace context' }, 403);
  if (user.role === 'view_user') return c.json({ error: 'View-only users cannot create workflows' }, 403);
  const body = platformCreateWorkflowBodySchema.parse(await c.req.json());

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

    const graph = buildGraphFromSequentialSteps(steps);
    if (graph.nodes.length > 0) {
      await tx.insert(workflowNodes).values(
        graph.nodes.map((node) => ({
          workflowId: workflow.id,
          nodeKey: node.nodeKey,
          nodeType: node.nodeType,
          name: node.name,
          config: node.config ?? {},
          positionX: node.positionX ?? 0,
          positionY: node.positionY ?? 0,
        })),
      );
    }
    if (graph.edges.length > 0) {
      await tx.insert(workflowEdges).values(
        graph.edges.map((edge) => ({
          workflowId: workflow.id,
          fromNodeKey: edge.fromNodeKey,
          toNodeKey: edge.toNodeKey,
          branchKey: edge.branchKey ?? null,
          label: edge.label ?? null,
        })),
      );
    }

    return { workflow, steps };
  });

  const createdTriggers: Array<typeof triggers.$inferSelect> = [];
  try {
    for (const triggerInput of body.triggers || []) {
      const createdTrigger = await createWorkflowTrigger({
        workflow: result.workflow,
        triggerType: triggerInput.triggerType,
        configuration: triggerInput.configuration,
        isActive: triggerInput.isActive,
        entryNodeKey: triggerInput.entryNodeKey,
        positionX: triggerInput.positionX,
        positionY: triggerInput.positionY,
      });
      createdTriggers.push(createdTrigger);
    }
  } catch (error) {
    for (const createdTrigger of createdTriggers.reverse()) {
      try {
        await deleteWorkflowTrigger({ workflow: result.workflow, trigger: createdTrigger });
      } catch {
        // Best-effort cleanup for partial workflow creation.
      }
    }
    await db.delete(workflows).where(eq(workflows.id, result.workflow.id));

    if (error instanceof TriggerServiceError) {
      return c.json({ error: error.message, issues: error.issues }, error.status);
    }
    throw error;
  }

  emitEvent({
    eventScope: body.scope === 'workspace' ? 'workspace' : 'user',
    scopeId: body.scope === 'workspace' ? user.workspaceId! : user.userId,
    eventName: EVENT_NAMES.WORKFLOW_CREATED,
    eventData: { workflowId: result.workflow.id, workflowName: body.name, scope: body.scope },
    actorId: user.userId,
  });

  return c.json({
    workflow: result.workflow,
    steps: result.steps,
    triggers: serializeTriggers(createdTriggers),
  }, 201);
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
    triggers: serializeTriggers(workflowTriggers),
  });
});

// PUT /:id — update workflow (increments version)
workflowsRouter.put('/:id', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));
  const body = platformUpdateWorkflowBodySchema.parse(await c.req.json());

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

  const workflowTriggers = await db.query.triggers.findMany({
    where: eq(triggers.workflowId, id),
  });

  for (const workflowTrigger of workflowTriggers) {
    await deleteWorkflowTrigger({ workflow: existing, trigger: workflowTrigger });
  }

  await db.transaction(async (tx) => {
    const workflowExecutionRows = await tx.query.workflowExecutions.findMany({
      columns: { id: true },
      where: eq(workflowExecutions.workflowId, id),
    });

    const workflowExecutionIds = workflowExecutionRows.map((row) => row.id);
    if (workflowExecutionIds.length > 0) {
      const executionStepRows = await tx.query.stepExecutions.findMany({
        columns: { id: true },
        where: inArray(stepExecutions.workflowExecutionId, workflowExecutionIds),
      });

      const stepExecutionIds = executionStepRows.map((row) => row.id);
      if (stepExecutionIds.length > 0) {
        await tx
          .update(agentInstances)
          .set({ currentStepExecutionId: null, updatedAt: new Date() })
          .where(inArray(agentInstances.currentStepExecutionId, stepExecutionIds));
      }
    }

    await tx.delete(workflows).where(eq(workflows.id, id));
  });

  emitEvent({
    eventScope: existing.scope === 'workspace' ? 'workspace' : 'user',
    scopeId: existing.scope === 'workspace' ? existing.workspaceId : existing.userId,
    eventName: EVENT_NAMES.WORKFLOW_DELETED,
    eventData: { workflowId: id, workflowName: existing.name },
    actorId: user.userId,
  });

  return c.json({ success: true });
});

export default workflowsRouter;
