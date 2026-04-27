/**
 * LDAP → user-group membership synchronization for RBAC v2.
 *
 * After a successful LDAP login, we walk every `userGroups` row in the user's
 * workspace whose `adGroupDns` overlaps the user's `memberOf` and ensure the
 * user is a member. Groups whose DNs no longer match are removed (only for
 * ad-mapped groups, never for groups with no `adGroupDns` configured — those
 * are managed manually by admins).
 */
import { eq, and, ne } from 'drizzle-orm';
import { db } from '../database/index.js';
import { userGroups, userGroupMembers } from '../database/schema.js';
import { invalidateRbacCache } from './rbac.js';
import { createLogger } from '@oao/shared';

const logger = createLogger('ldap-group-sync');

function normalize(dn: string): string {
  return dn.toLowerCase().replace(/\s+/g, ' ').trim();
}

export async function syncLdapGroupMemberships(args: {
  userId: string;
  workspaceId: string;
  memberOfDns: string[];
}): Promise<{ added: number; removed: number }> {
  const { userId, workspaceId, memberOfDns } = args;
  const userDns = new Set(memberOfDns.map(normalize));

  // All workspace groups that are AD-mapped (have at least one DN configured).
  const groups = await db.query.userGroups.findMany({
    where: eq(userGroups.workspaceId, workspaceId),
  });
  const mappedGroups = groups.filter((g) => Array.isArray(g.adGroupDns) && g.adGroupDns.length > 0);
  if (!mappedGroups.length) return { added: 0, removed: 0 };

  // Existing memberships for this user in those groups
  const existing = await db.query.userGroupMembers.findMany({
    where: eq(userGroupMembers.userId, userId),
  });
  const existingByGroup = new Map(existing.map((m) => [m.groupId, m]));

  let added = 0;
  let removed = 0;

  for (const g of mappedGroups) {
    const groupDns = (g.adGroupDns as string[]).map(normalize);
    const matches = groupDns.some((dn) => userDns.has(dn));
    const isMember = existingByGroup.has(g.id);
    if (matches && !isMember) {
      await db.insert(userGroupMembers).values({ groupId: g.id, userId }).onConflictDoNothing();
      added++;
    } else if (!matches && isMember) {
      await db.delete(userGroupMembers).where(
        and(eq(userGroupMembers.groupId, g.id), eq(userGroupMembers.userId, userId)),
      );
      removed++;
    }
  }

  if (added > 0 || removed > 0) {
    invalidateRbacCache(userId);
    logger.info({ userId, added, removed }, 'LDAP group memberships synced');
  }
  // suppress unused warning when no audit needed
  void ne;

  return { added, removed };
}
