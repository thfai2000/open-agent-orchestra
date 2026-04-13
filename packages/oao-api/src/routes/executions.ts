import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { db } from '../database/index.js';
import { workflowExecutions, stepExecutions, workflows, triggers } from '../database/schema.js';
import { authMiddleware, paginationSchema, uuidSchema } from '@oao/shared';
import { retryWorkflowExecution } from '../services/workflow-engine.js';

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
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']).optional(),
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
  if (query.status) conditions.push(eq(workflowExecutions.status, query.status));

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

  return c.json({
    executions,
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
  if (!workflowId) return c.json({ error: 'workflowId query param required' }, 400);

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

export default executionsRouter;
