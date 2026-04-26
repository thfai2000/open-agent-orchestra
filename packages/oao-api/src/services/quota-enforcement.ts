import { and, eq, gte } from 'drizzle-orm';
import { db } from '../database/index.js';
import {
  creditUsage,
  userQuotaSettings,
  workspaceQuotaSettings,
} from '../database/schema.js';
import { getWorkspaceModelRecord, resolveWorkspaceActiveModelName } from './workspace-models.js';

type QuotaPeriod = 'daily' | 'weekly' | 'monthly';
type QuotaScope = 'user' | 'workspace';

export interface QuotaLimitHit {
  scope: QuotaScope;
  period: QuotaPeriod;
  limit: string;
  used: string;
  available: string;
  required: string;
  resetsAt: string;
}

export interface AllowedQuotaCheck {
  allowed: true;
  modelName: string;
  creditCost: string;
}

export interface BlockedQuotaCheck {
  allowed: false;
  modelName: string;
  creditCost: string;
  message: string;
  nextResetAt: string;
  blockingLimits: QuotaLimitHit[];
}

export type QuotaCheckResult = AllowedQuotaCheck | BlockedQuotaCheck;

interface QuotaSettingsLike {
  dailyCreditLimit: string | null;
  weeklyCreditLimit: string | null;
  monthlyCreditLimit: string | null;
}

interface CreditUsageLike {
  userId: string;
  date: string | Date;
  creditsConsumed: string;
}

const CREDIT_EPSILON = 0.000001;

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcWeek(date: Date): Date {
  const dayStart = startOfUtcDay(date);
  const day = dayStart.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  return new Date(dayStart.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000);
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function usageDateOnly(value: string | Date): string {
  return typeof value === 'string' ? value.slice(0, 10) : toDateOnly(value);
}

function parseCredit(value: string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCredit(value: number): string {
  return value.toFixed(2);
}

function nextUtcMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

function sumUsageSince(rows: CreditUsageLike[], startDate: Date, userId?: string): number {
  const start = toDateOnly(startDate);
  return rows.reduce((total, row) => {
    if (userId && row.userId !== userId) return total;
    if (usageDateOnly(row.date) < start) return total;
    return total + (parseCredit(row.creditsConsumed) ?? 0);
  }, 0);
}

function collectBlockingLimits(params: {
  scope: QuotaScope;
  settings: QuotaSettingsLike | null | undefined;
  usageRows: CreditUsageLike[];
  userId?: string;
  creditCost: number;
  now: Date;
}): QuotaLimitHit[] {
  if (!params.settings) return [];

  const dayStart = startOfUtcDay(params.now);
  const weekStart = startOfUtcWeek(params.now);
  const monthStart = startOfUtcMonth(params.now);

  const periods: Array<{
    period: QuotaPeriod;
    limit: string | null;
    start: Date;
    resetsAt: Date;
  }> = [
    {
      period: 'daily',
      limit: params.settings.dailyCreditLimit,
      start: dayStart,
      resetsAt: new Date(dayStart.getTime() + 24 * 60 * 60 * 1000),
    },
    {
      period: 'weekly',
      limit: params.settings.weeklyCreditLimit,
      start: weekStart,
      resetsAt: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000),
    },
    {
      period: 'monthly',
      limit: params.settings.monthlyCreditLimit,
      start: monthStart,
      resetsAt: nextUtcMonthStart(params.now),
    },
  ];

  return periods.flatMap((period) => {
    const limit = parseCredit(period.limit);
    if (limit == null) return [];

    const used = sumUsageSince(params.usageRows, period.start, params.userId);
    const available = Math.max(limit - used, 0);
    if (used + params.creditCost <= limit + CREDIT_EPSILON) return [];

    return [{
      scope: params.scope,
      period: period.period,
      limit: formatCredit(limit),
      used: formatCredit(used),
      available: formatCredit(available),
      required: formatCredit(params.creditCost),
      resetsAt: period.resetsAt.toISOString(),
    }];
  });
}

function buildQuotaMessage(modelName: string, creditCost: number, hits: QuotaLimitHit[]): string {
  const firstHit = hits[0];
  const blockingLabels = hits
    .map((hit) => `${hit.scope} ${hit.period}`)
    .join(', ');

  return `Waiting for LLM credit quota: ${modelName} needs ${formatCredit(creditCost)} credits, but ${blockingLabels} quota is exhausted. The nearest blocking limit has ${firstHit.available} credits remaining.`;
}

export async function checkLlmCreditQuota(params: {
  workspaceId: string | null | undefined;
  userId: string;
  requestedModel?: string | null;
  envDefaultModel?: string | null;
  now?: Date;
}): Promise<QuotaCheckResult> {
  if (!params.workspaceId) {
    return { allowed: true, modelName: params.requestedModel || params.envDefaultModel || 'default', creditCost: '0.00' };
  }

  const modelName = await resolveWorkspaceActiveModelName({
    workspaceId: params.workspaceId,
    requestedModel: params.requestedModel,
    envDefaultModel: params.envDefaultModel,
  });
  const modelRecord = await getWorkspaceModelRecord({ workspaceId: params.workspaceId, requestedModel: modelName });
  const creditCost = Math.max(parseCredit(modelRecord?.creditCost) ?? 1, 0);
  const creditCostText = formatCredit(creditCost);

  if (creditCost <= CREDIT_EPSILON) {
    return { allowed: true, modelName, creditCost: creditCostText };
  }

  const now = params.now ?? new Date();
  const monthStart = startOfUtcMonth(now);

  const [userSettings, workspaceSettings, usageRows] = await Promise.all([
    db.query.userQuotaSettings.findFirst({ where: eq(userQuotaSettings.userId, params.userId) }),
    db.query.workspaceQuotaSettings.findFirst({ where: eq(workspaceQuotaSettings.workspaceId, params.workspaceId) }),
    db.query.creditUsage.findMany({
      where: and(
        eq(creditUsage.workspaceId, params.workspaceId),
        gte(creditUsage.date, toDateOnly(monthStart)),
      ),
    }),
  ]);

  const usage = usageRows as CreditUsageLike[];
  const blockingLimits = [
    ...collectBlockingLimits({
      scope: 'user',
      settings: userSettings,
      usageRows: usage,
      userId: params.userId,
      creditCost,
      now,
    }),
    ...collectBlockingLimits({
      scope: 'workspace',
      settings: workspaceSettings,
      usageRows: usage,
      creditCost,
      now,
    }),
  ];

  if (blockingLimits.length === 0) {
    return { allowed: true, modelName, creditCost: creditCostText };
  }

  const nextResetAt = new Date(Math.max(...blockingLimits.map((hit) => new Date(hit.resetsAt).getTime()))).toISOString();

  return {
    allowed: false,
    modelName,
    creditCost: creditCostText,
    message: buildQuotaMessage(modelName, creditCost, blockingLimits),
    nextResetAt,
    blockingLimits,
  };
}