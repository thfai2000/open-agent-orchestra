import { Hono } from 'hono';
import { authMiddleware } from '@oao/shared';
import { listWorkspaceActiveModels } from '../services/workspace-models.js';

const modelsRouter = new Hono();
modelsRouter.use('/*', authMiddleware);

modelsRouter.get('/', async (c) => {
  const user = c.get('user');
  if (!user.workspaceId) {
    return c.json({ models: [] });
  }

  const activeModels = await listWorkspaceActiveModels(user.workspaceId);
  return c.json({ models: activeModels });
});

export default modelsRouter;