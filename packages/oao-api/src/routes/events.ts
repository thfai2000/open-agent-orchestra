import { Hono } from 'hono';
import { eq, and, desc, sql, gte, lte, inArray } from 'drizzle-orm';
import { db } from '../database/index.js';
import { systemEvents } from '../database/schema.js';
import { authMiddleware } from '@oao/shared';
import { EVENT_NAMES } from '../services/system-events.js';

const eventsRouter = new Hono();
eventsRouter.use('/*', authMiddleware);

// GET / — list system events (scoped to workspace)
eventsRouter.get('/', async (c) => {
  const user = c.get('user');
  if (!user.workspaceId) return c.json({ events: [], total: 0 });

  const page = Math.max(1, Number(c.req.query('page') || 1));
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 50)));
  const offset = (page - 1) * limit;
  // Filters accept either a single value or a comma-separated list to support
  // multi-select UI controls.
  const splitCsv = (raw: string | undefined): string[] => (raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : []);
  const eventNames = splitCsv(c.req.query('eventName'));
  const allowedScopes = ['workspace', 'user'] as const;
  const eventScopes = splitCsv(c.req.query('eventScope')).filter((s): s is 'workspace' | 'user' => (allowedScopes as readonly string[]).includes(s));
  const from = c.req.query('from'); // ISO date string
  const to = c.req.query('to');     // ISO date string

  const conditions = [
    sql`(
      (${systemEvents.eventScope} = 'workspace' AND ${systemEvents.scopeId} = ${user.workspaceId})
      OR
      (${systemEvents.eventScope} = 'user' AND ${systemEvents.scopeId} = ${user.userId})
    )`,
  ];

  if (eventNames.length === 1) {
    conditions.push(eq(systemEvents.eventName, eventNames[0]!));
  } else if (eventNames.length > 1) {
    conditions.push(inArray(systemEvents.eventName, eventNames));
  }
  if (eventScopes.length === 1) {
    conditions.push(eq(systemEvents.eventScope, eventScopes[0]!));
  } else if (eventScopes.length > 1) {
    conditions.push(inArray(systemEvents.eventScope, eventScopes));
  }
  if (from) {
    conditions.push(gte(systemEvents.createdAt, new Date(from)));
  }
  if (to) {
    conditions.push(lte(systemEvents.createdAt, new Date(to)));
  }

  const whereClause = and(...conditions);

  const [events, countResult] = await Promise.all([
    db.query.systemEvents.findMany({
      where: whereClause,
      orderBy: desc(systemEvents.createdAt),
      limit,
      offset,
    }),
    db.select({ count: sql<number>`count(*)::int` }).from(systemEvents).where(whereClause),
  ]);

  return c.json({ events, total: countResult[0]?.count ?? 0, page, limit });
});

// GET /names — list all predefined event names
eventsRouter.get('/names', async (c) => {
  return c.json({ eventNames: Object.values(EVENT_NAMES) });
});

export default eventsRouter;
