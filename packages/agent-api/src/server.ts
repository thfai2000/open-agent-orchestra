import { serve } from '@hono/node-server';
import {
  createApp,
  createLogger,
  agentEventBus,
  agentApiSpec,
} from '@ai-trader/shared';
import agentsRouter from './routes/agents.js';
import authRouter from './routes/auth.js';
import workflowsRouter from './routes/workflows.js';
import executionsRouter from './routes/executions.js';
import variablesRouter from './routes/variables.js';
import triggersRouter from './routes/triggers.js';
import webhooks from './routes/webhooks.js';
import supervisorRouter from './routes/supervisor.js';
import mcpServersRouter from './routes/mcp-servers.js';
import pluginsRouter from './routes/plugins.js';
import adminRouter from './routes/admin.js';
import quotaRouter from './routes/quota.js';

const logger = createLogger('agent-api');
const port = Number(process.env.AGENT_API_PORT) || 4002;

const app = createApp({
  serviceName: 'agent-api',
  port,
  eventBus: agentEventBus,
  apiSpec: agentApiSpec,
  routes: [
    ['/api/auth', authRouter],
    ['/api/agents', agentsRouter],
    ['/api/workflows', workflowsRouter],
    ['/api/executions', executionsRouter],
    ['/api/variables', variablesRouter],
    ['/api/triggers', triggersRouter],
    ['/api/webhooks', webhooks],
    ['/api/supervisor', supervisorRouter],
    ['/api/mcp-servers', mcpServersRouter],
    ['/api/plugins', pluginsRouter],
    ['/api/admin', adminRouter],
    ['/api/quota', quotaRouter],
  ],
});

if (process.env.NODE_ENV !== 'test') {
  serve({ fetch: app.fetch, port }, () => {
    logger.info(`Agent API running on http://localhost:${port}`);
  });
}

export { app };
