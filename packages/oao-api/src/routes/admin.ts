import { Hono } from 'hono';
import { z } from 'zod';
import { eq, desc, sql, gte, and } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import type { Context, Next } from 'hono';
import { db } from '../database/index.js';
import {
  users,
  models,
  workspaceQuotaSettings,
  creditUsage,
} from '../database/schema.js';
import { authMiddleware, uuidSchema, emailSchema, passwordSchema } from '@oao/shared';

const adminRouter = new Hono();
adminRouter.use('/*', authMiddleware);

// ── Admin middleware (workspace_admin or super_admin) ─────────────────

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

adminRouter.use('/*', requireWorkspaceAdmin);

const creditLimitSchema = z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional();

function emptyRateLimitSettings() {
  return {
    dailyCreditLimit: null,
    weeklyCreditLimit: null,
    monthlyCreditLimit: null,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// User Management (within workspace)
// ═══════════════════════════════════════════════════════════════════════

// GET /users — list users in current workspace
adminRouter.get('/users', async (c) => {
  const user = c.get('user');
  const page = Math.max(1, Number(c.req.query('page') || 1));
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 50)));
  const offset = (page - 1) * limit;

  const whereClause = eq(users.workspaceId, user.workspaceId!);

  const [allUsers, countResult] = await Promise.all([
    db.query.users.findMany({
      where: whereClause,
      columns: { passwordHash: false },
      orderBy: desc(users.createdAt),
      limit,
      offset,
    }),
    db.select({ count: sql<number>`count(*)::int` }).from(users).where(whereClause),
  ]);

  return c.json({ users: allUsers, total: countResult[0]?.count ?? 0, page, limit });
});

// POST /users — create user in current workspace
const createUserSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().min(1).max(100),
  role: z.enum(['workspace_admin', 'creator_user', 'view_user']).default('creator_user'),
});

adminRouter.post('/users', async (c) => {
  const currentUser = c.get('user');
  const body = createUserSchema.parse(await c.req.json());

  const existing = await db.query.users.findFirst({ where: eq(users.email, body.email) });
  if (existing) return c.json({ error: 'Email already registered' }, 409);

  const passwordHash = await bcrypt.hash(body.password, 12);
  const [newUser] = await db.insert(users).values({
    email: body.email,
    passwordHash,
    name: body.name,
    role: body.role,
    workspaceId: currentUser.workspaceId,
  }).returning({ id: users.id, email: users.email, name: users.name, role: users.role });

  return c.json({ user: newUser }, 201);
});

// GET /users/:id — get single user
adminRouter.get('/users/:id', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));

  const existing = await db.query.users.findFirst({
    where: eq(users.id, id),
    columns: { passwordHash: false },
  });
  if (!existing) return c.json({ error: 'User not found' }, 404);
  if (existing.workspaceId !== user.workspaceId) return c.json({ error: 'User not in your workspace' }, 403);

  return c.json({ user: existing });
});

// PUT /users/:id/role — update user role within workspace
const updateRoleSchema = z.object({
  role: z.enum(['workspace_admin', 'creator_user', 'view_user']),
});

adminRouter.put('/users/:id/role', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));
  const body = updateRoleSchema.parse(await c.req.json());

  const existing = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!existing) return c.json({ error: 'User not found' }, 404);
  if (existing.workspaceId !== user.workspaceId) return c.json({ error: 'User not in your workspace' }, 403);
  if (existing.role === 'super_admin') return c.json({ error: 'Cannot modify super_admin role' }, 403);

  const [updated] = await db
    .update(users)
    .set({ role: body.role, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning({ id: users.id, email: users.email, name: users.name, role: users.role });

  return c.json({ user: updated });
});

// ═══════════════════════════════════════════════════════════════════════
// Model Management (workspace-scoped)
// ═══════════════════════════════════════════════════════════════════════

// GET /models — list models in current workspace
adminRouter.get('/models', async (c) => {
  const user = c.get('user');
  const allModels = await db.query.models.findMany({
    where: eq(models.workspaceId, user.workspaceId!),
    orderBy: desc(models.createdAt),
  });
  return c.json({ models: allModels });
});

// POST /models — create model
const createModelSchema = z.object({
  name: z.string().min(1).max(100),
  provider: z.string().min(1).max(50).default('github'),
  description: z.string().max(500).optional(),
  creditCost: z.string().regex(/^\d+(\.\d{1,2})?$/).default('1.00'),
  isActive: z.boolean().default(true),
});

adminRouter.post('/models', async (c) => {
  const user = c.get('user');
  const body = createModelSchema.parse(await c.req.json());

  const [model] = await db
    .insert(models)
    .values({
      workspaceId: user.workspaceId!,
      name: body.name,
      provider: body.provider,
      description: body.description,
      creditCost: body.creditCost,
      isActive: body.isActive,
    })
    .returning();

  return c.json({ model }, 201);
});

// PUT /models/:id — update model
const updateModelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  provider: z.string().min(1).max(50).optional(),
  description: z.string().max(500).optional(),
  creditCost: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  isActive: z.boolean().optional(),
});

