import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { db } from '../database/index.js';
import { workflowExecutions, stepExecutions, workflows, triggers } from '../database/schema.js';
import { authMiddleware, paginationSchema, uuidSchema } from '@oao/shared';
import { retryWorkflowExecution } from '../services/workflow-engine.js';
import { onRealtimeEvent, type RealtimeEvent } from '../services/realtime-bus.js';

const executionsRouter = new Hono();
executionsRouter.use('/*', authMiddleware);

/** Helper: get workflow IDs visible to this user (workspace-scoped + user's own) */
async function getVisibleWorkflowIds(workspaceId: string, userId: string): Promise<string[]> {
  const visible = await db.query.workflows.findMany({
    where: and(
      eq(workflows.workspaceId, workspaceId),
      sql`(${workflows.scope} = 'workspace' OR ${workflows.userId} = ${userId})`,
    ),
    columns: { id: true },
  });
  return visible.map((w) => w.id);
}

function getWorkflowNameFromSnapshot(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null;

  const workflowSnapshot = (snapshot as { workflow?: unknown }).workflow;
  if (!workflowSnapshot || typeof workflowSnapshot !== 'object') return null;

  const name = (workflowSnapshot as { name?: unknown }).name;
  return typeof name === 'string' && name.trim().length > 0 ? name : null;
}

function getLatestQuotaWait(liveOutput: unknown): Record<string, unknown> | null {
  if (!Array.isArray(liveOutput)) return null;

  return liveOutput.reduce<Record<string, unknown> | null>((latest, event) => {
    if (!event || typeof event !== 'object') return latest;
    const typedEvent = event as Record<string, unknown>;
    if (typedEvent.type !== 'quota_wait') return latest;

    if (!latest) return typedEvent;
    const latestTime = typeof latest.timestamp === 'string' ? Date.parse(latest.timestamp) : 0;
    const eventTime = typeof typedEvent.timestamp === 'string' ? Date.parse(typedEvent.timestamp) : 0;
    return eventTime >= latestTime ? typedEvent : latest;
  }, null);
}

/** Helper: verify execution belongs to user's workspace */
async function verifyExecutionAccess(
  executionId: string,
  workspaceId: string | null,
  userId: string,
): Promise<{ execution: typeof workflowExecutions.$inferSelect; workflow: typeof workflows.$inferSelect } | null> {
  const execution = await db.query.workflowExecutions.findFirst({
    where: eq(workflowExecutions.id, executionId),
  });
  if (!execution) return null;

  const workflow = await db.query.workflows.findFirst({
    where: eq(workflows.id, execution.workflowId),
  });
  if (!workflow || workflow.workspaceId !== workspaceId) return null;

  // User can see workspace-scoped workflows or their own
  if (workflow.scope !== 'workspace' && workflow.userId !== userId) return null;

  return { execution, workflow };
}

// GET / — list executions (workspace-scoped)
const listExecutionsSchema = paginationSchema.extend({
  workflowId: z.string().uuid().optional(),
  // Accept a single status, comma-separated list, or repeated query params; downstream coerces to array
  status: z
    .union([
      z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']),
      z.string(),
      z.array(z.string()),
    ])
    .optional(),
});

