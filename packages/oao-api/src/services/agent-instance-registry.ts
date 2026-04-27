/**
 * Agent Instance Registry — Tracks and manages Static and Ephemeral agent instances.
 *
 * Static instances register themselves on startup, send heartbeats, and are marked
 * offline when heartbeats stop. Ephemeral instances are registered when K8s pods are
 * created and removed when pods are deleted.
 */
import { and, eq, inArray, isNull, lt, or } from 'drizzle-orm';
import { createLogger } from '@oao/shared';
import { db } from '../database/index.js';
import { agentInstances } from '../database/schema.js';
import os from 'node:os';

const logger = createLogger('agent-instance-registry');

const HEARTBEAT_INTERVAL = 15_000; // 15 seconds
const HEARTBEAT_STALE_THRESHOLD = 60_000; // 60 seconds — mark offline if no heartbeat

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let registeredInstanceId: string | null = null;

// ─── Static Instance Lifecycle ────────────────────────────────────────

/**
 * Register a static agent instance. Called on startup by agent-worker processes.
 * Returns the instance ID for later heartbeat/deregistration.
 */
export async function registerStaticInstance(name: string): Promise<string> {
  const [instance] = await db
    .insert(agentInstances)
    .values({
      name,
      instanceType: 'static',
      status: 'idle',
      hostname: os.hostname(),
      lastHeartbeatAt: new Date(),
      metadata: { pid: process.pid, startedAt: new Date().toISOString() },
    })
    .returning();

  registeredInstanceId = instance.id;
  logger.info({ instanceId: instance.id, name }, 'Static agent instance registered');
  return instance.id;
}

/**
 * Start periodic heartbeat for a registered static instance.
 */
export function startHeartbeat(instanceId: string): void {
  if (heartbeatTimer) return;

  heartbeatTimer = setInterval(async () => {
    try {
      await db
        .update(agentInstances)
        .set({ lastHeartbeatAt: new Date(), updatedAt: new Date() })
        .where(eq(agentInstances.id, instanceId));
    } catch (error) {
      logger.error({ instanceId, error }, 'Heartbeat failed');
    }
  }, HEARTBEAT_INTERVAL);

  logger.info({ instanceId, intervalMs: HEARTBEAT_INTERVAL }, 'Heartbeat started');
}

/**
 * Stop heartbeat and deregister the static instance.
 */
export async function deregisterStaticInstance(instanceId: string): Promise<void> {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  try {
    await db
      .update(agentInstances)
      .set({ status: 'offline', updatedAt: new Date() })
      .where(eq(agentInstances.id, instanceId));

    logger.info({ instanceId }, 'Static agent instance deregistered');
  } catch (error) {
    logger.error({ instanceId, error }, 'Failed to deregister instance');
  }

  registeredInstanceId = null;
}

// ─── Instance Status Updates ──────────────────────────────────────────

/**
 * Mark an instance as busy with a specific step execution.
 */
export async function markInstanceBusy(instanceId: string, stepExecutionId: string): Promise<void> {
  await db
    .update(agentInstances)
    .set({
      status: 'busy',
      currentStepExecutionId: stepExecutionId,
      updatedAt: new Date(),
    })
    .where(eq(agentInstances.id, instanceId));
}

/**
 * Mark an instance as idle (available for work).
 */
export async function markInstanceIdle(instanceId: string): Promise<void> {
  await db
    .update(agentInstances)
    .set({
      status: 'idle',
      currentStepExecutionId: null,
      updatedAt: new Date(),
    })
    .where(eq(agentInstances.id, instanceId));
}

// ─── Ephemeral Instance Tracking ──────────────────────────────────────

/**
 * Register an ephemeral instance (K8s pod) when created.
 */
export async function registerEphemeralInstance(
  name: string,
  stepExecutionId: string,
  metadata?: Record<string, unknown>,
): Promise<string> {
  const [instance] = await db
    .insert(agentInstances)
    .values({
      name,
      instanceType: 'ephemeral',
      status: 'busy',
      currentStepExecutionId: stepExecutionId,
      lastHeartbeatAt: new Date(),
      metadata: metadata ?? {},
    })
    .returning();

  logger.info({ instanceId: instance.id, name }, 'Ephemeral agent instance registered');
  return instance.id;
}

/**
 * Mark an ephemeral instance as terminated (pod completed/deleted).
 */