adminRouter.put('/models/:id', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));
  const body = updateModelSchema.parse(await c.req.json());

  const existing = await db.query.models.findFirst({ where: eq(models.id, id) });
  if (!existing) return c.json({ error: 'Model not found' }, 404);
  if (existing.workspaceId !== user.workspaceId) return c.json({ error: 'Model not in your workspace' }, 403);

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.provider !== undefined) updateData.provider = body.provider;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.creditCost !== undefined) updateData.creditCost = body.creditCost;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;

  const [updated] = await db
    .update(models)
    .set(updateData)
    .where(eq(models.id, id))
    .returning();

  return c.json({ model: updated });
});

// DELETE /models/:id — delete model
adminRouter.delete('/models/:id', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));

  const existing = await db.query.models.findFirst({ where: eq(models.id, id) });
  if (!existing) return c.json({ error: 'Model not found' }, 404);
  if (existing.workspaceId !== user.workspaceId) return c.json({ error: 'Model not in your workspace' }, 403);

  await db.delete(models).where(eq(models.id, id));
  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════
// Workspace Rate Limit Settings
// ═══════════════════════════════════════════════════════════════════════

// GET /quota — get workspace rate limit settings
adminRouter.get('/quota', async (c) => {
  const user = c.get('user');
  const settings = await db.query.workspaceQuotaSettings.findFirst({
    where: eq(workspaceQuotaSettings.workspaceId, user.workspaceId!),
  });
  return c.json({ settings: settings ?? emptyRateLimitSettings() });
});

// PUT /quota — update workspace rate limit settings
const updateQuotaSchema = z.object({
  dailyCreditLimit: creditLimitSchema,
  weeklyCreditLimit: creditLimitSchema,
  monthlyCreditLimit: creditLimitSchema,
});

adminRouter.put('/quota', async (c) => {
  const user = c.get('user');
  const body = updateQuotaSchema.parse(await c.req.json());

  const existing = await db.query.workspaceQuotaSettings.findFirst({
    where: eq(workspaceQuotaSettings.workspaceId, user.workspaceId!),
  });

  if (existing) {
    const [updated] = await db
      .update(workspaceQuotaSettings)
      .set({
        dailyCreditLimit: body.dailyCreditLimit ?? existing.dailyCreditLimit,
        weeklyCreditLimit: body.weeklyCreditLimit ?? existing.weeklyCreditLimit,
        monthlyCreditLimit: body.monthlyCreditLimit ?? existing.monthlyCreditLimit,
        updatedBy: user.userId,
        updatedAt: new Date(),
      })
      .where(eq(workspaceQuotaSettings.id, existing.id))
      .returning();
    return c.json({ settings: updated });
  }

  const [created] = await db
    .insert(workspaceQuotaSettings)
    .values({
      workspaceId: user.workspaceId!,
      dailyCreditLimit: body.dailyCreditLimit ?? null,
      weeklyCreditLimit: body.weeklyCreditLimit ?? null,
      monthlyCreditLimit: body.monthlyCreditLimit ?? null,
      updatedBy: user.userId,
    })
    .returning();
  return c.json({ settings: created }, 201);
});

// ═══════════════════════════════════════════════════════════════════════
// Credit Usage Stats (workspace view — all users in workspace)
// ═══════════════════════════════════════════════════════════════════════

// GET /usage/summary — aggregated credit usage within workspace
adminRouter.get('/usage/summary', async (c) => {
  const user = c.get('user');
  const days = z.coerce.number().min(1).max(90).default(30).parse(c.req.query('days'));
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];

  // Daily totals
  const dailyUsage = await db
    .select({
      date: creditUsage.date,
      totalCredits: sql<string>`sum(${creditUsage.creditsConsumed})`,
      totalSessions: sql<number>`sum(${creditUsage.sessionCount})::int`,
    })
    .from(creditUsage)
    .where(and(eq(creditUsage.workspaceId, user.workspaceId!), gte(creditUsage.date, startDateStr)))
    .groupBy(creditUsage.date)
    .orderBy(creditUsage.date);

  // Per-model totals
  const modelUsage = await db
    .select({
      modelName: creditUsage.modelName,
      totalCredits: sql<string>`sum(${creditUsage.creditsConsumed})`,
      totalSessions: sql<number>`sum(${creditUsage.sessionCount})::int`,
    })
    .from(creditUsage)
    .where(and(eq(creditUsage.workspaceId, user.workspaceId!), gte(creditUsage.date, startDateStr)))
    .groupBy(creditUsage.modelName);

  // Per-user totals
  const userUsage = await db
    .select({
      userId: creditUsage.userId,
      userName: users.name,
      userEmail: users.email,
      totalCredits: sql<string>`sum(${creditUsage.creditsConsumed})`,
      totalSessions: sql<number>`sum(${creditUsage.sessionCount})::int`,
    })
    .from(creditUsage)
    .innerJoin(users, eq(creditUsage.userId, users.id))
    .where(and(eq(creditUsage.workspaceId, user.workspaceId!), gte(creditUsage.date, startDateStr)))
    .groupBy(creditUsage.userId, users.name, users.email);

  return c.json({ dailyUsage, modelUsage, userUsage, days });
});

export default adminRouter;
