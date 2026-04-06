import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { rateLimiter } from '../../src/middleware/rate-limiter.js';

function createApp(max: number) {
  const app = new Hono();
  app.use('/*', rateLimiter({ windowMs: 60_000, max }));
  app.get('/test', (c) => c.json({ ok: true }));
  return app;
}

describe('rateLimiter', () => {
  it('allows requests under the limit', async () => {
    const app = createApp(5);
    const res = await app.request('/test', { headers: { 'X-Forwarded-For': '1.2.3.4' } });
    expect(res.status).toBe(200);
  });

  it('sets rate-limit headers', async () => {
    const app = createApp(10);
    const res = await app.request('/test', { headers: { 'X-Forwarded-For': '10.0.0.1' } });
    expect(res.headers.get('X-RateLimit-Limit')).toBe('10');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('9');
    expect(res.headers.get('X-RateLimit-Reset')).toBeTruthy();
  });

  it('decrements remaining count on each request', async () => {
    const app = createApp(3);
    const h = { 'X-Forwarded-For': '10.0.0.2' };
    const r1 = await app.request('/test', { headers: h });
    expect(r1.headers.get('X-RateLimit-Remaining')).toBe('2');
    const r2 = await app.request('/test', { headers: h });
    expect(r2.headers.get('X-RateLimit-Remaining')).toBe('1');
  });

  it('returns 429 when limit is exceeded', async () => {
    const app = createApp(2);
    const h = { 'X-Forwarded-For': '10.0.0.3' };
    await app.request('/test', { headers: h });
    await app.request('/test', { headers: h });
    const r3 = await app.request('/test', { headers: h });
    expect(r3.status).toBe(429);
    const body = await r3.json();
    expect(body.error).toBe('Too many requests');
    expect(r3.headers.get('Retry-After')).toBeTruthy();
  });

  it('tracks different IPs independently', async () => {
    const app = createApp(1);
    const r1 = await app.request('/test', { headers: { 'X-Forwarded-For': '192.168.1.1' } });
    expect(r1.status).toBe(200);
    const r2 = await app.request('/test', { headers: { 'X-Forwarded-For': '192.168.1.2' } });
    expect(r2.status).toBe(200);
    const r3 = await app.request('/test', { headers: { 'X-Forwarded-For': '192.168.1.1' } });
    expect(r3.status).toBe(429);
  });
});