export async function terminateEphemeralInstance(name: string): Promise<void> {
  await db
    .update(agentInstances)
    .set({ status: 'terminated', currentStepExecutionId: null, updatedAt: new Date() })
    .where(eq(agentInstances.name, name));
}

// ─── Query Functions ──────────────────────────────────────────────────

/**
 * List all agent instances, optionally filtered by type.
 */
export async function listInstances(
  filter?: { type?: 'static' | 'ephemeral'; status?: 'idle' | 'busy' | 'offline' | 'terminated' },
): Promise<Array<typeof agentInstances.$inferSelect>> {
  const conditions = [];
  if (filter?.type) conditions.push(eq(agentInstances.instanceType, filter.type));
  if (filter?.status) conditions.push(eq(agentInstances.status, filter.status));

  if (conditions.length === 0) {
    return db.query.agentInstances.findMany({ orderBy: agentInstances.createdAt });
  }

  return db.query.agentInstances.findMany({
    where: conditions.length === 1 ? conditions[0] : and(...conditions),
    orderBy: agentInstances.createdAt,
  });
}

/**
 * Mark stale static instances as offline (missed heartbeats).
 * Should be called periodically by the controller.
 */
export async function markStaleInstancesOffline(): Promise<number> {
  const threshold = new Date(Date.now() - HEARTBEAT_STALE_THRESHOLD);

  const result = await db
    .update(agentInstances)
    .set({ status: 'offline', currentStepExecutionId: null, updatedAt: new Date() })
    .where(
      and(
        eq(agentInstances.instanceType, 'static'),
        inArray(agentInstances.status, ['idle', 'busy']),
        or(
          lt(agentInstances.lastHeartbeatAt, threshold),
          and(isNull(agentInstances.lastHeartbeatAt), lt(agentInstances.updatedAt, threshold)),
        ),
      ),
    )
    .returning();

  if (result.length > 0) {
    logger.info({ count: result.length }, 'Marked stale instances as offline');
  }
  return result.length;
}

/**
 * Remove old, no-longer-relevant instances. Cleans up stale static instances
 * (no heartbeat) AND terminated ephemeral instances (pod completed/deleted),
 * which would otherwise accumulate indefinitely in the database.
 *
 * Returns the total number of rows removed across both categories.
 */
export async function cleanupOldInstances(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
  const staticRemoved = await cleanupStaleStaticInstances(maxAgeMs);
  const ephemeralRemoved = await cleanupTerminatedEphemeralInstances(maxAgeMs);
  return staticRemoved + ephemeralRemoved;
}

/**
 * Delete ephemeral instances that have been in `terminated` status for longer
 * than the configured age. The agent-worker pod is already gone at this point,
 * so the row is purely historical metadata; the controller maintenance loop
 * calls this so terminated ephemeral instances do not accumulate forever.
 */
export async function cleanupTerminatedEphemeralInstances(maxAgeMs = 60 * 60 * 1000): Promise<number> {
  const threshold = new Date(Date.now() - maxAgeMs);

  const result = await db
    .delete(agentInstances)
    .where(
      and(
        eq(agentInstances.instanceType, 'ephemeral'),
        eq(agentInstances.status, 'terminated'),
        lt(agentInstances.updatedAt, threshold),
      ),
    )
    .returning();

  if (result.length > 0) {
    logger.info({ count: result.length }, 'Cleaned up terminated ephemeral agent instances');
  }
  return result.length;
}

/**
 * Remove stale static instances after their heartbeat has been absent long
 * enough that no live worker should be able to recover the record.
 */
export async function cleanupStaleStaticInstances(maxHeartbeatAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
  const threshold = new Date(Date.now() - maxHeartbeatAgeMs);

  const result = await db
    .delete(agentInstances)
    .where(
      and(
        eq(agentInstances.instanceType, 'static'),
        or(
          lt(agentInstances.lastHeartbeatAt, threshold),
          and(isNull(agentInstances.lastHeartbeatAt), lt(agentInstances.updatedAt, threshold)),
        ),
      ),
    )
    .returning();

  if (result.length > 0) {
    logger.info({ count: result.length }, 'Cleaned up stale static agent instances');
  }
  return result.length;
}

/**
 * Get the currently registered instance ID (for this process).
 */
export function getCurrentInstanceId(): string | null {
  return registeredInstanceId;
}
