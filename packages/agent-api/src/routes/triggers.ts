import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../database/index.js';
import { triggers, workflows } from '../database/schema.js';
import { authMiddleware, uuidSchema } from '@ai-trader/shared';

const triggersRouter = new Hono();
triggersRouter.use('/*', authMiddleware);

// GET / — list triggers
triggersRouter.get('/', async (c) => {
  const workflowId = c.req.query('workflowId');

  const triggerList = workflowId
    ? await db.query.triggers.findMany({ where: eq(triggers.workflowId, workflowId) })
    : await db.query.triggers.findMany();

  return c.json({ triggers: triggerList });
});

// POST / — create trigger
const createTriggerSchema = z.object({
  workflowId: z.string().uuid(),
  triggerType: z.enum(['time_schedule', 'webhook', 'event']),
  configuration: z.record(z.unknown()).default({}),
});

triggersRouter.post('/', async (c) => {
  const body = createTriggerSchema.parse(await c.req.json());

  // Verify workflow exists
  const workflow = await db.query.workflows.findFirst({
    where: eq(workflows.id, body.workflowId),
  });
  if (!workflow) return c.json({ error: 'Workflow not found' }, 404);

  // Validate webhook path uniqueness
  if (body.triggerType === 'webhook' && body.configuration.path) {
    const existingTrigger = await db.query.triggers.findFirst({
      where: and(
        eq(triggers.triggerType, 'webhook'),
        sql`configuration->>'path' = ${String(body.configuration.path)}`,
      ),
    });
    if (existingTrigger) {
      return c.json({ error: `Webhook path "${body.configuration.path}" is already in use` }, 409);
    }
  }

  const [trigger] = await db
    .insert(triggers)
    .values({
      workflowId: body.workflowId,
      triggerType: body.triggerType,
      configuration: body.configuration,
    })
    .returning();

  return c.json({ trigger }, 201);
});

// PUT /:id — update trigger
const updateTriggerSchema = z.object({
  configuration: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

triggersRouter.put('/:id', async (c) => {
  const id = uuidSchema.parse(c.req.param('id'));
  const body = updateTriggerSchema.parse(await c.req.json());

  const [updated] = await db.update(triggers).set(body).where(eq(triggers.id, id)).returning();

  if (!updated) return c.json({ error: 'Trigger not found' }, 404);
  return c.json({ trigger: updated });
});

// DELETE /:id
triggersRouter.delete('/:id', async (c) => {
  const id = uuidSchema.parse(c.req.param('id'));
  await db.delete(triggers).where(eq(triggers.id, id));
  return c.json({ success: true });
});

export default triggersRouter;
