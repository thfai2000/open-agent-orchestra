import { eq, and, gte } from 'drizzle-orm';
import { createLogger } from '@oao/shared';
import { db } from '../database/index.js';
import { triggers, workflows, systemEvents } from '../database/schema.js';
import { enqueueWorkflowExecution } from '../services/workflow-engine.js';
import { getRedisConnection } from '../services/redis.js';
import {
  maintainJiraChangesNotificationTriggers,
  pollJiraPollingTriggers,
} from '../services/jira-integration.js';
import {
  cleanupStaleStaticInstances,
  markStaleInstancesOffline,
} from '../services/agent-instance-registry.js';
import { startWorker, stopWorker } from './workflow-worker.js';

const logger = createLogger('controller');
const POLL_INTERVAL = parseInt(process.env.CONTROLLER_POLL_INTERVAL || '30000', 10);
const LEADER_LOCK_KEY = 'controller:leader';
const LEADER_LOCK_TTL = 60; // seconds
const LAST_EVENT_CURSOR_KEY = 'controller:last-event-cursor';
const AGENT_INSTANCE_MAINTENANCE_INTERVAL_MS = parseInt(process.env.AGENT_INSTANCE_MAINTENANCE_INTERVAL_MS || '3600000', 10);
const STALE_STATIC_INSTANCE_CLEANUP_MS = parseInt(process.env.STALE_STATIC_INSTANCE_CLEANUP_MS || String(24 * 60 * 60 * 1000), 10);
let lastAgentInstanceCleanupAt = 0;

/**
 * Simple cron parser: checks if a cron expression matches the current time.
 * Supports: minute hour dayOfMonth month dayOfWeek
 * This is a basic implementation; in production use a library like cron-parser.
 */
function cronMatchesNow(cronExpr: string): boolean {
  const parts = cronExpr.split(/\s+/);
  if (parts.length !== 5) return false;

  const now = new Date();
  const checks = [
    { value: now.getMinutes(), field: parts[0] },
    { value: now.getHours(), field: parts[1] },
    { value: now.getDate(), field: parts[2] },
    { value: now.getMonth() + 1, field: parts[3] },
    { value: now.getDay(), field: parts[4] },
  ];

  return checks.every(({ value, field }) => {
    if (field === '*') return true;
    // Handle lists (1,2,3)
    if (field.includes(',')) {
      return field.split(',').map(Number).includes(value);
    }
    // Handle ranges (1-5)
    if (field.includes('-')) {
      const [min, max] = field.split('-').map(Number);
      return value >= min && value <= max;
    }
    // Handle step (*/5)
    if (field.startsWith('*/')) {
      const step = parseInt(field.slice(2), 10);
      return value % step === 0;
    }
    return parseInt(field, 10) === value;
  });
}

const INSTANCE_ID = `controller:${process.pid}:${Date.now()}`;

export async function acquireLeaderLock(): Promise<boolean> {
  const redis = getRedisConnection();
  const result = await redis.set(LEADER_LOCK_KEY, INSTANCE_ID, 'EX', LEADER_LOCK_TTL, 'NX');
  return result === 'OK';
}

export async function renewLeaderLock(): Promise<boolean> {
  const redis = getRedisConnection();
  const current = await redis.get(LEADER_LOCK_KEY);
  if (current !== INSTANCE_ID) return false;
  const result = await redis.expire(LEADER_LOCK_KEY, LEADER_LOCK_TTL);
  return result === 1;
}

async function pollTriggers() {
  try {
    // Get all active time-schedule triggers
    const activeTriggers = await db.query.triggers.findMany({
      where: and(eq(triggers.triggerType, 'time_schedule'), eq(triggers.isActive, true)),
    });

    for (const trigger of activeTriggers) {
      const config = trigger.configuration as Record<string, unknown>;
      const cronExpr = config.cron as string | undefined;

      if (!cronExpr) continue;

      // Check if cron matches current time
      if (!cronMatchesNow(cronExpr)) continue;

      // Check if already fired in this minute
      if (trigger.lastFiredAt) {
        const lastFired = new Date(trigger.lastFiredAt);
        const now = new Date();
        if (
          lastFired.getFullYear() === now.getFullYear() &&
          lastFired.getMonth() === now.getMonth() &&
          lastFired.getDate() === now.getDate() &&
          lastFired.getHours() === now.getHours() &&
          lastFired.getMinutes() === now.getMinutes()
        ) {
          continue; // Already fired this minute
        }
      }

      // Check workflow is active
      const workflow = await db.query.workflows.findFirst({
        where: eq(workflows.id, trigger.workflowId),
      });
      if (!workflow?.isActive) continue;

      // Enqueue workflow execution
      await enqueueWorkflowExecution(trigger.workflowId, trigger.id, {
        type: 'time_schedule',
        cron: cronExpr,
        firedAt: new Date().toISOString(),
      });

      // Update last fired time
      await db.update(triggers).set({ lastFiredAt: new Date() }).where(eq(triggers.id, trigger.id));

      logger.info(
        { triggerId: trigger.id, workflowId: trigger.workflowId, cron: cronExpr },
        'Trigger fired',
      );
    }
  } catch (error) {
    logger.error({ error }, 'Error polling triggers');
  }
}

