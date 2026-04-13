import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../database/index.js';
import { agentInstances } from '../database/schema.js';
import { authMiddleware } from '@oao/shared';
import { listInstances, cleanupOldInstances } from '../services/agent-instance-registry.js';

const agentInstancesRouter = new Hono();
agentInstancesRouter.use('/*', authMiddleware);

// GET / — list all agent instances, optionally filtered
agentInstancesRouter.get('/', async (c) => {
  const type = c.req.query('type') as 'static' | 'ephemeral' | undefined;
  const status = c.req.query('status') as 'idle' | 'busy' | 'offline' | 'terminated' | undefined;

  const filter: { type?: 'static' | 'ephemeral'; status?: 'idle' | 'busy' | 'offline' | 'terminated' } = {};
  if (type && ['static', 'ephemeral'].includes(type)) filter.type = type;
  if (status && ['idle', 'busy', 'offline', 'terminated'].includes(status)) filter.status = status;

  const instances = await listInstances(Object.keys(filter).length > 0 ? filter : undefined);
  return c.json({ instances });
});

// GET /:id — get a specific instance
agentInstancesRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const instance = await db.query.agentInstances.findFirst({
    where: eq(agentInstances.id, id),
  });
  if (!instance) return c.json({ error: 'Instance not found' }, 404);
  return c.json({ instance });
});

// DELETE /:id — remove an instance record
agentInstancesRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const instance = await db.query.agentInstances.findFirst({
    where: eq(agentInstances.id, id),
  });
  if (!instance) return c.json({ error: 'Instance not found' }, 404);

  await db.delete(agentInstances).where(eq(agentInstances.id, id));
  return c.json({ message: 'Instance removed' });
});

// POST /cleanup — remove old terminated/offline instances
agentInstancesRouter.post('/cleanup', async (c) => {
  const count = await cleanupOldInstances();
  return c.json({ removed: count });
});

export default agentInstancesRouter;
