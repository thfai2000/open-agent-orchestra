import { Hono } from 'hono';
import { z } from 'zod';
import { eq, sql, gte, and } from 'drizzle-orm';
import { db } from '../database/index.js';
import {
  creditUsage,
  userQuotaSettings,
  workspaceQuotaSettings,
  models,
  users,
} from '../database/schema.js';
import { authMiddleware } from '@oao/shared';

const quotaRouter = new Hono();
quotaRouter.use('/*', authMiddleware);

const creditLimitSchema = z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional();

function emptyRateLimitSettings() {
  return {
    dailyCreditLimit: null,
    weeklyCreditLimit: null,
    monthlyCreditLimit: null,
  };
}

const usageScopeSchema = z.enum(['user', 'workspace', 'platform']);

function toDateOnly(value: Date): string {
  return value.toISOString().split('T')[0];
}

function getWeekStart(date: Date): Date {
  const weekStart = new Date(date);
  const day = weekStart.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  weekStart.setDate(weekStart.getDate() + diff);
  return weekStart;
}

function getAvailableUsageScopes(user: { role: string; workspaceId?: string | null }) {
  const scopes: Array<'user' | 'workspace' | 'platform'> = ['user'];

  if (user.workspaceId && (user.role === 'workspace_admin' || user.role === 'super_admin')) {
    scopes.push('workspace');
  }

  if (user.role === 'super_admin') {
    scopes.push('platform');
  }

  return scopes;
}

function getScopeDateFilter(
  scope: 'user' | 'workspace' | 'platform',
  user: { userId: string; workspaceId?: string | null },
  startDate: string,
) {
  if (scope === 'user') {
    return and(eq(creditUsage.userId, user.userId), gte(creditUsage.date, startDate));
  }

  if (scope === 'workspace') {
    return and(eq(creditUsage.workspaceId, user.workspaceId!), gte(creditUsage.date, startDate));
  }

  return gte(creditUsage.date, startDate);
}

function fillMissingDays(
  rows: Array<{ date: string; totalCredits: string; totalSessions: number }>,
  days: number,
) {
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const today = new Date();
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));

  return Array.from({ length: days }, (_, index) => {
    const current = new Date(start);
    current.setDate(start.getDate() + index);
    const date = toDateOnly(current);
    return byDate.get(date) ?? {
      date,
      totalCredits: '0',
      totalSessions: 0,
    };
  });
}

// GET /settings — get current user's rate limit settings + workspace defaults
quotaRouter.get('/settings', async (c) => {
  const user = c.get('user');

  const [userSettings, wsSettings] = await Promise.all([
    db.query.userQuotaSettings.findFirst({
      where: eq(userQuotaSettings.userId, user.userId),
    }),
    user.workspaceId
      ? db.query.workspaceQuotaSettings.findFirst({
          where: eq(workspaceQuotaSettings.workspaceId, user.workspaceId),
        })
      : null,
  ]);

  return c.json({
    userSettings: userSettings ?? emptyRateLimitSettings(),
    workspaceSettings: wsSettings ?? emptyRateLimitSettings(),
  });
});

// PUT /settings — update own rate limit settings
const updateSettingsSchema = z.object({
  dailyCreditLimit: creditLimitSchema,
  weeklyCreditLimit: creditLimitSchema,
  monthlyCreditLimit: creditLimitSchema,
});

quotaRouter.put('/settings', async (c) => {
  const user = c.get('user');
  const body = updateSettingsSchema.parse(await c.req.json());

  const existing = await db.query.userQuotaSettings.findFirst({
    where: eq(userQuotaSettings.userId, user.userId),
  });

  if (existing) {
    const [updated] = await db
      .update(userQuotaSettings)
      .set({
        dailyCreditLimit: body.dailyCreditLimit !== undefined ? body.dailyCreditLimit : existing.dailyCreditLimit,
        weeklyCreditLimit: body.weeklyCreditLimit !== undefined ? body.weeklyCreditLimit : existing.weeklyCreditLimit,
        monthlyCreditLimit: body.monthlyCreditLimit !== undefined ? body.monthlyCreditLimit : existing.monthlyCreditLimit,
        updatedAt: new Date(),
      })
      .where(eq(userQuotaSettings.id, existing.id))
      .returning();
    return c.json({ settings: updated });
  }

  const [created] = await db
    .insert(userQuotaSettings)
    .values({
      userId: user.userId,
      dailyCreditLimit: body.dailyCreditLimit ?? null,
      weeklyCreditLimit: body.weeklyCreditLimit ?? null,
      monthlyCreditLimit: body.monthlyCreditLimit ?? null,
    })
    .returning();
  return c.json({ settings: created }, 201);
});

