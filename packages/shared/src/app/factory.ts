import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { swaggerUI } from '@hono/swagger-ui';
import { rateLimiter } from '../middleware/rate-limiter.js';
import { createLogger } from '../utils/logger.js';
import client from 'prom-client';

// ─── Prometheus Metrics ─────────────────────────────────────────────
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

const httpRequestTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

interface EventBus {
  connect(c: unknown): Response;
  connectionCount: number;
}

interface AppConfig {
  serviceName: string;
  port: number;
  eventBus: EventBus;
  apiSpec?: object; // deprecated — auto-generated from routes now
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  routes: Array<[string, any]>;
  extraRateLimits?: Array<{ path: string; windowMs: number; max: number }>;
}

/**
 * Create a configured OpenAPIHono app with shared middleware, health check,
 * SSE event stream, auto-generated OpenAPI docs, and error handling.
 */
export function createApp(config: AppConfig): OpenAPIHono {
  const { serviceName, eventBus, routes, extraRateLimits } = config;
  const logger = createLogger(serviceName);
  const app = new OpenAPIHono();

  // Common middleware — restrict CORS to known origins
  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
    : ['http://localhost:3002', 'http://localhost:3000'];
  app.use('/*', cors({ origin: allowedOrigins }));
  app.use('/*', rateLimiter({ windowMs: 60_000, max: 100 }));
  app.use('/*', bodyLimit({ maxSize: 1024 * 1024 })); // 1 MB request body limit

  // Extra rate limits (e.g. auth endpoints)
  for (const rl of extraRateLimits ?? []) {
    app.use(rl.path, rateLimiter({ windowMs: rl.windowMs, max: rl.max }));
  }

  // Prometheus metrics middleware
  app.use('/*', async (c, next) => {
    const start = Date.now();
    await next();
    const duration = (Date.now() - start) / 1000;
    const route = c.req.routePath || c.req.path;
    const method = c.req.method;
    const status = String(c.res.status);
    httpRequestDuration.observe({ method, route, status_code: status }, duration);
    httpRequestTotal.inc({ method, route, status_code: status });
  });

  // Health check
  app.get('/health', (c) => c.json({ status: 'ok', service: serviceName, version: '4.0.0' }));

  // Prometheus metrics endpoint
  app.get('/metrics', async (c) => {
    const metrics = await register.metrics();
    return c.text(metrics, 200, { 'Content-Type': register.contentType });
  });

  // Mount routes
  for (const [path, router] of routes) {
    app.route(path, router);
  }

  // SSE — real-time event stream
  app.get('/api/events', (c) => eventBus.connect(c));
  app.get('/api/events/status', (c) => c.json({ connections: eventBus.connectionCount }));

  // OpenAPI documentation — auto-generated from @hono/zod-openapi route definitions
  app.doc('/api/openapi.json', {
    openapi: '3.0.3',
    info: {
      title: 'OAO — Open Agent Orchestra API',
      version: '6.0.0',
      description:
        'Autonomous AI workflow engine powered by the GitHub Copilot SDK.\n\n' +
        '## Authentication\n\n' +
        'All endpoints (except auth) require a Bearer token:\n' +
        '`Authorization: Bearer <jwt_or_pat>`\n\n' +
        '## Pagination\n\n' +
        'List endpoints accept `?page=1&limit=50` (max 200).\n\n' +
        '## Variable Scoping (3-Tier)\n\n' +
        'Variables resolved with priority: **Agent > User > Workspace**.',
    },
    servers: [
      { url: 'http://localhost:4002', description: 'Local development' },
      { url: 'http://oao.local', description: 'Local Kubernetes (via Ingress)' },
    ],
    tags: [
      { name: 'Auth', description: 'User registration and login' },
      { name: 'Agents', description: 'AI agent configuration and lifecycle' },
      { name: 'Agent Files', description: 'Agent instruction/skill file management' },
      { name: 'Agent Versions', description: 'Agent version history and snapshots' },
      { name: 'Workflows', description: 'Multi-step workflow templates' },
      { name: 'Workflow Versions', description: 'Workflow version history and snapshots' },
      { name: 'Executions', description: 'Workflow execution history and control' },
      { name: 'Variables', description: '3-tier scoped variables (agent / user / workspace)' },
      { name: 'Triggers', description: 'Workflow trigger configuration' },
      { name: 'Tokens', description: 'Personal Access Token management' },
      { name: 'Admin', description: 'Workspace administration' },
      { name: 'Supervisor', description: 'Agent supervisor controls' },
    ],
  });
  app.get('/api/docs', swaggerUI({ url: '/api/openapi.json' }));

  // Error handler
  app.onError((err, c) => {
    if (err.name === 'ZodError') {
      return c.json({ error: 'Validation failed', details: JSON.parse(err.message) }, 400);
    }
    logger.error(err, 'Unhandled error');
    return c.json({ error: 'Internal server error' }, 500);
  });

  return app;
}
