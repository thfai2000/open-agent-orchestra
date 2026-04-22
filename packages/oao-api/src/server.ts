import { serve } from '@hono/node-server';
import {
  createApp,
  createLogger,
  agentEventBus,
  registerPatValidator,
} from '@oao/shared';
import agentsRouter from './routes/agents.js';
import authRouter from './routes/auth.js';
import authProvidersRouter from './routes/auth-providers.js';
import workflowsRouter from './routes/workflows.js';
import executionsRouter from './routes/executions.js';
import variablesRouter from './routes/variables.js';
import triggersRouter from './routes/triggers.js';
import jiraWebhooksRouter from './routes/jira-webhooks.js';
import webhooks from './routes/webhooks.js';
import supervisorRouter from './routes/supervisor.js';
import adminRouter from './routes/admin.js';
import modelsRouter from './routes/models.js';
import quotaRouter from './routes/quota.js';
import workspacesRouter from './routes/workspaces.js';
import eventsRouter from './routes/events.js';
import agentFilesRouter from './routes/agent-files.js';
import agentInstancesRouter from './routes/agent-instances.js';
import conversationsRouter from './routes/conversations.js';
import mcpServersRouter from './routes/mcp-servers.js';
import tokensRouter, { validatePat } from './routes/tokens.js';
import { startRealtimeSubscriber } from './services/realtime-bus.js';

const logger = createLogger('oao-api');
const port = Number(process.env.AGENT_API_PORT) || 4002;

// Register PAT validator so the shared auth middleware can validate oao_* tokens
registerPatValidator(validatePat);

const app = createApp({
  serviceName: 'oao-api',
  port,
  eventBus: agentEventBus,
  extraRateLimits: [
    { path: '/api/auth/*', windowMs: 60_000, max: 10 },
  ],
  routes: [
    ['/api/auth', authRouter],
    ['/api/auth-providers', authProvidersRouter],
    ['/api/agents', agentsRouter],
    ['/api/workflows', workflowsRouter],
    ['/api/executions', executionsRouter],
    ['/api/variables', variablesRouter],
    ['/api/triggers', triggersRouter],
    ['/api/jira-webhooks', jiraWebhooksRouter],
    ['/api/webhooks', webhooks],
    ['/api/supervisor', supervisorRouter],
    ['/api/admin', adminRouter],
    ['/api/models', modelsRouter],
    ['/api/quota', quotaRouter],
    ['/api/workspaces', workspacesRouter],
    ['/api/events', eventsRouter],
    ['/api/agent-files', agentFilesRouter],
    ['/api/agent-instances', agentInstancesRouter],
    ['/api/conversations', conversationsRouter],
    ['/api/mcp-servers', mcpServersRouter],
    ['/api/tokens', tokensRouter],
  ],
});

if (process.env.NODE_ENV !== 'test') {
  startRealtimeSubscriber();
  serve({ fetch: app.fetch, port }, () => {
    logger.info(`Agent API running on http://localhost:${port}`);
  });
}

export { app };
