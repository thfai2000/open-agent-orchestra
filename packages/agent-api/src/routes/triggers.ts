import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { db } from '../database/index.js';
import { triggers, workflows } from '../database/schema.js';
import { authMiddleware, uuidSchema } from '@ai-trader/shared';

const triggersRouter = new Hono();
triggersRouter.use('/*', authMiddleware);

/** Helper: verify trigger belongs to a workflow in the user's workspace */
async function verifyTriggerAccess(
  triggerId: string,
  workspaceId: string | null,
  userId: string,
  userRole: string,
): Promise<{ trigger: typeof triggers.$inferSelect; workflow: typeof workflows.$inferSelect } | null> {
  const trigger = await db.query.triggers.findFirst({ where: eq(triggers.id, triggerId) });
  if (!trigger) return null;
  const workflow = await db.query.workflows.findFirst({ where: eq(workflows.id, trigger.workflowId) });
  if (!workflow || workflow.workspaceId !== workspaceId) return null;
  if (workflow.scope === 'user' && workflow.userId !== userId && userRole !== 'workspace_admin' && userRole !== 'super_admin') return null;
  return { trigger, workflow };
}

// GET / — list triggers (workspace-scoped, requires workflowId)
triggersRouter.get('/', async (c) => {
  const user = c.get('user');
  const workflowId = c.req.query('workflowId');

  if (!user.workspaceId) return c.json({ triggers: [] });

  if (workflowId) {
    // Verify workflow belongs to user's workspace
    const workflow = await db.query.workflows.findFirst({ where: eq(workflows.id, workflowId) });
    if (!workflow || workflow.workspaceId !== user.workspaceId) return c.json({ triggers: [] });
    if (workflow.scope === 'user' && workflow.userId !== user.userId && user.role !== 'workspace_admin' && user.role !== 'super_admin') {
      return c.json({ triggers: [] });
    }
    const triggerList = await db.query.triggers.findMany({ where: eq(triggers.workflowId, workflowId) });
    return c.json({ triggers: triggerList });
  }

  // List triggers for all workspace-visible workflows
  const visibleWorkflows = await db.query.workflows.findMany({
    where: and(
      eq(workflows.workspaceId, user.workspaceId),
      sql`(${workflows.scope} = 'workspace' OR ${workflows.userId} = ${user.userId})`,
    ),
    columns: { id: true },
  });
  const visibleIds = visibleWorkflows.map((w) => w.id);
  if (visibleIds.length === 0) return c.json({ triggers: [] });

  const triggerList = await db.query.triggers.findMany({
    where: inArray(triggers.workflowId, visibleIds),
  });
  return c.json({ triggers: triggerList });
});

// POST / — create trigger (workspace-scoped)
const createTriggerSchema = z.object({
  workflowId: z.string().uuid(),
  triggerType: z.enum(['time_schedule', 'exact_datetime', 'webhook', 'event']),
  configuration: z.record(z.unknown()).default({}),
});

triggersRouter.post('/', async (c) => {
  const user = c.get('user');
  const body = createTriggerSchema.parse(await c.req.json());

  // Verify workflow exists and belongs to user's workspace
  const workflow = await db.query.workflows.findFirst({
    where: eq(workflows.id, body.workflowId),
  });
  if (!workflow) return c.json({ error: 'Workflow not found' }, 404);
  if (workflow.workspaceId !== user.workspaceId) return c.json({ error: 'Forbidden' }, 403);

  // Scope-based authorization
  if (workflow.scope === 'workspace' && user.role !== 'workspace_admin' && user.role !== 'super_admin') {
    return c.json({ error: 'Only admins can modify workspace-level workflow triggers' }, 403);
  }
  if (workflow.scope === 'user' && workflow.userId !== user.userId && user.role !== 'workspace_admin' && user.role !== 'super_admin') {
    return c.json({ error: 'Forbidden' }, 403);
  }

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

// PUT /:id — update trigger (workspace-scoped)
const updateTriggerSchema = z.object({
  configuration: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

triggersRouter.put('/:id', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));
  const body = updateTriggerSchema.parse(await c.req.json());

  const access = await verifyTriggerAccess(id, user.workspaceId, user.userId, user.role);
  if (!access) return c.json({ error: 'Trigger not found' }, 404);

  // Only admins or workflow owner can modify
  if (access.workflow.scope === 'workspace' && user.role !== 'workspace_admin' && user.role !== 'super_admin') {
    return c.json({ error: 'Only admins can modify workspace-level workflow triggers' }, 403);
  }

  const [updated] = await db.update(triggers).set(body).where(eq(triggers.id, id)).returning();
  return c.json({ trigger: updated });
});

// DELETE /:id (workspace-scoped)
triggersRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));

  const access = await verifyTriggerAccess(id, user.workspaceId, user.userId, user.role);
  if (!access) return c.json({ error: 'Trigger not found' }, 404);

  if (access.workflow.scope === 'workspace' && user.role !== 'workspace_admin' && user.role !== 'super_admin') {
    return c.json({ error: 'Only admins can delete workspace-level workflow triggers' }, 403);
  }

  await db.delete(triggers).where(eq(triggers.id, id));
  return c.json({ success: true });
});

export default triggersRouter;
