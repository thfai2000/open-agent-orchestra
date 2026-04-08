import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { rateLimiter } from '../middleware/rate-limiter.js';
import { registerOpenAPI } from '../openapi.js';
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
  apiSpec: object;
  routes: Array<[string, Hono]>;
  extraRateLimits?: Array<{ path: string; windowMs: number; max: number }>;
}

/**
 * Create a configured Hono app with shared middleware, health check,
 * SSE event stream, OpenAPI docs, and error handling.
 */
export function createApp(config: AppConfig): Hono {
  const { serviceName, eventBus, apiSpec, routes, extraRateLimits } = config;
  const logger = createLogger(serviceName);
  const app = new Hono();

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

  // OpenAPI documentation
  registerOpenAPI(app, apiSpec);

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