executionsRouter.get('/', async (c) => {
  const user = c.get('user');
  if (!user.workspaceId) return c.json({ executions: [], total: 0, page: 1, limit: 50 });

  const query = listExecutionsSchema.parse(c.req.query());

  // Get workflow IDs visible to this user
  const visibleIds = await getVisibleWorkflowIds(user.workspaceId, user.userId);
  if (visibleIds.length === 0) return c.json({ executions: [], total: 0, page: query.page, limit: query.limit });

  const conditions = [inArray(workflowExecutions.workflowId, visibleIds)];
  if (query.workflowId) conditions.push(eq(workflowExecutions.workflowId, query.workflowId));
  if (query.status) {
    const allowed = new Set(['pending', 'running', 'completed', 'failed', 'cancelled']);
    const raw = Array.isArray(query.status) ? query.status : String(query.status).split(',');
    const statuses = raw.map((s) => s.trim()).filter((s) => s.length > 0 && allowed.has(s));
    if (statuses.length === 1) {
      conditions.push(eq(workflowExecutions.status, statuses[0] as 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'));
    } else if (statuses.length > 1) {
      conditions.push(inArray(workflowExecutions.status, statuses as ('pending' | 'running' | 'completed' | 'failed' | 'cancelled')[]));
    }
  }

  const where = and(...conditions);

  const [executions, countResult] = await Promise.all([
    db
      .select()
      .from(workflowExecutions)
      .where(where)
      .orderBy(desc(workflowExecutions.createdAt))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(workflowExecutions)
      .where(where),
  ]);

  const workflowIdsMissingSnapshotNames = [...new Set(executions
    .filter((execution) => !getWorkflowNameFromSnapshot(execution.workflowSnapshot))
    .map((execution) => execution.workflowId))];

  const workflowNameRows = workflowIdsMissingSnapshotNames.length > 0
    ? await db
      .select({ id: workflows.id, name: workflows.name })
      .from(workflows)
      .where(inArray(workflows.id, workflowIdsMissingSnapshotNames))
    : [];

  const workflowNameMap = new Map(workflowNameRows.map((workflow) => [workflow.id, workflow.name]));
  const executionIds = executions.map((execution) => execution.id);
  const quotaWaitByExecutionId = new Map<string, Record<string, unknown>>();

  if (executionIds.length > 0) {
    const pendingSteps = await db.query.stepExecutions.findMany({
      where: and(
        inArray(stepExecutions.workflowExecutionId, executionIds),
        eq(stepExecutions.status, 'pending'),
      ),
    });

    for (const step of pendingSteps) {
      const quotaWait = getLatestQuotaWait(step.liveOutput);
      if (!quotaWait) continue;

      const previous = quotaWaitByExecutionId.get(step.workflowExecutionId);
      const previousTime = typeof previous?.timestamp === 'string' ? Date.parse(previous.timestamp) : 0;
      const quotaWaitTime = typeof quotaWait.timestamp === 'string' ? Date.parse(quotaWait.timestamp) : 0;
      if (!previous || quotaWaitTime >= previousTime) {
        quotaWaitByExecutionId.set(step.workflowExecutionId, quotaWait);
      }
    }
  }

  const serializedExecutions = executions.map((execution) => ({
    ...execution,
    workflowName: getWorkflowNameFromSnapshot(execution.workflowSnapshot) ?? workflowNameMap.get(execution.workflowId) ?? null,
    quotaWait: quotaWaitByExecutionId.get(execution.id) ?? null,
  }));

  return c.json({
    executions: serializedExecutions,
    total: countResult[0].count,
    page: query.page,
    limit: query.limit,
  });
});

// GET /active — check for active (pending/running) executions for a workflow
// Used by the UI to poll status after manual trigger and prevent double submissions
executionsRouter.get('/active', async (c) => {
  const user = c.get('user');
  if (!user.workspaceId) return c.json({ executions: [] });

  const workflowId = c.req.query('workflowId');
  if (!workflowId || !uuidSchema.safeParse(workflowId).success) return c.json({ error: 'Valid workflowId query param required' }, 400);

  // Verify user can see this workflow
  const workflow = await db.query.workflows.findFirst({
    where: eq(workflows.id, workflowId),
  });
  if (!workflow || workflow.workspaceId !== user.workspaceId) return c.json({ executions: [] });
  if (workflow.scope === 'user' && workflow.userId !== user.userId && user.role !== 'workspace_admin' && user.role !== 'super_admin') {
    return c.json({ executions: [] });
  }

  const active = await db
    .select()
    .from(workflowExecutions)
    .where(
      and(
        eq(workflowExecutions.workflowId, workflowId),
        sql`${workflowExecutions.status} IN ('pending', 'running')`,
      ),
    )
    .orderBy(desc(workflowExecutions.createdAt))
    .limit(5);

  return c.json({ executions: active });
});

// GET /stream/all — SSE stream for all execution updates (listing page)
executionsRouter.get('/stream/all', async (c) => {
  const user = c.get('user');
  if (!user.workspaceId) return c.json({ error: 'No workspace' }, 400);

  const workspaceId = user.workspaceId;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Stream closed
        }
      };

      send('connected', { workspaceId });

      const unsubscribe = onRealtimeEvent((event: RealtimeEvent) => {
        if (event.workspaceId !== workspaceId) return;
        send(event.type, event);
      });

      c.req.raw.signal.addEventListener('abort', () => {
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

// GET /:id — full execution detail with step executions (workspace-scoped)
executionsRouter.get('/:id', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));

  const result = await verifyExecutionAccess(id, user.workspaceId, user.userId);
  if (!result) return c.json({ error: 'Execution not found' }, 404);

  const steps = await db.query.stepExecutions.findMany({
    where: eq(stepExecutions.workflowExecutionId, id),
    orderBy: stepExecutions.stepOrder,
  });

  // Resolve trigger details if execution was triggered by a trigger
  let trigger = null;
  if (result.execution.triggerId) {
    trigger = await db.query.triggers.findFirst({
      where: eq(triggers.id, result.execution.triggerId),
    });
  }

  return c.json({ execution: result.execution, steps, workflow: result.workflow, trigger });
});

// POST /:id/cancel — cancel a running execution (workspace-scoped)
executionsRouter.post('/:id/cancel', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));

  const result = await verifyExecutionAccess(id, user.workspaceId, user.userId);
  if (!result) return c.json({ error: 'Execution not found' }, 404);

  if (result.execution.status !== 'pending' && result.execution.status !== 'running') {
    return c.json({ error: 'Can only cancel pending or running executions' }, 400);
  }

  const [updated] = await db
    .update(workflowExecutions)
    .set({ status: 'cancelled', completedAt: new Date() })
    .where(eq(workflowExecutions.id, id))
    .returning();

  // Mark pending steps as skipped
  await db
    .update(stepExecutions)
    .set({ status: 'skipped' })
    .where(and(eq(stepExecutions.workflowExecutionId, id), eq(stepExecutions.status, 'pending')));

  return c.json({ execution: updated });
});

