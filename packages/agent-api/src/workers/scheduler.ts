import { eq, and, gt } from 'drizzle-orm';
import { createLogger } from '@ai-trader/shared';
import { db } from '../database/index.js';
import { triggers, workflows, systemEvents } from '../database/schema.js';
import { enqueueWorkflowExecution } from '../services/workflow-engine.js';
import { getRedisConnection } from '../services/redis.js';

const logger = createLogger('scheduler');
const POLL_INTERVAL = 30_000; // 30 seconds
const LEADER_LOCK_KEY = 'scheduler:leader';
const LEADER_LOCK_TTL = 60; // seconds
const LAST_EVENT_CURSOR_KEY = 'scheduler:last-event-cursor';

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

async function acquireLeaderLock(): Promise<boolean> {
  const redis = getRedisConnection();
  const result = await redis.set(LEADER_LOCK_KEY, 'scheduler', 'EX', LEADER_LOCK_TTL, 'NX');
  return result === 'OK';
}

async function renewLeaderLock(): Promise<boolean> {
  const redis = getRedisConnection();
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
 * Poll for new system events and match against event triggers.
 * Uses a Redis cursor to track which events have been processed.
 */
async function pollEventTriggers() {
  try {
    const redis = getRedisConnection();

    // Get cursor (last processed event timestamp)
    const cursorStr = await redis.get(LAST_EVENT_CURSOR_KEY);
    const cursor = cursorStr ? new Date(cursorStr) : new Date(Date.now() - POLL_INTERVAL);

    // Fetch new events since last cursor
    const newEvents = await db.query.systemEvents.findMany({
      where: gt(systemEvents.createdAt, cursor),
      orderBy: systemEvents.createdAt,
      limit: 100,
    });

    if (newEvents.length === 0) return;

    // Get all active event triggers
    const eventTriggers = await db.query.triggers.findMany({
      where: and(eq(triggers.triggerType, 'event'), eq(triggers.isActive, true)),
    });

    if (eventTriggers.length === 0) {
      // Still update cursor even if no triggers
      await redis.set(LAST_EVENT_CURSOR_KEY, newEvents[newEvents.length - 1].createdAt.toISOString());
      return;
    }

    for (const event of newEvents) {
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

    // Update cursor to latest processed event
    await redis.set(LAST_EVENT_CURSOR_KEY, newEvents[newEvents.length - 1].createdAt.toISOString());
  } catch (error) {
    logger.error({ error }, 'Error polling event triggers');
  }
}

async function run() {
  logger.info('Scheduler starting...');

  // Main loop
  const tick = async () => {
    const isLeader = (await acquireLeaderLock()) || (await renewLeaderLock());
    if (!isLeader) {
      logger.debug('Not leader, skipping poll');
      return;
    }

    await Promise.all([
      pollTriggers(),
      pollEventTriggers(),
    ]);
  };

  // Initial tick
  await tick();

  // Poll on interval
  setInterval(tick, POLL_INTERVAL);

  logger.info(`Scheduler running, polling every ${POLL_INTERVAL / 1000}s`);
}

run().catch((err) => {
  logger.error(err, 'Scheduler failed to start');
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down scheduler...');
  process.exit(0);
});
