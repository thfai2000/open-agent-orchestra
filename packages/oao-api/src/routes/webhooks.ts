import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../database/index.js';
import { webhookRegistrations, triggers, agents } from '../database/schema.js';
import { decrypt, createLogger } from '@oao/shared';
import { emitEvent, EVENT_NAMES } from '../services/system-events.js';
import { validatePat } from './tokens.js';

const logger = createLogger('agent-webhooks');
const webhooks = new Hono();

// Dedup cache for event IDs (in-memory, 5-minute window)
const processedEvents = new Map<string, number>();
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [key, time] of processedEvents) {
    if (time < cutoff) processedEvents.delete(key);
  }
}, 60_000);

// POST /:registrationId — receive webhook event
// Supports two auth methods:
//   1. HMAC signature (X-Signature + X-Timestamp headers)
//   2. PAT with 'webhook:trigger' scope (Authorization: Bearer oao_...)
webhooks.post('/:registrationId', async (c) => {
  const registrationId = c.req.param('registrationId');
  const signature = c.req.header('X-Signature');
  const timestamp = c.req.header('X-Timestamp');
  const eventId = c.req.header('X-Event-Id');
  const authHeader = c.req.header('Authorization');

  // ── Auth method 1: PAT with webhook:trigger scope ──
  const patToken = authHeader?.startsWith('Bearer oao_') ? authHeader.slice(7) : null;
  let authedViaPat = false;

  if (patToken) {
    const patUser = await validatePat(patToken);
    if (!patUser) {
      return c.json({ error: 'Invalid, expired, or revoked token' }, 401);
    }
    if (!patUser.scopes.includes('webhook:trigger')) {
      return c.json({ error: 'Token missing webhook:trigger scope' }, 403);
    }
    authedViaPat = true;
  }

  // ── Auth method 2: HMAC signature ──
  if (!authedViaPat) {
    if (!signature || !timestamp) {
      return c.json({ error: 'Missing signature or timestamp' }, 401);
    }

    // Replay protection: 5-minute window
    const ts = parseInt(timestamp, 10);
    if (isNaN(ts) || Math.abs(Date.now() - ts * 1000) > 5 * 60 * 1000) {
      return c.json({ error: 'Timestamp out of range' }, 401);
    }
  }

  // Event ID dedup
  if (eventId && processedEvents.has(eventId)) {
    return c.json({ status: 'already_processed' }, 200);
  }

  // Look up registration
  const registration = await db.query.webhookRegistrations.findFirst({
    where: eq(webhookRegistrations.id, registrationId),
  });
  if (!registration || !registration.isActive) {
    return c.json({ error: 'Registration not found' }, 404);
  }

  // Verify HMAC signature (only when not authed via PAT)
  const body = await c.req.text();
  if (!authedViaPat) {
    const secret = decrypt(registration.hmacSecretEncrypted);
    const expectedSig = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

    if (!timingSafeEqual(Buffer.from(signature!), Buffer.from(expectedSig))) {
      return c.json({ error: 'Invalid signature' }, 401);
    }
  }

  // Mark event as processed
  if (eventId) processedEvents.set(eventId, Date.now());

  // Update registration stats
  await db
    .update(webhookRegistrations)
    .set({
      requestCount: registration.requestCount + 1,
      lastReceivedAt: new Date(),
    })
    .where(eq(webhookRegistrations.id, registrationId));

  // Find associated trigger and emit webhook event for async processing
  if (registration.triggerId) {
    const trigger = await db.query.triggers.findFirst({
      where: eq(triggers.id, registration.triggerId),
    });

    if (trigger && trigger.isActive) {
      let payload: Record<string, unknown> = {};
      try { payload = body ? JSON.parse(body) : {}; } catch { /* non-JSON body */ }

      // Validate webhook parameters if defined
      const config = (trigger.configuration || {}) as Record<string, unknown>;
      const paramDefs = Array.isArray(config.parameters) ? config.parameters as Array<{ name: string; required?: boolean }> : [];
      if (paramDefs.length > 0) {
        const missing = paramDefs.filter(p => p.required && (payload[p.name] === undefined || payload[p.name] === null || payload[p.name] === ''));
        if (missing.length > 0) {
          return c.json({ error: `Missing required parameters: ${missing.map(p => p.name).join(', ')}` }, 400);
        }
      }

      // Build validated inputs from defined parameters
      const inputs: Record<string, unknown> = {};
      for (const p of paramDefs) {
        if (payload[p.name] !== undefined) inputs[p.name] = payload[p.name];
      }

      // Look up agent to get workspaceId for event scoping
      const agent = registration.agentId
        ? await db.query.agents.findFirst({ where: eq(agents.id, registration.agentId) })
        : null;

      const workspaceId = agent?.workspaceId;
      if (workspaceId) {
        await emitEvent({
          eventScope: 'workspace',
          scopeId: workspaceId,
          eventName: EVENT_NAMES.WEBHOOK_RECEIVED,
          eventData: {
            registrationId,
            triggerId: trigger.id,
            workflowId: trigger.workflowId,
            authMethod: authedViaPat ? 'pat' : 'hmac',
            eventId,
            payload,
            inputs,
            receivedAt: new Date().toISOString(),
          },
        });
      }

      logger.info({ registrationId, triggerId: trigger.id, authMethod: authedViaPat ? 'pat' : 'hmac' }, 'Webhook event emitted for async processing');
    }
  }

  return c.json({ status: 'accepted' }, 202);
});

export default webhooks;
