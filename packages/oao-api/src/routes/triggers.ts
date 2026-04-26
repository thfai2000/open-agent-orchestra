import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { db } from '../database/index.js';
import { triggers, workflows } from '../database/schema.js';
import { authMiddleware, uuidSchema } from '@oao/shared';
import { captureWorkflowHistoricalVersion } from '../services/versioning.js';
import {
  creatableTriggerTypeSchema,
  getTriggerCatalog,
  getTriggerTypeLabel,
  safeParseTriggerConfiguration,
} from '../services/trigger-definitions.js';
import { serializeTrigger, serializeTriggers } from '../services/trigger-serialization.js';
import {
  createWorkflowTrigger,
  deleteWorkflowTrigger,
  updateWorkflowTrigger,
} from '../services/trigger-manager.js';
import { TriggerServiceError } from '../services/trigger-errors.js';
import {
  testJiraChangesNotificationTriggerConnectivity,
  testJiraPollingTriggerConnectivity,
  forcePollSingleJiraTrigger,
  simulateJiraChangesNotificationFire,
} from '../services/jira-integration.js';

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

// GET /types — shared trigger catalog for the UI
triggersRouter.get('/types', async (c) => {
  return c.json({ types: getTriggerCatalog() });
});

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
    return c.json({ triggers: serializeTriggers(triggerList) });
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
  return c.json({ triggers: serializeTriggers(triggerList) });
});

// POST / — create trigger (workspace-scoped)
const createTriggerSchema = z.object({
  workflowId: z.string().uuid(),
  triggerType: creatableTriggerTypeSchema,
  configuration: z.record(z.unknown()).default({}),
  isActive: z.boolean().optional(),
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

  await captureWorkflowHistoricalVersion(workflow, user.userId);

  let trigger;
  try {
    trigger = await createWorkflowTrigger({
      workflow,
      triggerType: body.triggerType,
      configuration: body.configuration,
      isActive: body.isActive,
    });
  } catch (error) {
    if (error instanceof TriggerServiceError) {
      return c.json({ error: error.message, issues: error.issues }, error.status);
    }
    throw error;
  }

  await db
    .update(workflows)
    .set({ version: sql`${workflows.version} + 1`, updatedAt: new Date() })
    .where(eq(workflows.id, workflow.id));

  return c.json({ trigger: serializeTrigger(trigger) }, 201);
});

// PUT /:id — update trigger configuration, type, or enabled state
const updateTriggerSchema = z.object({
  triggerType: creatableTriggerTypeSchema.optional(),
  configuration: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

triggersRouter.put('/:id', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));

  const access = await verifyTriggerAccess(id, user.workspaceId, user.userId, user.role);
  if (!access) return c.json({ error: 'Trigger not found' }, 404);

  if (access.workflow.scope === 'workspace' && user.role !== 'workspace_admin' && user.role !== 'super_admin') {
    return c.json({ error: 'Only admins can modify workspace-level workflow triggers' }, 403);
  }

  const body = updateTriggerSchema.parse(await c.req.json());

  if (body.triggerType === undefined && body.configuration === undefined && body.isActive === undefined) {
    return c.json({ trigger: serializeTrigger(access.trigger) });
  }

  await captureWorkflowHistoricalVersion(access.workflow, user.userId);

  let trigger;
  try {
    trigger = await updateWorkflowTrigger({
      workflow: access.workflow,
      trigger: access.trigger,
      triggerType: body.triggerType,
      configuration: body.configuration,
      isActive: body.isActive,
    });
  } catch (error) {
    if (error instanceof TriggerServiceError) {
      return c.json({ error: error.message, issues: error.issues }, error.status);
    }
    throw error;
  }

  await db
    .update(workflows)
    .set({ version: sql`${workflows.version} + 1`, updatedAt: new Date() })
    .where(eq(workflows.id, access.workflow.id));

  return c.json({ trigger: serializeTrigger(trigger) });
});

// POST /:id/test — run trigger connectivity validation
triggersRouter.post('/:id/test', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));

  const access = await verifyTriggerAccess(id, user.workspaceId, user.userId, user.role);
  if (!access) return c.json({ error: 'Trigger not found' }, 404);

  if (access.workflow.scope === 'workspace' && user.role !== 'workspace_admin' && user.role !== 'super_admin') {
    return c.json({ error: 'Only admins can test workspace-level workflow triggers' }, 403);
  }

  try {
    if (access.trigger.triggerType === 'jira_changes_notification') {
      return c.json(await testJiraChangesNotificationTriggerConnectivity(access.workflow, access.trigger));
    }

    if (access.trigger.triggerType === 'jira_polling') {
      return c.json(await testJiraPollingTriggerConnectivity(access.workflow, access.trigger));
    }

    if (access.trigger.triggerType === 'manual') {
      return c.json({ ok: true, summary: 'Manual triggers do not require connectivity checks.' });
    }

    const validationResult = safeParseTriggerConfiguration(
      access.trigger.triggerType as typeof creatableTriggerTypeSchema._type,
      access.trigger.configuration,
    );

    if (!validationResult.success) {
      return c.json({
        ok: false,
        summary: `${getTriggerTypeLabel(access.trigger.triggerType)} configuration is invalid.`,
        issues: validationResult.error.issues,
      }, 400);
    }

    return c.json({
      ok: true,
      summary: `${getTriggerTypeLabel(access.trigger.triggerType)} configuration is valid.`,
    });
  } catch (error) {
    if (error instanceof TriggerServiceError) {
      return c.json({ ok: false, summary: error.message, issues: error.issues }, error.status);
    }
    throw error;
  }
});

// POST /:id/fire — force-fire a Jira trigger for testing purposes
// For jira_polling: polls Jira immediately and enqueues an execution if issues are found.
// For jira_changes_notification: accepts a mock payload and enqueues an execution.
const fireTriggerSchema = z.object({
  payload: z.record(z.unknown()).optional(),
});

triggersRouter.post('/:id/fire', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));

  const access = await verifyTriggerAccess(id, user.workspaceId, user.userId, user.role);
  if (!access) return c.json({ error: 'Trigger not found' }, 404);

  // Only admins can force-fire triggers
  if (user.role !== 'workspace_admin' && user.role !== 'super_admin') {
    return c.json({ error: 'Only admins can force-fire triggers' }, 403);
  }

  const body = fireTriggerSchema.parse(await c.req.json().catch(() => ({})));

  try {
    if (access.trigger.triggerType === 'jira_polling') {
      const result = await forcePollSingleJiraTrigger(id);
      return c.json({ fired: result.fired, executionId: result.executionId, issueCount: result.issueCount });
    }

    if (access.trigger.triggerType === 'jira_changes_notification') {
      const mockPayload = body.payload ?? {};
      const result = await simulateJiraChangesNotificationFire(access.workflow.id, id, mockPayload);
      return c.json({ fired: true, executionId: result.executionId });
    }

    return c.json({ error: `Trigger type ${access.trigger.triggerType} does not support force-fire` }, 400);
  } catch (error) {
    if (error instanceof TriggerServiceError) {
      return c.json({ error: error.message, issues: error.issues }, error.status);
    }
    throw error;
  }
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

  await captureWorkflowHistoricalVersion(access.workflow, user.userId);

  await deleteWorkflowTrigger({ workflow: access.workflow, trigger: access.trigger });

  await db
    .update(workflows)
    .set({ version: sql`${workflows.version} + 1`, updatedAt: new Date() })
    .where(eq(workflows.id, access.workflow.id));

  return c.json({ success: true });
});

export default triggersRouter;
