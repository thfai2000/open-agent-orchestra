import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { z } from 'zod';
import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../database/index.js';
import { userGroups, userGroupMembers, userGroupRoles, roles, users } from '../database/schema.js';
import { authMiddleware, uuidSchema } from '@oao/shared';
import { invalidateRbacCache } from '../services/rbac.js';

const userGroupsRouter = new Hono();
userGroupsRouter.use('/*', authMiddleware);

/**
 * Workspace admins (and super-admins) manage user groups. Groups are purely
 * organizational — they don't grant roles by themselves. They power bulk role
 * edits in the RBAC UI and future workspace-scoped sharing features.
 */
async function requireWorkspaceAdmin(c: Context, next: Next): Promise<Response | void> {
  const user = c.get('user');
  if (user.role !== 'workspace_admin' && user.role !== 'super_admin') {
    return c.json({ error: 'Workspace admin access required' }, 403);
  }
  if (!user.workspaceId) {
    return c.json({ error: 'No workspace context' }, 403);
  }
  await next();
}
userGroupsRouter.use('/*', requireWorkspaceAdmin);

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).optional().nullable(),
  adGroupDns: z.array(z.string().trim().min(1).max(500)).optional().default([]),
  roleIds: z.array(uuidSchema).optional().default([]),
});

const updateSchema = createSchema.partial();

const memberBodySchema = z.object({ userId: uuidSchema });
const rolesBodySchema = z.object({ roleIds: z.array(uuidSchema) });

// GET / — list groups in current workspace (with member count)
userGroupsRouter.get('/', async (c) => {
  const user = c.get('user');
  const groups = await db.query.userGroups.findMany({
    where: eq(userGroups.workspaceId, user.workspaceId!),
    orderBy: (g, { asc }) => [asc(g.name)],
  });
  const memberRows = groups.length
    ? await db.query.userGroupMembers.findMany({
        where: inArray(userGroupMembers.groupId, groups.map((g) => g.id)),
        columns: { groupId: true },
      })
    : [];
  const counts = new Map<string, number>();
  for (const m of memberRows) counts.set(m.groupId, (counts.get(m.groupId) ?? 0) + 1);
  const roleRows = groups.length
    ? await db.query.userGroupRoles.findMany({
        where: inArray(userGroupRoles.groupId, groups.map((g) => g.id)),
        columns: { groupId: true, roleId: true },
      })
    : [];
  const roleCounts = new Map<string, number>();
  for (const r of roleRows) roleCounts.set(r.groupId, (roleCounts.get(r.groupId) ?? 0) + 1);
  return c.json({
    groups: groups.map((g) => ({
      ...g,
      memberCount: counts.get(g.id) ?? 0,
      roleCount: roleCounts.get(g.id) ?? 0,
    })),
  });
});

// POST / — create group
userGroupsRouter.post('/', async (c) => {
  const user = c.get('user');
  const body = createSchema.parse(await c.req.json());
  // Reject duplicate names within workspace upfront (uniqueIndex would also catch it).
  const existing = await db.query.userGroups.findFirst({
    where: and(eq(userGroups.workspaceId, user.workspaceId!), eq(userGroups.name, body.name)),
  });
  if (existing) return c.json({ error: 'A group with this name already exists' }, 409);
  const [group] = await db
    .insert(userGroups)
    .values({
      workspaceId: user.workspaceId!,
      name: body.name,
      description: body.description ?? null,
      adGroupDns: body.adGroupDns ?? [],
    })
    .returning();
  if (body.roleIds && body.roleIds.length) {
    await db.insert(userGroupRoles).values(
      body.roleIds.map((roleId) => ({ groupId: group.id, roleId })),
    ).onConflictDoNothing();
  }
  invalidateRbacCache();
  return c.json({ group: { ...group, memberCount: 0, roles: [] } }, 201);
});

// GET /:id — group + member list + bound roles
userGroupsRouter.get('/:id', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));
  const group = await db.query.userGroups.findFirst({ where: eq(userGroups.id, id) });
  if (!group || group.workspaceId !== user.workspaceId) return c.json({ error: 'Group not found' }, 404);

  const members = await db.query.userGroupMembers.findMany({
    where: eq(userGroupMembers.groupId, id),
  });
  const userIds = members.map((m) => m.userId);
  const memberUsers = userIds.length
    ? await db.query.users.findMany({
        where: inArray(users.id, userIds),
        columns: { id: true, email: true, name: true, role: true, authProvider: true },
      })
    : [];
  const addedAtByUser = new Map(members.map((m) => [m.userId, m.addedAt]));

  // Bound roles
  const groupRoleRows = await db.query.userGroupRoles.findMany({ where: eq(userGroupRoles.groupId, id) });
  const boundRoles = groupRoleRows.length
    ? await db.query.roles.findMany({
        where: inArray(roles.id, groupRoleRows.map((r) => r.roleId)),
      })
    : [];

  return c.json({
    group,
    members: memberUsers.map((u) => ({ ...u, addedAt: addedAtByUser.get(u.id) ?? null })),
    roles: boundRoles,
  });
});

