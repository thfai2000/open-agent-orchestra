import { Hono } from 'hono';
import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../database/index.js';
import { systemEvents } from '../database/schema.js';
import { authMiddleware } from '@ai-trader/shared';
import { EVENT_NAMES } from '../services/system-events.js';

const eventsRouter = new Hono();
eventsRouter.use('/*', authMiddleware);

// GET / — list system events (scoped to workspace)
eventsRouter.get('/', async (c) => {
  const user = c.get('user');
  if (!user.workspaceId) return c.json({ events: [] });

  const page = Math.max(1, Number(c.req.query('page') || 1));
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 50)));
  const offset = (page - 1) * limit;
  const eventName = c.req.query('eventName');
  const eventScope = c.req.query('eventScope') as 'workspace' | 'user' | undefined;

  const conditions = [
    // Show workspace-scoped events for this workspace
    // AND user-scoped events where scopeId is the current user
    sql`(
      (${systemEvents.eventScope} = 'workspace' AND ${systemEvents.scopeId} = ${user.workspaceId})
      OR
      (${systemEvents.eventScope} = 'user' AND ${systemEvents.scopeId} = ${user.userId})
    )`,
  ];

  if (eventName) {
    conditions.push(eq(systemEvents.eventName, eventName));
  }
  if (eventScope) {
    conditions.push(eq(systemEvents.eventScope, eventScope));
  }

  const events = await db.query.systemEvents.findMany({
    where: and(...conditions),
    orderBy: desc(systemEvents.createdAt),
    limit,
    offset,
  });

  return c.json({ events, page, limit });
});

// GET /names — list all predefined event names
eventsRouter.get('/names', async (c) => {
  return c.json({ eventNames: Object.values(EVENT_NAMES) });
});

export default eventsRouter;