// GET /usage — get current user's credit usage
quotaRouter.get('/usage', async (c) => {
  const user = c.get('user');
  const days = z.coerce.number().min(1).max(90).default(30).parse(c.req.query('days'));
  const requestedScope = usageScopeSchema.default('user').parse(c.req.query('scope'));
  const availableScopes = getAvailableUsageScopes(user);

  if (!availableScopes.includes(requestedScope)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const scope = requestedScope;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (days - 1));
  const startDateStr = toDateOnly(startDate);
  const rangeFilter = getScopeDateFilter(scope, user, startDateStr);

  // Daily totals
  const rawDailyUsage = await db
    .select({
      date: creditUsage.date,
      totalCredits: sql<string>`sum(${creditUsage.creditsConsumed})`,
      totalSessions: sql<number>`sum(${creditUsage.sessionCount})::int`,
    })
    .from(creditUsage)
    .where(rangeFilter)
    .groupBy(creditUsage.date)
    .orderBy(creditUsage.date);

  const dailyUsage = fillMissingDays(rawDailyUsage, days);

  // Per-model breakdown
  const modelUsage = await db
    .select({
      modelName: creditUsage.modelName,
      totalCredits: sql<string>`sum(${creditUsage.creditsConsumed})`,
      totalSessions: sql<number>`sum(${creditUsage.sessionCount})::int`,
    })
    .from(creditUsage)
    .where(rangeFilter)
    .groupBy(creditUsage.modelName);

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
    .where(rangeFilter)
    .groupBy(creditUsage.userId, users.name, users.email);

  // Today's usage
  const todayDate = new Date();
  const today = toDateOnly(todayDate);
  const todayFilter = getScopeDateFilter(scope, user, today);
  const todayUsageResult = await db
    .select({
      totalCredits: sql<string>`coalesce(sum(${creditUsage.creditsConsumed}), '0')`,
      totalSessions: sql<number>`coalesce(sum(${creditUsage.sessionCount}), 0)::int`,
    })
    .from(creditUsage)
    .where(todayFilter);

  // This week's usage
  const weekStartStr = toDateOnly(getWeekStart(todayDate));
  const weekFilter = getScopeDateFilter(scope, user, weekStartStr);
  const weekUsageResult = await db
    .select({
      totalCredits: sql<string>`coalesce(sum(${creditUsage.creditsConsumed}), '0')`,
      totalSessions: sql<number>`coalesce(sum(${creditUsage.sessionCount}), 0)::int`,
    })
    .from(creditUsage)
    .where(weekFilter);

  // This month's usage
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStartStr = toDateOnly(monthStart);
  const monthFilter = getScopeDateFilter(scope, user, monthStartStr);
  const monthUsageResult = await db
    .select({
      totalCredits: sql<string>`coalesce(sum(${creditUsage.creditsConsumed}), '0')`,
      totalSessions: sql<number>`coalesce(sum(${creditUsage.sessionCount}), 0)::int`,
    })
    .from(creditUsage)
    .where(monthFilter);

  return c.json({
    scope,
    availableScopes,
    dailyUsage,
    modelUsage,
    userUsage: userUsage.sort((left, right) => Number(right.totalCredits) - Number(left.totalCredits)),
    todayUsage: todayUsageResult[0],
    weekUsage: weekUsageResult[0],
    monthUsage: monthUsageResult[0],
    days,
  });
});

// GET /models — list active models in user's workspace
quotaRouter.get('/models', async (c) => {
  const user = c.get('user');
  if (!user.workspaceId) return c.json({ models: [] });

  const allModels = await db.query.models.findMany({
    where: and(eq(models.workspaceId, user.workspaceId), eq(models.isActive, true)),
    orderBy: models.name,
  });
  return c.json({ models: allModels });
});

export default quotaRouter;