// PUT /:id — update name/description
userGroupsRouter.put('/:id', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));
  const body = updateSchema.parse(await c.req.json());
  const existing = await db.query.userGroups.findFirst({ where: eq(userGroups.id, id) });
  if (!existing || existing.workspaceId !== user.workspaceId) return c.json({ error: 'Group not found' }, 404);
  if (body.name && body.name !== existing.name) {
    const dup = await db.query.userGroups.findFirst({
      where: and(eq(userGroups.workspaceId, user.workspaceId!), eq(userGroups.name, body.name)),
    });
    if (dup) return c.json({ error: 'A group with this name already exists' }, 409);
  }
  const [updated] = await db
    .update(userGroups)
    .set({
      name: body.name ?? existing.name,
      description: body.description === undefined ? existing.description : body.description,
      adGroupDns: body.adGroupDns === undefined ? existing.adGroupDns : body.adGroupDns,
      updatedAt: new Date(),
    })
    .where(eq(userGroups.id, id))
    .returning();
  if (body.roleIds !== undefined) {
    await db.delete(userGroupRoles).where(eq(userGroupRoles.groupId, id));
    if (body.roleIds.length) {
      await db.insert(userGroupRoles).values(
        body.roleIds.map((roleId) => ({ groupId: id, roleId })),
      ).onConflictDoNothing();
    }
    invalidateRbacCache();
  }
  return c.json({ group: updated });
});

// DELETE /:id
userGroupsRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));
  const existing = await db.query.userGroups.findFirst({ where: eq(userGroups.id, id) });
  if (!existing || existing.workspaceId !== user.workspaceId) return c.json({ error: 'Group not found' }, 404);
  await db.delete(userGroups).where(eq(userGroups.id, id));
  return c.json({ ok: true });
});

// POST /:id/members — add a user to the group
userGroupsRouter.post('/:id/members', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));
  const body = memberBodySchema.parse(await c.req.json());
  const group = await db.query.userGroups.findFirst({ where: eq(userGroups.id, id) });
  if (!group || group.workspaceId !== user.workspaceId) return c.json({ error: 'Group not found' }, 404);

  // Only allow adding users that belong to the same workspace.
  const target = await db.query.users.findFirst({ where: eq(users.id, body.userId) });
  if (!target || target.workspaceId !== user.workspaceId) {
    return c.json({ error: 'User not found in this workspace' }, 404);
  }
  await db
    .insert(userGroupMembers)
    .values({ groupId: id, userId: body.userId })
    .onConflictDoNothing();
  invalidateRbacCache(body.userId);
  return c.json({ ok: true });
});

// PUT /:id/roles — replace the role bindings for a group
userGroupsRouter.put('/:id/roles', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));
  const body = rolesBodySchema.parse(await c.req.json());
  const group = await db.query.userGroups.findFirst({ where: eq(userGroups.id, id) });
  if (!group || group.workspaceId !== user.workspaceId) return c.json({ error: 'Group not found' }, 404);

  // Validate every roleId is either a system role (workspaceId NULL) or owned by this workspace.
  if (body.roleIds.length) {
    const found = await db.query.roles.findMany({ where: inArray(roles.id, body.roleIds) });
    if (found.length !== body.roleIds.length) return c.json({ error: 'One or more roleIds do not exist' }, 400);
    for (const r of found) {
      if (r.workspaceId !== null && r.workspaceId !== user.workspaceId) {
        return c.json({ error: `Role ${r.id} is not available in this workspace` }, 403);
      }
    }
  }
  await db.delete(userGroupRoles).where(eq(userGroupRoles.groupId, id));
  if (body.roleIds.length) {
    await db.insert(userGroupRoles).values(
      body.roleIds.map((roleId) => ({ groupId: id, roleId })),
    ).onConflictDoNothing();
  }
  invalidateRbacCache();
  return c.json({ ok: true });
});

// DELETE /:id/members/:userId — remove a member
userGroupsRouter.delete('/:id/members/:userId', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));
  const userId = uuidSchema.parse(c.req.param('userId'));
  const group = await db.query.userGroups.findFirst({ where: eq(userGroups.id, id) });
  if (!group || group.workspaceId !== user.workspaceId) return c.json({ error: 'Group not found' }, 404);
  await db
    .delete(userGroupMembers)
    .where(and(eq(userGroupMembers.groupId, id), eq(userGroupMembers.userId, userId)));
  invalidateRbacCache(userId);
  return c.json({ ok: true });
});

export default userGroupsRouter;
