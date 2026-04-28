/**
 * Workspace settings service — small cached accessor for the per-workspace
 * lifecycle and guardrail tunables added in v3.1.
 *
 * Hot paths (agent-tools.ts, controller maintenance loop) call into this on
 * every request, so we cache by workspaceId for a short TTL. Cache is
 * invalidated whenever the settings route updates the row.
 */
import { eq } from 'drizzle-orm';
import { db } from '../database/index.js';
import { workspaces } from '../database/schema.js';

export interface WorkspaceSettings {
  workspaceId: string;
  allowRegistration: boolean;
  allowPasswordReset: boolean;
  ephemeralKeepAliveMs: number;
  staticCleanupIntervalMs: number;
  disallowCredentialAccessViaTools: boolean;
}

const TTL_MS = 30_000;
const cache = new Map<string, { value: WorkspaceSettings; expiresAt: number }>();

export const DEFAULT_SETTINGS: Omit<WorkspaceSettings, 'workspaceId'> = {
  allowRegistration: true,
  allowPasswordReset: true,
  ephemeralKeepAliveMs: 60 * 60 * 1000,
  staticCleanupIntervalMs: 24 * 60 * 60 * 1000,
  disallowCredentialAccessViaTools: true,
};

export async function getWorkspaceSettings(workspaceId: string | null | undefined): Promise<WorkspaceSettings> {
  if (!workspaceId) {
    return { workspaceId: '', ...DEFAULT_SETTINGS };
  }
  const cached = cache.get(workspaceId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
  const value: WorkspaceSettings = ws
    ? {
        workspaceId,
        allowRegistration: ws.allowRegistration,
        allowPasswordReset: ws.allowPasswordReset,
        ephemeralKeepAliveMs: ws.ephemeralKeepAliveMs ?? DEFAULT_SETTINGS.ephemeralKeepAliveMs,
        staticCleanupIntervalMs: ws.staticCleanupIntervalMs ?? DEFAULT_SETTINGS.staticCleanupIntervalMs,
        disallowCredentialAccessViaTools:
          ws.disallowCredentialAccessViaTools ?? DEFAULT_SETTINGS.disallowCredentialAccessViaTools,
      }
    : { workspaceId, ...DEFAULT_SETTINGS };
  cache.set(workspaceId, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

export function invalidateWorkspaceSettingsCache(workspaceId?: string): void {
  if (workspaceId) cache.delete(workspaceId);
  else cache.clear();
}

const VALIDATION_BOUNDS = {
  ephemeralKeepAliveMs: { min: 60_000, max: 7 * 24 * 60 * 60 * 1000 }, // 1m–7d
  staticCleanupIntervalMs: { min: 60_000, max: 30 * 24 * 60 * 60 * 1000 }, // 1m–30d
} as const;

export function validateLifecycleBounds(input: {
  ephemeralKeepAliveMs?: number;
  staticCleanupIntervalMs?: number;
}): string | null {
  if (typeof input.ephemeralKeepAliveMs === 'number') {
    const { min, max } = VALIDATION_BOUNDS.ephemeralKeepAliveMs;
    if (!Number.isFinite(input.ephemeralKeepAliveMs) || input.ephemeralKeepAliveMs < min || input.ephemeralKeepAliveMs > max) {
      return `ephemeralKeepAliveMs must be between ${min} and ${max} ms`;
    }
  }
  if (typeof input.staticCleanupIntervalMs === 'number') {
    const { min, max } = VALIDATION_BOUNDS.staticCleanupIntervalMs;
    if (!Number.isFinite(input.staticCleanupIntervalMs) || input.staticCleanupIntervalMs < min || input.staticCleanupIntervalMs > max) {
      return `staticCleanupIntervalMs must be between ${min} and ${max} ms`;
    }
  }
  return null;
}

export { VALIDATION_BOUNDS };