/**
 * Poll for exact datetime triggers that have reached their scheduled time.
 * Fires once and deactivates the trigger.
 */
async function pollExactDatetimeTriggers() {
  try {
    const activeTriggers = await db.query.triggers.findMany({
      where: and(eq(triggers.triggerType, 'exact_datetime'), eq(triggers.isActive, true)),
    });

    const now = new Date();

    for (const trigger of activeTriggers) {
      const config = trigger.configuration as Record<string, unknown>;
      const datetimeStr = config.datetime as string | undefined;

      if (!datetimeStr) continue;

      const scheduledTime = new Date(datetimeStr);
      if (isNaN(scheduledTime.getTime())) continue;

      // Check if scheduled time has passed
      if (scheduledTime > now) continue;

      // Check workflow is active
      const workflow = await db.query.workflows.findFirst({
        where: eq(workflows.id, trigger.workflowId),
      });
      if (!workflow?.isActive) continue;

      // Enqueue workflow execution
      await enqueueWorkflowExecution(trigger.workflowId, trigger.id, {
        type: 'exact_datetime',
        datetime: datetimeStr,
        reason: config.reason as string | undefined,
        firedAt: now.toISOString(),
      });

      // Deactivate trigger (one-shot) and update last fired
      await db.update(triggers).set({ isActive: false, lastFiredAt: now }).where(eq(triggers.id, trigger.id));

      logger.info(
        { triggerId: trigger.id, workflowId: trigger.workflowId, datetime: datetimeStr },
        'Exact datetime trigger fired',
      );
    }
  } catch (error) {
    logger.error({ error }, 'Error polling exact datetime triggers');
  }
}

/**
 * Poll for new system events and match against event triggers.
 * This handles both system events (agent.created, execution.completed, etc.)
 * and webhook events (webhook.received) through a unified pipeline.
 * Uses a Redis cursor to track which events have been processed.
 */
async function pollEventTriggers() {
  try {
    const redis = getRedisConnection();

    // Get cursor (last processed event timestamp + IDs at that timestamp)
    const cursorStr = await redis.get(LAST_EVENT_CURSOR_KEY);
    let cursor: Date;
    let processedIds: Set<string> = new Set();
    if (cursorStr) {
      try {
        const parsed = JSON.parse(cursorStr);
        cursor = new Date(parsed.timestamp);
        processedIds = new Set(parsed.processedIds ?? []);
      } catch {
        cursor = new Date(cursorStr); // legacy string format fallback
      }
    } else {
      cursor = new Date(Date.now() - POLL_INTERVAL);
    }

    // Fetch events using gte() to avoid skipping events with the same timestamp
    const rawEvents = await db.query.systemEvents.findMany({
      where: gte(systemEvents.createdAt, cursor),
      orderBy: systemEvents.createdAt,
      limit: 100,
    });

    // Filter out events already processed in the previous batch (same-timestamp dedup)
    const newEvents = rawEvents.filter((e) => !processedIds.has(e.id));

    if (newEvents.length === 0) return;

    // Process webhook.received events directly (they carry their own trigger/workflow info)
    for (const event of newEvents) {
      if (event.eventName === 'webhook.received') {
        await processWebhookEvent(event);
      }
    }

    // Get all active event triggers (for non-webhook system events)
    const eventTriggers = await db.query.triggers.findMany({
      where: and(eq(triggers.triggerType, 'event'), eq(triggers.isActive, true)),
    });

    if (eventTriggers.length === 0) {
      // Still update cursor even if no triggers
      const lastEvt = newEvents[newEvents.length - 1];
      const lastTs = lastEvt.createdAt.toISOString();
      const idsAtTs = newEvents.filter((e) => e.createdAt.toISOString() === lastTs).map((e) => e.id);
      await redis.set(LAST_EVENT_CURSOR_KEY, JSON.stringify({ timestamp: lastTs, processedIds: idsAtTs }));
      return;
    }

    // Match non-webhook events against event triggers
    for (const event of newEvents) {
      // Skip webhook.received — already handled above
      if (event.eventName === 'webhook.received') continue;

      for (const trigger of eventTriggers) {
        const config = trigger.configuration as Record<string, unknown>;
        const conditions = config.conditions as Record<string, unknown> | undefined;

        // Match: eventName must match
        if (config.eventName && config.eventName !== event.eventName) continue;

        // Match: eventScope (optional filter)
        if (config.eventScope && config.eventScope !== event.eventScope) continue;

        // Match: additional conditions against eventData
        if (conditions && typeof conditions === 'object') {
          const eventData = event.eventData as Record<string, unknown>;
          let match = true;
          for (const [key, value] of Object.entries(conditions)) {
            if (eventData[key] !== value) {
              match = false;
              break;
            }
          }
          if (!match) continue;
        }

        // Check workflow is active
        const workflow = await db.query.workflows.findFirst({
          where: eq(workflows.id, trigger.workflowId),
        });
        if (!workflow?.isActive) continue;

        // Check scope compatibility: workspace event should match workflow workspace
        if (event.eventScope === 'workspace') {
          if (workflow.workspaceId !== event.scopeId) continue;
        }

        // Enqueue workflow execution
        await enqueueWorkflowExecution(trigger.workflowId, trigger.id, {
          type: 'event',
          eventId: event.id,
          eventName: event.eventName,
          eventScope: event.eventScope,
          eventData: event.eventData,
          firedAt: new Date().toISOString(),
        });

        // Update last fired time
        await db.update(triggers).set({ lastFiredAt: new Date() }).where(eq(triggers.id, trigger.id));

        logger.info(
          { triggerId: trigger.id, workflowId: trigger.workflowId, eventName: event.eventName },
          'Event trigger fired',
        );
      }
    }

    // Update cursor: store timestamp of last event + IDs at that timestamp for dedup
    const lastEvent = newEvents[newEvents.length - 1];
    const lastTimestamp = lastEvent.createdAt.toISOString();
    const idsAtLastTimestamp = newEvents
      .filter((e) => e.createdAt.toISOString() === lastTimestamp)
      .map((e) => e.id);
    await redis.set(
      LAST_EVENT_CURSOR_KEY,
      JSON.stringify({ timestamp: lastTimestamp, processedIds: idsAtLastTimestamp }),
    );
  } catch (error) {
    logger.error({ error }, 'Error polling event triggers');
  }
}

