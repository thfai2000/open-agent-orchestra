import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('../src/database/index.js', () => ({
  db: {
    query: {
      agents: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      workflows: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      workflowSteps: { findMany: vi.fn().mockResolvedValue([]) },
      triggers: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      workflowExecutions: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      stepExecutions: { findMany: vi.fn().mockResolvedValue([]) },
      agentCredentials: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      userCredentials: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      webhookRegistrations: { findFirst: vi.fn() },
      mcpServerConfigs: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      systemEvents: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    },
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              offset: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'test-id' }]),
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'test-id' }]),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
    transaction: vi.fn(),
  },
}));

vi.mock('../src/services/redis.js', () => ({
  getRedisConnection: vi.fn().mockReturnValue({}),
  getRedisConnectionOpts: vi.fn().mockReturnValue({ host: 'localhost', port: 6379 }),
}));

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-key-must-be-at-least-32-chars-long!!';
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
});

describe('Health & infrastructure', () => {
  it('responds to /health with status ok', async () => {
    const { app } = await import('../src/server.js');
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('ok');
    expect(json.service).toBe('agent-api');
    expect(json.version).toBe('4.0.0');
  });

  it('serves OpenAPI spec at /api/openapi.json', async () => {
    const { app } = await import('../src/server.js');
    const res = await app.request('/api/openapi.json');
    expect(res.status).toBe(200);
    const spec = await res.json();
    expect(spec.openapi).toBeDefined();
    expect(spec.info.title).toBeDefined();
  });

  it('returns 404 for unknown routes', async () => {
    const { app } = await import('../src/server.js');
    const res = await app.request('/api/nonexistent');
    expect(res.status).toBe(404);
  });
});

describe('Auth routes', () => {
  it('rejects register with invalid email', async () => {
    const { app } = await import('../src/server.js');
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invalid', password: '12345678', name: 'Test' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects register with short password', async () => {
    const { app } = await import('../src/server.js');
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com', password: '123', name: 'Test' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects /me without auth token', async () => {
    const { app } = await import('../src/server.js');
    const res = await app.request('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('Agent routes', () => {
  it('rejects creating an agent without auth', async () => {
    const { app } = await import('../src/server.js');
    const res = await app.request('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Agent' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects creating an agent with invalid data (missing name after auth)', async () => {
    const { createJwt } = await import('@ai-trader/shared');
    const token = await createJwt({
      userId: '550e8400-e29b-41d4-a716-446655440000',
      email: 'test@example.com',
      name: 'Test',
      role: 'creator_user',
      workspaceId: '550e8400-e29b-41d4-a716-446655440001',
      workspaceSlug: 'default',
    });
    const { app } = await import('../src/server.js');
    const res = await app.request('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('Workflow routes', () => {
  it('rejects creating a workflow without auth', async () => {
    const { app } = await import('../src/server.js');
    const res = await app.request('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Workflow' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('Variable routes', () => {
  it('rejects variable creation without auth', async () => {
    const { app } = await import('../src/server.js');
    const res = await app.request('/api/variables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: '550e8400-e29b-41d4-a716-446655440000',
        key: 'API_KEY',
        value: 'test',
      }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects variable with invalid key format after auth', async () => {
    const { createJwt } = await import('@ai-trader/shared');
    const token = await createJwt({
      userId: '550e8400-e29b-41d4-a716-446655440000',
      email: 'test@example.com',
      name: 'Test',
      role: 'creator_user',
      workspaceId: '550e8400-e29b-41d4-a716-446655440001',
      workspaceSlug: 'default',
    });
    const { app } = await import('../src/server.js');
    const res = await app.request('/api/variables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        agentId: '550e8400-e29b-41d4-a716-446655440000',
        key: 'invalid-key-lowercase',
        value: 'test',
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe('Trigger routes', () => {
  it('rejects trigger creation without auth', async () => {
    const { app } = await import('../src/server.js');
    const res = await app.request('/api/triggers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });
});

describe('Execution routes', () => {
  it('requires auth for execution list', async () => {
    const { app } = await import('../src/server.js');
    const res = await app.request('/api/executions');
    expect(res.status).toBe(401);
  });
});

describe('Supervisor routes', () => {
  it('requires auth for supervisor endpoint', async () => {
    const { app } = await import('../src/server.js');
    const res = await app.request('/api/supervisor');
    expect(res.status).toBe(401);
  });
});

describe('MCP server routes', () => {
  it('rejects MCP server creation without auth', async () => {
    const { app } = await import('../src/server.js');
    const res = await app.request('/api/mcp-servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test Server',
        command: 'node',
      }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects MCP server listing without agentId', async () => {
    const { createJwt } = await import('@ai-trader/shared');
    const token = await createJwt({
      userId: '550e8400-e29b-41d4-a716-446655440000',
      email: 'test@example.com',
      name: 'Test',
      role: 'creator_user',
      workspaceId: '550e8400-e29b-41d4-a716-446655440001',
      workspaceSlug: 'default',
    });
    const { app } = await import('../src/server.js');
    const res = await app.request('/api/mcp-servers', {
      headers: { Authorization: 'Bearer ' + token },
    });
    expect(res.status).toBe(400);
  });
});

describe('Event routes', () => {
  it('requires auth for events list', async () => {
    const { app } = await import('../src/server.js');
    const res = await app.request('/api/events');
    expect(res.status).toBe(401);
  });

  it('requires auth for event names', async () => {
    const { app } = await import('../src/server.js');
    const res = await app.request('/api/events/names');
    expect(res.status).toBe(401);
  });

  it('returns event names with auth', async () => {
    const { createJwt } = await import('@ai-trader/shared');
    const token = await createJwt({
      userId: '550e8400-e29b-41d4-a716-446655440000',
      email: 'test@example.com',
      name: 'Test',
      role: 'creator_user',
      workspaceId: '550e8400-e29b-41d4-a716-446655440001',
      workspaceSlug: 'default',
    });
    const { app } = await import('../src/server.js');
    const res = await app.request('/api/events/names', {
      headers: { Authorization: 'Bearer ' + token },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.eventNames).toBeDefined();
    expect(Array.isArray(json.eventNames)).toBe(true);
    expect(json.eventNames.length).toBeGreaterThan(0);
    expect(json.eventNames).toContain('agent.created');
    expect(json.eventNames).toContain('execution.completed');
  });
});
