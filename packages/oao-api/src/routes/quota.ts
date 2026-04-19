import { Hono } from 'hono';
import { z } from 'zod';
import { eq, sql, gte, and } from 'drizzle-orm';
import { db } from '../database/index.js';
import {
  creditUsage,
  userQuotaSettings,
  workspaceQuotaSettings,
  models,
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
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = toDateOnly(startDate);

  // Daily totals
  const dailyUsage = await db
    .select({
      date: creditUsage.date,
      totalCredits: sql<string>`sum(${creditUsage.creditsConsumed})`,
      totalSessions: sql<number>`sum(${creditUsage.sessionCount})::int`,
    })
    .from(creditUsage)
    .where(and(eq(creditUsage.userId, user.userId), gte(creditUsage.date, startDateStr)))
    .groupBy(creditUsage.date)
    .orderBy(creditUsage.date);

  // Per-model breakdown
  const modelUsage = await db
    .select({
      modelName: creditUsage.modelName,
      totalCredits: sql<string>`sum(${creditUsage.creditsConsumed})`,
      totalSessions: sql<number>`sum(${creditUsage.sessionCount})::int`,
    })
    .from(creditUsage)
    .where(and(eq(creditUsage.userId, user.userId), gte(creditUsage.date, startDateStr)))
    .groupBy(creditUsage.modelName);

  // Today's usage
  const todayDate = new Date();
  const today = toDateOnly(todayDate);
  const todayUsageResult = await db
    .select({
      totalCredits: sql<string>`coalesce(sum(${creditUsage.creditsConsumed}), '0')`,
      totalSessions: sql<number>`coalesce(sum(${creditUsage.sessionCount}), 0)::int`,
    })
    .from(creditUsage)
    .where(and(eq(creditUsage.userId, user.userId), eq(creditUsage.date, today)));

  // This week's usage
  const weekStartStr = toDateOnly(getWeekStart(todayDate));
  const weekUsageResult = await db
    .select({
      totalCredits: sql<string>`coalesce(sum(${creditUsage.creditsConsumed}), '0')`,
      totalSessions: sql<number>`coalesce(sum(${creditUsage.sessionCount}), 0)::int`,
    })
    .from(creditUsage)
    .where(and(eq(creditUsage.userId, user.userId), gte(creditUsage.date, weekStartStr)));

  // This month's usage
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStartStr = toDateOnly(monthStart);
  const monthUsageResult = await db
    .select({
      totalCredits: sql<string>`coalesce(sum(${creditUsage.creditsConsumed}), '0')`,
      totalSessions: sql<number>`coalesce(sum(${creditUsage.sessionCount}), 0)::int`,
    })
    .from(creditUsage)
    .where(and(eq(creditUsage.userId, user.userId), gte(creditUsage.date, monthStartStr)));

  return c.json({
    dailyUsage,
    modelUsage,
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