/**
 * Process a webhook.received system event by extracting the trigger/workflow
 * info from eventData and enqueuing the workflow execution.
 */
async function processWebhookEvent(event: { id: string; eventData: unknown }) {
  try {
    const data = event.eventData as Record<string, unknown>;
    const triggerId = data.triggerId as string | undefined;
    const workflowId = data.workflowId as string | undefined;

    if (!triggerId || !workflowId) {
      logger.warn({ eventId: event.id }, 'Webhook event missing triggerId or workflowId');
      return;
    }

    // Verify trigger is still active
    const trigger = await db.query.triggers.findFirst({
      where: and(eq(triggers.id, triggerId), eq(triggers.isActive, true)),
    });
    if (!trigger) return;

    // Verify workflow is active
    const workflow = await db.query.workflows.findFirst({
      where: eq(workflows.id, workflowId),
    });
    if (!workflow?.isActive) return;

    // Enqueue workflow execution
    await enqueueWorkflowExecution(workflowId, triggerId, {
      type: typeof data.triggerType === 'string' ? data.triggerType : 'webhook',
      source: data.source,
      authMethod: data.authMethod,
      eventId: data.eventId,
      payload: data.payload,
      inputs: data.inputs ?? data.payload ?? {},
      receivedAt: data.receivedAt,
    });

    // Update trigger last fired time
    await db.update(triggers).set({ lastFiredAt: new Date() }).where(eq(triggers.id, triggerId));

    logger.info(
      { triggerId, workflowId, eventId: event.id },
      'Webhook event processed, workflow enqueued',
    );
  } catch (error) {
    logger.error({ error, eventId: event.id }, 'Error processing webhook event');
  }
}

async function maintainAgentInstances() {
  try {
    const offlineCount = await markStaleInstancesOffline();
    const now = Date.now();
    let removedCount = 0;

    if (now - lastAgentInstanceCleanupAt >= AGENT_INSTANCE_MAINTENANCE_INTERVAL_MS) {
      removedCount = await cleanupStaleStaticInstances(STALE_STATIC_INSTANCE_CLEANUP_MS);
      lastAgentInstanceCleanupAt = now;
    }

    if (offlineCount > 0 || removedCount > 0) {
      logger.info({ offlineCount, removedCount }, 'Agent instance maintenance completed');
    }
  } catch (error) {
    logger.error({ error }, 'Error maintaining agent instances');
  }
}

async function run() {
  logger.info('Controller starting...');

  // Start the BullMQ worker in the same process
  startWorker();
  logger.info('Workflow worker started in controller process');

  // Main loop
  const tick = async () => {
    const isLeader = (await acquireLeaderLock()) || (await renewLeaderLock());
    if (!isLeader) {
      logger.debug('Not leader, skipping poll');
      return;
    }

    await Promise.all([
      pollTriggers(),
      pollExactDatetimeTriggers(),
      pollEventTriggers(),
      pollJiraPollingTriggers(),
      maintainJiraChangesNotificationTriggers(),
      maintainAgentInstances(),
    ]);
  };

  // Initial tick
  await tick();

  // Poll on interval
  setInterval(tick, POLL_INTERVAL);

  logger.info(`Controller running, polling every ${POLL_INTERVAL / 1000}s`);
}

run().catch((err) => {
  logger.error(err, 'Controller failed to start');
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down controller...');
  await stopWorker();
  process.exit(0);
});
