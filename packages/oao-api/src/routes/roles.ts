/**
 * Routes: /api/roles — RBAC v2.0.0 role management.
 *
 * Roles are bags of functionality flags. System roles
 * (workspaceId IS NULL, isSystem=true) cannot be deleted or renamed,
 * but their functionality bindings can be edited. Workspace-custom roles
 * may be freely managed by users with the `admin:rbac:manage` flag.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, inArray, isNull, or } from 'drizzle-orm';
import { db } from '../database/index.js';
import { roles, roleFunctionalities, functionalities, userGroupRoles, userGroups } from '../database/schema.js';
import { authMiddleware, uuidSchema } from '@oao/shared';
import { requireFunctionality } from '../middleware/require-functionality.js';
import { invalidateRbacCache } from '../services/rbac.js';

const rolesRouter = new Hono();
rolesRouter.use('/*', authMiddleware);

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).optional().nullable(),
  functionalityKeys: z.array(z.string().trim().min(1).max(120)).optional().default([]),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
});

const bindingsSchema = z.object({
  functionalityKeys: z.array(z.string().trim().min(1).max(120)),
});

// GET / — list roles visible to the user (system roles + workspace's custom roles)
rolesRouter.get('/', requireFunctionality('admin:rbac:read'), async (c) => {
  const user = c.get('user');
  const wsId = user.workspaceId;
  const allRoles = await db.query.roles.findMany({
    where: wsId
      ? or(isNull(roles.workspaceId), eq(roles.workspaceId, wsId))
      : isNull(roles.workspaceId),
    orderBy: (r, { asc }) => [asc(r.name)],
  });

  // Aggregated counts
  const roleIds = allRoles.map((r) => r.id);
  const fnCounts = new Map<string, number>();
  const groupCounts = new Map<string, number>();
  if (roleIds.length) {
    const fnRows = await db.query.roleFunctionalities.findMany({
      where: inArray(roleFunctionalities.roleId, roleIds),
      columns: { roleId: true },
    });
    for (const r of fnRows) fnCounts.set(r.roleId, (fnCounts.get(r.roleId) ?? 0) + 1);
    const gRows = await db.query.userGroupRoles.findMany({
      where: inArray(userGroupRoles.roleId, roleIds),
      columns: { roleId: true },
    });
    for (const r of gRows) groupCounts.set(r.roleId, (groupCounts.get(r.roleId) ?? 0) + 1);
  }

  return c.json({
    roles: allRoles.map((r) => ({
      ...r,
      functionalityCount: fnCounts.get(r.id) ?? 0,
      groupCount: groupCounts.get(r.id) ?? 0,
    })),
  });
});

// GET /:id — full role detail with functionality keys
rolesRouter.get('/:id', requireFunctionality('admin:rbac:read'), async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));
  const role = await db.query.roles.findFirst({ where: eq(roles.id, id) });
  if (!role) return c.json({ error: 'Role not found' }, 404);
  if (role.workspaceId !== null && role.workspaceId !== user.workspaceId) {
    return c.json({ error: 'Role not found' }, 404);
  }
  const fns = await db.query.roleFunctionalities.findMany({
    where: eq(roleFunctionalities.roleId, id),
    columns: { functionalityKey: true },
  });
  const fnKeys = fns.map((f) => f.functionalityKey);
  const fnDetails = fnKeys.length
    ? await db.query.functionalities.findMany({ where: inArray(functionalities.key, fnKeys) })
    : [];
  // Bound user-groups for this role
  const ugr = await db.query.userGroupRoles.findMany({
    where: eq(userGroupRoles.roleId, id),
    columns: { groupId: true },
  });
  const groupIds = ugr.map((g) => g.groupId);
  const groups = groupIds.length
    ? await db.query.userGroups.findMany({ where: inArray(userGroups.id, groupIds) })
    : [];
  return c.json({ role, functionalityKeys: fnKeys, functionalities: fnDetails, groups });
});

// POST / — create a workspace-custom role
rolesRouter.post('/', requireFunctionality('admin:rbac:manage'), async (c) => {
  const user = c.get('user');
  if (!user.workspaceId) return c.json({ error: 'No workspace context' }, 403);
  const body = createSchema.parse(await c.req.json());
  const dup = await db.query.roles.findFirst({
    where: and(eq(roles.workspaceId, user.workspaceId), eq(roles.name, body.name)),
  });
  if (dup) return c.json({ error: 'A role with this name already exists in your workspace' }, 409);
  const [created] = await db.insert(roles).values({
    workspaceId: user.workspaceId,
    name: body.name,
    description: body.description ?? null,
    isSystem: false,
  }).returning();
  if (body.functionalityKeys.length) {
    // Validate keys exist
    const valid = await db.query.functionalities.findMany({
      where: inArray(functionalities.key, body.functionalityKeys),
      columns: { key: true },
    });
    const validSet = new Set(valid.map((v) => v.key));
    const filtered = body.functionalityKeys.filter((k) => validSet.has(k));
    if (filtered.length) {
      await db.insert(roleFunctionalities).values(
        filtered.map((k) => ({ roleId: created.id, functionalityKey: k })),
      ).onConflictDoNothing();
    }
  }
  invalidateRbacCache();
  return c.json({ role: created }, 201);
});

// PUT /:id — rename / re-describe a role (system roles: name locked, only description editable)
rolesRouter.put('/:id', requireFunctionality('admin:rbac:manage'), async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));
  const body = updateSchema.parse(await c.req.json());
  const existing = await db.query.roles.findFirst({ where: eq(roles.id, id) });
  if (!existing) return c.json({ error: 'Role not found' }, 404);
  if (existing.workspaceId !== null && existing.workspaceId !== user.workspaceId) {
    return c.json({ error: 'Role not found' }, 404);
  }
  if (existing.isSystem && body.name && body.name !== existing.name) {
    return c.json({ error: 'System roles cannot be renamed' }, 400);
  }
  if (body.name && body.name !== existing.name && existing.workspaceId) {
    const dup = await db.query.roles.findFirst({
      where: and(eq(roles.workspaceId, existing.workspaceId), eq(roles.name, body.name)),
    });
    if (dup) return c.json({ error: 'A role with this name already exists' }, 409);
  }
  const [updated] = await db.update(roles).set({
    name: body.name ?? existing.name,
    description: body.description === undefined ? existing.description : body.description,
    updatedAt: new Date(),
  }).where(eq(roles.id, id)).returning();
  return c.json({ role: updated });
});

// PUT /:id/functionalities — replace the functionality bindings
rolesRouter.put('/:id/functionalities', requireFunctionality('admin:rbac:manage'), async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));
  const body = bindingsSchema.parse(await c.req.json());
  const existing = await db.query.roles.findFirst({ where: eq(roles.id, id) });
  if (!existing) return c.json({ error: 'Role not found' }, 404);
  if (existing.workspaceId !== null && existing.workspaceId !== user.workspaceId) {
    return c.json({ error: 'Role not found' }, 404);
  }
  // Validate keys
  const valid = await db.query.functionalities.findMany({
    where: inArray(functionalities.key, body.functionalityKeys),
    columns: { key: true },
  });
  const validSet = new Set(valid.map((v) => v.key));
  const filtered = body.functionalityKeys.filter((k) => validSet.has(k));
  await db.delete(roleFunctionalities).where(eq(roleFunctionalities.roleId, id));
  if (filtered.length) {
    await db.insert(roleFunctionalities).values(
      filtered.map((k) => ({ roleId: id, functionalityKey: k })),
    ).onConflictDoNothing();
  }
  invalidateRbacCache();
  return c.json({ ok: true, functionalityKeys: filtered });
});

// DELETE /:id — only workspace-custom roles
rolesRouter.delete('/:id', requireFunctionality('admin:rbac:manage'), async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));
  const existing = await db.query.roles.findFirst({ where: eq(roles.id, id) });
  if (!existing) return c.json({ error: 'Role not found' }, 404);
  if (existing.isSystem) return c.json({ error: 'System roles cannot be deleted' }, 400);
  if (existing.workspaceId !== user.workspaceId) return c.json({ error: 'Role not found' }, 404);
  await db.delete(roles).where(eq(roles.id, id));
  invalidateRbacCache();
  return c.json({ ok: true });
});

// GET /me/effective — current user's resolved functionality keys (lets the UI gate buttons)
rolesRouter.get('/me/effective', async (c) => {
  const user = c.get('user');
  const { resolveEffectiveFunctionalities } = await import('../services/rbac.js');
  const flags = await resolveEffectiveFunctionalities(user.userId);
  return c.json({ functionalityKeys: Array.from(flags) });
});

export default rolesRouter;
