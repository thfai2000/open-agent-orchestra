import { Hono } from 'hono';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import type { Context, Next } from 'hono';
import { db } from '../database/index.js';
import { workspaces, users } from '../database/schema.js';
import { authMiddleware, uuidSchema } from '@oao/shared';

const workspacesRouter = new Hono();
workspacesRouter.use('/*', authMiddleware);

// ── Middleware: require super_admin ──────────────────────────────────

async function requireSuperAdmin(c: Context, next: Next): Promise<Response | void> {
  const user = c.get('user');
  if (user.role !== 'super_admin') {
    return c.json({ error: 'Super admin access required' }, 403);
  }
  await next();
}

// GET / — list all workspaces (super_admin only)
workspacesRouter.get('/', requireSuperAdmin, async (c) => {
  const allWorkspaces = await db.query.workspaces.findMany({
    orderBy: desc(workspaces.createdAt),
  });

  // Count members per workspace
  const enriched = await Promise.all(
    allWorkspaces.map(async (ws) => {
      const members = await db.query.users.findMany({
        where: eq(users.workspaceId, ws.id),
        columns: { id: true },
      });
      return { ...ws, memberCount: members.length };
    }),
  );

  return c.json({ workspaces: enriched });
});

// POST / — create workspace (super_admin only)
const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'Slug must be lowercase alphanumeric with hyphens'),
  description: z.string().max(500).optional(),
  allowRegistration: z.boolean().optional().default(true),
  allowPasswordReset: z.boolean().optional().default(true),
});

workspacesRouter.post('/', requireSuperAdmin, async (c) => {
  const body = createWorkspaceSchema.parse(await c.req.json());

  const existing = await db.query.workspaces.findFirst({
    where: eq(workspaces.slug, body.slug),
  });
  if (existing) {
    return c.json({ error: 'Workspace slug already in use' }, 409);
  }

  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: body.name,
      slug: body.slug,
      description: body.description,
      allowRegistration: body.allowRegistration,
      allowPasswordReset: body.allowPasswordReset,
    })
    .returning();

  return c.json({ workspace }, 201);
});

// GET /:id — workspace detail (super_admin only)
workspacesRouter.get('/:id', requireSuperAdmin, async (c) => {
  const id = uuidSchema.parse(c.req.param('id'));
  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, id),
  });
  if (!workspace) return c.json({ error: 'Workspace not found' }, 404);

  const members = await db.query.users.findMany({
    where: eq(users.workspaceId, workspace.id),
    columns: { passwordHash: false },
  });

  return c.json({ workspace, members });
});

// PUT /:id — update workspace (super_admin only)
const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  allowRegistration: z.boolean().optional(),
  allowPasswordReset: z.boolean().optional(),
});

workspacesRouter.put('/:id', requireSuperAdmin, async (c) => {
  const id = uuidSchema.parse(c.req.param('id'));
  const body = updateWorkspaceSchema.parse(await c.req.json());

  const existing = await db.query.workspaces.findFirst({ where: eq(workspaces.id, id) });
  if (!existing) return c.json({ error: 'Workspace not found' }, 404);

  const [updated] = await db
    .update(workspaces)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(workspaces.id, id))
    .returning();

  return c.json({ workspace: updated });
});

// DELETE /:id — delete workspace (super_admin only, cannot delete default)
workspacesRouter.delete('/:id', requireSuperAdmin, async (c) => {
  const id = uuidSchema.parse(c.req.param('id'));

  const existing = await db.query.workspaces.findFirst({ where: eq(workspaces.id, id) });
  if (!existing) return c.json({ error: 'Workspace not found' }, 404);

  if (existing.isDefault) {
    return c.json({ error: 'Cannot delete the default workspace' }, 403);
  }

  // Check for remaining members
  const members = await db.query.users.findMany({
    where: eq(users.workspaceId, id),
    columns: { id: true },
  });
  if (members.length > 0) {
    return c.json({ error: 'Cannot delete workspace with active members. Reassign users first.' }, 409);
  }

  await db.delete(workspaces).where(eq(workspaces.id, id));
  return c.json({ success: true });
});

// PUT /:id/members/:userId — move user to workspace (super_admin only)
const updateMemberRoleSchema = z.object({
  role: z.enum(['workspace_admin', 'creator_user', 'view_user']),
});

workspacesRouter.put('/:id/members/:userId', requireSuperAdmin, async (c) => {
  const workspaceId = uuidSchema.parse(c.req.param('id'));
  const userId = uuidSchema.parse(c.req.param('userId'));
  const body = updateMemberRoleSchema.parse(await c.req.json());

  const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
  if (!workspace) return c.json({ error: 'Workspace not found' }, 404);

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return c.json({ error: 'User not found' }, 404);
  if (user.role === 'super_admin') return c.json({ error: 'Cannot change super_admin workspace membership' }, 403);

  const [updated] = await db
    .update(users)
    .set({ workspaceId, role: body.role, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ id: users.id, email: users.email, name: users.name, role: users.role, workspaceId: users.workspaceId });

  return c.json({ user: updated });
});

export default workspacesRouter;