// POST /:id/retry — retry a failed execution from the last failed step (workspace-scoped)
executionsRouter.post('/:id/retry', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));

  const result = await verifyExecutionAccess(id, user.workspaceId, user.userId);
  if (!result) return c.json({ error: 'Execution not found' }, 404);

  if (result.execution.status !== 'failed') {
    return c.json({ error: 'Only failed executions can be retried' }, 400);
  }

  const newExecution = await retryWorkflowExecution(id);
  return c.json({ execution: newExecution }, 201);
});

// GET /:id/steps/:stepId/live — get live intermediate output for a running step
executionsRouter.get('/:id/steps/:stepId/live', async (c) => {
  const user = c.get('user');
  const executionId = uuidSchema.parse(c.req.param('id'));
  const stepId = uuidSchema.parse(c.req.param('stepId'));

  const result = await verifyExecutionAccess(executionId, user.workspaceId, user.userId);
  if (!result) return c.json({ error: 'Execution not found' }, 404);

  const stepExec = await db.query.stepExecutions.findFirst({
    where: and(
      eq(stepExecutions.id, stepId),
      eq(stepExecutions.workflowExecutionId, executionId),
    ),
  });
  if (!stepExec) return c.json({ error: 'Step execution not found' }, 404);

  return c.json({
    stepExecutionId: stepExec.id,
    status: stepExec.status,
    liveOutput: stepExec.liveOutput ?? [],
    output: stepExec.output,
  });
});

// GET /:id/stream — SSE stream for real-time execution updates
executionsRouter.get('/:id/stream', async (c) => {
  const user = c.get('user');
  const executionId = uuidSchema.parse(c.req.param('id'));

  const result = await verifyExecutionAccess(executionId, user.workspaceId, user.userId);
  if (!result) return c.json({ error: 'Execution not found' }, 404);

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Stream closed
        }
      };

      // Send initial state
      send('connected', { executionId });

      // Listen for realtime events filtered to this execution
      const unsubscribe = onRealtimeEvent((event: RealtimeEvent) => {
        if (event.executionId !== executionId) return;
        send(event.type, event);
      });

      // Clean up when client disconnects
      c.req.raw.signal.addEventListener('abort', () => {
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

export default executionsRouter;
