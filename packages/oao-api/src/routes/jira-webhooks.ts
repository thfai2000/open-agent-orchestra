import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { createLogger, decrypt } from '@oao/shared';
import { db } from '../database/index.js';
import { triggers, workflows } from '../database/schema.js';
import { buildJiraWebhookInputs } from '../services/jira-integration.js';
import { emitEvent, EVENT_NAMES } from '../services/system-events.js';

const logger = createLogger('jira-webhooks');
const jiraWebhooksRouter = new Hono();

const processedWebhookEvents = new Map<string, number>();
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [eventKey, timestamp] of processedWebhookEvents) {
    if (timestamp < cutoff) {
      processedWebhookEvents.delete(eventKey);
    }
  }
}, 60_000);

function secureCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getEncryptedCallbackToken(trigger: typeof triggers.$inferSelect) {
  const runtimeState = trigger.runtimeState && typeof trigger.runtimeState === 'object'
    ? trigger.runtimeState as Record<string, unknown>
    : {};

  return typeof runtimeState.callbackTokenEncrypted === 'string'
    ? runtimeState.callbackTokenEncrypted
    : null;
}

jiraWebhooksRouter.get('/:triggerId', async (c) => {
  const triggerId = c.req.param('triggerId');
  const callbackToken = c.req.query('token');
  const trigger = await db.query.triggers.findFirst({
    where: and(eq(triggers.id, triggerId), eq(triggers.triggerType, 'jira_changes_notification')),
  });

  if (!trigger) {
    return c.json({ error: 'Trigger not found' }, 404);
  }

  const encryptedToken = getEncryptedCallbackToken(trigger);
  if (!callbackToken || !encryptedToken || !secureCompare(callbackToken, decrypt(encryptedToken))) {
    return c.json({ error: 'Invalid Jira callback token' }, 401);
  }

  return c.json({ status: 'reachable', triggerId: trigger.id, isActive: trigger.isActive }, 200);
});

jiraWebhooksRouter.post('/:triggerId', async (c) => {
  const triggerId = c.req.param('triggerId');
  const callbackToken = c.req.query('token');
  const trigger = await db.query.triggers.findFirst({
    where: and(eq(triggers.id, triggerId), eq(triggers.triggerType, 'jira_changes_notification')),
  });

  if (!trigger || !trigger.isActive) {
    return c.json({ error: 'Trigger not found' }, 404);
  }

  const encryptedToken = getEncryptedCallbackToken(trigger);
  if (!callbackToken || !encryptedToken || !secureCompare(callbackToken, decrypt(encryptedToken))) {
    return c.json({ error: 'Invalid Jira callback token' }, 401);
  }

  const workflow = await db.query.workflows.findFirst({ where: eq(workflows.id, trigger.workflowId) });
  if (!workflow?.isActive || !workflow.workspaceId) {
    return c.json({ error: 'Workflow not available' }, 404);
  }

  const rawBody = await c.req.text();
  let payload: Record<string, unknown>;
  try {
    payload = rawBody ? JSON.parse(rawBody) as Record<string, unknown> : {};
  } catch {
    return c.json({ error: 'Invalid Jira webhook payload' }, 400);
  }

  const headerEventId = c.req.header('X-Atlassian-Webhook-Identifier') || c.req.header('X-Event-Id');
  const derivedEventId = headerEventId || createHash('sha256').update(rawBody).digest('hex');
  if (processedWebhookEvents.has(derivedEventId)) {
    return c.json({ status: 'already_processed' }, 200);
  }
  processedWebhookEvents.set(derivedEventId, Date.now());

  const inputs = buildJiraWebhookInputs(trigger, payload);
  await emitEvent({
    eventScope: 'workspace',
    scopeId: workflow.workspaceId,
    eventName: EVENT_NAMES.WEBHOOK_RECEIVED,
    eventData: {
      triggerId: trigger.id,
      workflowId: trigger.workflowId,
      triggerType: 'jira_changes_notification',
      source: 'jira',
      authMethod: 'jira_callback',
      eventId: derivedEventId,
      payload,
      inputs,
      receivedAt: new Date().toISOString(),
    },
  });

  logger.info({ triggerId, workflowId: trigger.workflowId, eventId: derivedEventId }, 'Accepted Jira webhook callback');
  return c.json({ status: 'accepted' }, 202);
});

export default jiraWebhooksRouter;