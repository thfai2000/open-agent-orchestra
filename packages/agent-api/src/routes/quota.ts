import { Hono } from 'hono';
import { z } from 'zod';
import { eq, sql, gte, and } from 'drizzle-orm';
import { db } from '../database/index.js';
import {
  creditUsage,
  userQuotaSettings,
  models,
} from '../database/schema.js';
import { authMiddleware } from '@ai-trader/shared';

const quotaRouter = new Hono();
quotaRouter.use('/*', authMiddleware);

// GET /settings — get current user's quota settings + global defaults
quotaRouter.get('/settings', async (c) => {
  const user = c.get('user');

  const [userSettings, globalSettings] = await Promise.all([
    db.query.userQuotaSettings.findFirst({
      where: eq(userQuotaSettings.userId, user.userId),
    }),
    db.query.globalQuotaSettings.findFirst(),
  ]);

  return c.json({
    userSettings: userSettings ?? { dailyCreditLimit: null, monthlyCreditLimit: null },
    globalSettings: globalSettings ?? { dailyCreditLimit: null, monthlyCreditLimit: null },
  });
});

// PUT /settings — update own quota settings
const updateSettingsSchema = z.object({
  dailyCreditLimit: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
  monthlyCreditLimit: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
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
  const startDateStr = startDate.toISOString().split('T')[0];

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
  const today = new Date().toISOString().split('T')[0];
  const todayUsageResult = await db
    .select({
      totalCredits: sql<string>`coalesce(sum(${creditUsage.creditsConsumed}), '0')`,
      totalSessions: sql<number>`coalesce(sum(${creditUsage.sessionCount}), 0)::int`,
    })
    .from(creditUsage)
    .where(and(eq(creditUsage.userId, user.userId), eq(creditUsage.date, today)));

  // This month's usage
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStartStr = monthStart.toISOString().split('T')[0];
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
    monthUsage: monthUsageResult[0],
    days,
  });
});

// GET /models — list active models (for display in UI)
quotaRouter.get('/models', async (c) => {
  const allModels = await db.query.models.findMany({
    where: eq(models.isActive, true),
    orderBy: models.name,
  });
  return c.json({ models: allModels });
});

export default quotaRouter;
