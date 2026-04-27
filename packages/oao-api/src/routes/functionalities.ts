/**
 * Routes: /api/functionalities — read-only catalog of available permission flags.
 *
 * Functionalities are platform-defined; admins assemble them into roles
 * but cannot mint new flag keys.
 */
import { Hono } from 'hono';
import { authMiddleware } from '@oao/shared';
import { db } from '../database/index.js';

const functionalitiesRouter = new Hono();
functionalitiesRouter.use('/*', authMiddleware);

functionalitiesRouter.get('/', async (c) => {
  const rows = await db.query.functionalities.findMany({
    orderBy: (f, { asc }) => [asc(f.category), asc(f.resource), asc(f.action)],
  });
  return c.json({ functionalities: rows });
});

export default functionalitiesRouter;
