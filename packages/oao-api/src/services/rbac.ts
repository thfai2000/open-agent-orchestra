/**
 * RBAC v2.0.0 — Effective functionality resolver
 *
 * Computes the set of functionality keys that a user is authorized to
 * exercise. Resolution path:
 *   user → user_group_members → user_groups → user_group_roles → roles → role_functionalities
 *
 * If the user is bound (directly via `users.role` legacy field) to one of
 * the system roles, the resolver also includes that role's functionalities
 * to keep backward compatibility during the v2 transition.
 *
 * Results are cached for the lifetime of a single request via the Hono
 * Context (see `requireFunctionality` middleware) and cached for ~30s in
 * an in-memory LRU keyed by userId. The cache is invalidated explicitly
 * by RBAC mutations (see `invalidateRbacCache`).
 */

import { db } from '../database/index.js';
import { users, userGroupMembers, userGroupRoles, roleFunctionalities, roles } from '../database/schema.js';
import { eq, inArray } from 'drizzle-orm';

const SUPER = '*';
const CACHE_TTL_MS = 30_000;

interface CachedSet {
  flags: ReadonlySet<string>;
  expiresAt: number;
}

const cache = new Map<string, CachedSet>();

export function invalidateRbacCache(userId?: string): void {
  if (!userId) {
    cache.clear();
    return;
  }
  cache.delete(userId);
}

/**
 * Returns the set of functionality keys the given user has, including
 * the wildcard `*` for super-admin.
 */
export async function resolveEffectiveFunctionalities(userId: string): Promise<ReadonlySet<string>> {
  const cached = cache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.flags;
  }

  const flags = new Set<string>();

  // Step 1: include the legacy `users.role` mapping (transition path)
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, role: true },
  });
  const legacyRoleName = user?.role ?? null;

  // Step 2: roles inherited via user-group memberships
  const memberships = await db.query.userGroupMembers.findMany({
    where: eq(userGroupMembers.userId, userId),
    columns: { groupId: true },
  });
  const groupIds = memberships.map((m) => m.groupId);

  const groupRoleIds: string[] = [];
  if (groupIds.length) {
    const ugr = await db.query.userGroupRoles.findMany({
      where: inArray(userGroupRoles.groupId, groupIds),
      columns: { roleId: true },
    });
    for (const r of ugr) groupRoleIds.push(r.roleId);
  }

  // Step 3: roles matched by legacy role name (only system, workspace-null roles)
  if (legacyRoleName) {
    // Map old enum values to new role names
    const legacyMap: Record<string, string> = {
      super_admin: 'super_admin',
      workspace_admin: 'workspace_admin',
      creator_user: 'creator',
      view_user: 'viewer',
    };
    const mapped = legacyMap[legacyRoleName] ?? legacyRoleName;
    const sysRoles = await db.query.roles.findMany({
      where: eq(roles.name, mapped),
      columns: { id: true, workspaceId: true, isSystem: true },
    });
    for (const r of sysRoles) {
      if (r.isSystem && r.workspaceId === null) groupRoleIds.push(r.id);
    }
  }

  if (groupRoleIds.length) {
    const uniqueRoleIds = Array.from(new Set(groupRoleIds));
    const rfs = await db.query.roleFunctionalities.findMany({
      where: inArray(roleFunctionalities.roleId, uniqueRoleIds),
      columns: { functionalityKey: true },
    });
    for (const rf of rfs) flags.add(rf.functionalityKey);
  }

  const result: ReadonlySet<string> = flags;
  cache.set(userId, { flags: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

/** True if the user has the given functionality key (or the wildcard). */
export async function userHasFunctionality(userId: string, key: string): Promise<boolean> {
  const flags = await resolveEffectiveFunctionalities(userId);
  return flags.has(SUPER) || flags.has(key);
}

/**
 * Synchronously test a pre-resolved flag set (used inside route handlers
 * after the middleware has already populated the request context).
 */
export function setHasFunctionality(set: ReadonlySet<string>, key: string): boolean {
  return set.has(SUPER) || set.has(key);
}
