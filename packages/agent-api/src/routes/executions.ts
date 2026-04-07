import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../database/index.js';
import { workflowExecutions, stepExecutions, workflows } from '../database/schema.js';
import { authMiddleware, paginationSchema, uuidSchema } from '@ai-trader/shared';
import { retryWorkflowExecution } from '../services/workflow-engine.js';

const executionsRouter = new Hono();
executionsRouter.use('/*', authMiddleware);

// GET / — list executions
const listExecutionsSchema = paginationSchema.extend({
  workflowId: z.string().uuid().optional(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']).optional(),
});

executionsRouter.get('/', async (c) => {
  const query = listExecutionsSchema.parse(c.req.query());
  const conditions = [];

  if (query.workflowId) conditions.push(eq(workflowExecutions.workflowId, query.workflowId));
  if (query.status) conditions.push(eq(workflowExecutions.status, query.status));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

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

// GET /:id — full execution detail with step executions
executionsRouter.get('/:id', async (c) => {
  const id = uuidSchema.parse(c.req.param('id'));

  const execution = await db.query.workflowExecutions.findFirst({
    where: eq(workflowExecutions.id, id),
  });
  if (!execution) return c.json({ error: 'Execution not found' }, 404);

  const steps = await db.query.stepExecutions.findMany({
    where: eq(stepExecutions.workflowExecutionId, id),
    orderBy: stepExecutions.stepOrder,
  });

  const workflow = await db.query.workflows.findFirst({
    where: eq(workflows.id, execution.workflowId),
  });

  return c.json({ execution, steps, workflow });
});

// POST /:id/cancel — cancel a running execution
executionsRouter.post('/:id/cancel', async (c) => {
  const id = uuidSchema.parse(c.req.param('id'));

  const execution = await db.query.workflowExecutions.findFirst({
    where: eq(workflowExecutions.id, id),
  });
  if (!execution) return c.json({ error: 'Execution not found' }, 404);

  if (execution.status !== 'pending' && execution.status !== 'running') {
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

// POST /:id/retry — retry a failed execution from the last failed step
executionsRouter.post('/:id/retry', async (c) => {
  const id = uuidSchema.parse(c.req.param('id'));

  const execution = await db.query.workflowExecutions.findFirst({
    where: eq(workflowExecutions.id, id),
  });
  if (!execution) return c.json({ error: 'Execution not found' }, 404);

  if (execution.status !== 'failed') {
    return c.json({ error: 'Only failed executions can be retried' }, 400);
  }

  const newExecution = await retryWorkflowExecution(id);
  return c.json({ execution: newExecution }, 201);
});

export default executionsRouter;
