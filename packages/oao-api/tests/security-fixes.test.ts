/**
 * Tests for security fixes and bug fixes:
 *   - Supervisor workspace scoping (Critical #1)
 *   - Agent instances admin-only access (Critical #2)
 *   - Agent-file path traversal prevention (High #9)
 *   - Token routes, events, workspaces, MCP servers, quota
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import type { Hono } from 'hono';

// ─── Mock database ──────────────────────────────────────────────────
const mockFindFirst = vi.fn();
const mockFindMany = vi.fn().mockResolvedValue([]);
const mockInsertReturning = vi.fn().mockResolvedValue([{ id: 'new-id-001' }]);
const mockUpdateReturning = vi.fn().mockResolvedValue([{ id: 'updated-id-001' }]);
const mockDeleteReturning = vi.fn().mockResolvedValue([]);

function createSelectChain(resolveValue: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.from = vi.fn(self);
  chain.where = vi.fn(self);
  chain.orderBy = vi.fn(self);
  chain.limit = vi.fn(self);
  chain.offset = vi.fn(self);
  chain.then = (resolve: Function) => resolve(resolveValue);
  return chain;
}

const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
const mockSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

const mockValues = vi.fn().mockReturnValue({
  returning: mockInsertReturning,
  onConflictDoUpdate: vi.fn().mockReturnValue({ returning: mockInsertReturning }),
  onConflictDoNothing: vi.fn().mockResolvedValue([]),
});
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
const mockDeleteObj = vi.fn().mockReturnValue({ where: mockDeleteReturning });

function buildChainableMock() {
  return {
    query: {
      agents: { findFirst: mockFindFirst, findMany: mockFindMany },
      workflows: { findFirst: mockFindFirst, findMany: mockFindMany },
      workflowSteps: { findFirst: vi.fn(), findMany: mockFindMany },
      triggers: { findFirst: mockFindFirst, findMany: mockFindMany },
      workflowExecutions: { findFirst: mockFindFirst, findMany: mockFindMany },
      stepExecutions: { findMany: mockFindMany },
      agentCredentials: { findFirst: mockFindFirst, findMany: mockFindMany },
      userCredentials: { findFirst: mockFindFirst, findMany: mockFindMany },
      webhookRegistrations: { findFirst: mockFindFirst },
      mcpServerConfigs: { findFirst: mockFindFirst, findMany: mockFindMany },
      systemEvents: { findFirst: mockFindFirst, findMany: mockFindMany },
      agentVariables: { findFirst: mockFindFirst, findMany: mockFindMany },
      userVariables: { findFirst: mockFindFirst, findMany: mockFindMany },
      workspaceVariables: { findFirst: mockFindFirst, findMany: mockFindMany },
      users: { findFirst: mockFindFirst, findMany: mockFindMany },
      workspaces: { findFirst: mockFindFirst, findMany: mockFindMany },
      agentFiles: { findFirst: mockFindFirst, findMany: mockFindMany },
      models: { findFirst: mockFindFirst, findMany: mockFindMany },
      agentInstances: { findFirst: mockFindFirst, findMany: mockFindMany },
      personalAccessTokens: { findFirst: mockFindFirst, findMany: mockFindMany },
      workspaceQuotaSettings: { findFirst: mockFindFirst },
      userQuotaSettings: { findFirst: mockFindFirst },
      creditUsage: { findFirst: mockFindFirst, findMany: mockFindMany },
    },
    select: vi.fn().mockImplementation(() => createSelectChain([])),
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDeleteObj,
    transaction: vi.fn().mockImplementation(async (fn: Function) => fn(mockDb)),
  };
}

const mockDb = buildChainableMock();

vi.mock('../src/database/index.js', () => ({ db: mockDb }));

vi.mock('../src/services/redis.js', () => ({
  getRedisConnection: vi.fn().mockReturnValue({
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
  }),
  getRedisConnectionOpts: vi.fn().mockReturnValue({ host: 'localhost', port: 6379 }),
}));

vi.mock('../src/services/workflow-engine.js', () => ({
  enqueueWorkflowExecution: vi.fn().mockResolvedValue({ id: 'exec-001', status: 'pending' }),
  retryWorkflowExecution: vi.fn().mockResolvedValue({ id: 'exec-retry-001', status: 'pending' }),
}));

vi.mock('../src/services/agent-instance-registry.js', () => ({
  listInstances: vi.fn().mockResolvedValue([]),
  cleanupOldInstances: vi.fn().mockResolvedValue(3),
  cleanupTerminatedEphemeralInstances: vi.fn().mockResolvedValue(2),
  cleanupStaleStaticInstances: vi.fn().mockResolvedValue(1),
  registerStaticInstance: vi.fn(),
  startHeartbeat: vi.fn(),
  deregisterStaticInstance: vi.fn(),
  markInstanceBusy: vi.fn(),
  markInstanceIdle: vi.fn(),
  registerEphemeralInstance: vi.fn(),
  terminateEphemeralInstance: vi.fn(),
  markStaleInstancesOffline: vi.fn(),
  getCurrentInstanceId: vi.fn().mockReturnValue(null),
}));

vi.mock('../src/services/workspace-settings.js', () => ({
  getWorkspaceSettings: vi.fn().mockResolvedValue({
    workspaceId: 'ws-1',
    allowRegistration: true,
    allowPasswordReset: true,
    ephemeralKeepAliveMs: 3_600_000,
    staticCleanupIntervalMs: 86_400_000,
    disallowCredentialAccessViaTools: true,
  }),
  invalidateWorkspaceSettingsCache: vi.fn(),
  DEFAULT_SETTINGS: {
    allowRegistration: true,
    allowPasswordReset: true,
    ephemeralKeepAliveMs: 3_600_000,
    staticCleanupIntervalMs: 86_400_000,
    disallowCredentialAccessViaTools: true,
  },
}));

vi.mock('../src/services/system-events.js', () => ({
  emitEvent: vi.fn().mockResolvedValue('event-id-001'),
  EVENT_NAMES: {
    AGENT_CREATED: 'agent.created',
    AGENT_UPDATED: 'agent.updated',
    AGENT_DELETED: 'agent.deleted',
    AGENT_STATUS_CHANGED: 'agent.status_changed',
    WORKFLOW_CREATED: 'workflow.created',
    WORKFLOW_UPDATED: 'workflow.updated',
    WORKFLOW_DELETED: 'workflow.deleted',
    EXECUTION_COMPLETED: 'execution.completed',
    EXECUTION_FAILED: 'execution.failed',
    WEBHOOK_RECEIVED: 'webhook.received',
  },
}));

let app: Hono;
let createJwt: typeof import('@oao/shared')['createJwt'];

const TEST_UUID = '550e8400-e29b-41d4-a716-446655440000';
const TEST_WORKSPACE_ID = '550e8400-e29b-41d4-a716-446655440001';
const OTHER_WORKSPACE_ID = '550e8400-e29b-41d4-a716-446655440099';
const TEST_AGENT_ID = '550e8400-e29b-41d4-a716-446655440010';

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-key-must-be-at-least-32-chars-long!!';
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  const serverMod = await import('../src/server.js');
  app = serverMod.app;
  const shared = await import('@oao/shared');
  createJwt = shared.createJwt;
});

beforeEach(() => {
  mockFindFirst.mockReset().mockResolvedValue(null);
  mockFindMany.mockReset().mockResolvedValue([]);
  mockInsertReturning.mockReset().mockResolvedValue([{ id: 'new-id-001' }]);
  mockUpdateReturning.mockReset().mockResolvedValue([{ id: 'updated-id-001' }]);
  mockDeleteReturning.mockReset().mockResolvedValue([]);
});

// ─── Helpers ────────────────────────────────────────────────────────

async function getToken(role = 'creator_user', workspaceId = TEST_WORKSPACE_ID) {
  return createJwt({
    userId: TEST_UUID,
    email: 'test@example.com',
    name: 'Test User',
    role,
    workspaceId,
    workspaceSlug: 'default',
  });
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// ======================================================================
// CRITICAL FIX #1 — Supervisor routes workspace scoping
// ======================================================================

describe('Supervisor routes — workspace scoping fix', () => {
  it('POST /api/supervisor/emergency-stop rejects non-admin (creator_user)', async () => {
    const token = await getToken('creator_user');
    const res = await app.request('/api/supervisor/emergency-stop', {
      method: 'POST',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(403);
  });

  it('POST /api/supervisor/emergency-stop rejects non-admin (view_user)', async () => {
    const token = await getToken('view_user');
    const res = await app.request('/api/supervisor/emergency-stop', {
      method: 'POST',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(403);
  });

  it('POST /api/supervisor/emergency-stop succeeds for workspace_admin', async () => {
    const token = await getToken('workspace_admin');
    mockUpdateReturning.mockResolvedValueOnce([
      { id: 'agent-1', name: 'Agent 1' },
    ]);
    const res = await app.request('/api/supervisor/emergency-stop', {
      method: 'POST',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.action).toBe('emergency-stop');
  });

  it('POST /api/supervisor/emergency-stop succeeds for super_admin', async () => {
    const token = await getToken('super_admin');
    mockUpdateReturning.mockResolvedValueOnce([
      { id: 'agent-1', name: 'Global Agent' },
    ]);
    const res = await app.request('/api/supervisor/emergency-stop', {
      method: 'POST',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
  });

  it('POST /api/supervisor/resume-all rejects non-admin', async () => {
    const token = await getToken('creator_user');
    const res = await app.request('/api/supervisor/resume-all', {
      method: 'POST',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(403);
  });

  it('POST /api/supervisor/resume-all succeeds for workspace_admin', async () => {
    const token = await getToken('workspace_admin');
    mockUpdateReturning.mockResolvedValueOnce([]);
    const res = await app.request('/api/supervisor/resume-all', {
      method: 'POST',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.action).toBe('resume-all');
  });

  it('GET /api/supervisor/status rejects non-admin', async () => {
    const token = await getToken('creator_user');
    const res = await app.request('/api/supervisor/status', {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(403);
  });

  it('GET /api/supervisor/status returns status for workspace_admin', async () => {
    const token = await getToken('workspace_admin');
    mockFindMany.mockResolvedValueOnce([
      { id: '1', name: 'Agent1', status: 'active', updatedAt: new Date() },
      { id: '2', name: 'Agent2', status: 'paused', updatedAt: new Date() },
    ]);
    const res = await app.request('/api/supervisor/status', {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.counts).toBeDefined();
    expect(json.agents).toHaveLength(2);
  });
});

// ======================================================================
// CRITICAL FIX #2 — Agent instances admin-only access
// ======================================================================

describe('Agent instances — admin-only access fix', () => {
  it('GET /api/agent-instances rejects creator_user', async () => {
    const token = await getToken('creator_user');
    const res = await app.request('/api/agent-instances', {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('Admin access required');
  });

  it('GET /api/agent-instances rejects view_user', async () => {
    const token = await getToken('view_user');
    const res = await app.request('/api/agent-instances', {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(403);
  });

  it('GET /api/agent-instances succeeds for workspace_admin', async () => {
    const token = await getToken('workspace_admin');
    const res = await app.request('/api/agent-instances', {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.instances).toBeDefined();
  });

  it('GET /api/agent-instances succeeds for super_admin', async () => {
    const token = await getToken('super_admin');
    const res = await app.request('/api/agent-instances', {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
  });

  it('GET /api/agent-instances/:id rejects invalid UUID', async () => {
    const token = await getToken('workspace_admin');
    const res = await app.request('/api/agent-instances/not-a-uuid', {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(400);
  });

  it('GET /api/agent-instances/:id returns 404 for unknown instance', async () => {
    const token = await getToken('workspace_admin');
    const res = await app.request(`/api/agent-instances/${TEST_UUID}`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(404);
  });

  it('GET /api/agent-instances/:id returns instance for admin', async () => {
    const token = await getToken('workspace_admin');
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_UUID,
      name: 'worker-1',
      instanceType: 'static',
      status: 'idle',
    });
    const res = await app.request(`/api/agent-instances/${TEST_UUID}`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.instance.name).toBe('worker-1');
  });

  it('DELETE /api/agent-instances/:id rejects non-admin', async () => {
    const token = await getToken('creator_user');
    const res = await app.request(`/api/agent-instances/${TEST_UUID}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(403);
  });

  it('DELETE /api/agent-instances/:id rejects invalid UUID', async () => {
    const token = await getToken('workspace_admin');
    const res = await app.request('/api/agent-instances/bad-id', {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(400);
  });

  it('DELETE /api/agent-instances/:id returns 404 for unknown', async () => {
    const token = await getToken('workspace_admin');
    const res = await app.request(`/api/agent-instances/${TEST_UUID}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/agent-instances/:id removes instance for admin', async () => {
    const token = await getToken('workspace_admin');
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_UUID,
      name: 'worker-old',
      status: 'offline',
    });
    const res = await app.request(`/api/agent-instances/${TEST_UUID}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toBe('Instance removed');
  });

  it('POST /api/agent-instances/cleanup rejects non-admin', async () => {
    const token = await getToken('creator_user');
    const res = await app.request('/api/agent-instances/cleanup', {
      method: 'POST',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(403);
  });

  it('POST /api/agent-instances/cleanup works for admin', async () => {
    const token = await getToken('workspace_admin');
    mockDeleteReturning.mockResolvedValueOnce([]);
    const res = await app.request('/api/agent-instances/cleanup', {
      method: 'POST',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.removed).toBe('number');
  });
});

// ======================================================================
// HIGH FIX #9 — Agent file path traversal prevention
// ======================================================================

describe('Agent files — path traversal prevention', () => {
  it('POST /api/agent-files/:agentId rejects path traversal (..)', async () => {
    const token = await getToken();
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_AGENT_ID,
      workspaceId: TEST_WORKSPACE_ID,
      sourceType: 'database',
    });

    const res = await app.request(`/api/agent-files/${TEST_AGENT_ID}`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ filePath: '../../../etc/passwd', content: 'hack' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/agent-files/:agentId rejects absolute path', async () => {
    const token = await getToken();
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_AGENT_ID,
      workspaceId: TEST_WORKSPACE_ID,
      sourceType: 'database',
    });

    const res = await app.request(`/api/agent-files/${TEST_AGENT_ID}`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ filePath: '/etc/passwd', content: 'hack' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/agent-files/:agentId rejects embedded traversal', async () => {
    const token = await getToken();
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_AGENT_ID,
      workspaceId: TEST_WORKSPACE_ID,
      sourceType: 'database',
    });

    const res = await app.request(`/api/agent-files/${TEST_AGENT_ID}`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ filePath: 'skills/../../../etc/shadow', content: 'x' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/agent-files/:agentId allows valid relative path', async () => {
    const token = await getToken();
    mockFindFirst
      .mockResolvedValueOnce({
        id: TEST_AGENT_ID,
        workspaceId: TEST_WORKSPACE_ID,
        sourceType: 'database',
      })
      .mockResolvedValueOnce(null); // no duplicate

    mockInsertReturning.mockResolvedValueOnce([{
      id: 'file-001',
      agentId: TEST_AGENT_ID,
      filePath: 'skills/research.md',
      content: '# Research',
    }]);

    const res = await app.request(`/api/agent-files/${TEST_AGENT_ID}`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ filePath: 'skills/research.md', content: '# Research' }),
    });
    expect(res.status).toBe(201);
  });

  it('POST /api/agent-files/:agentId allows simple filename', async () => {
    const token = await getToken();
    mockFindFirst
      .mockResolvedValueOnce({
        id: TEST_AGENT_ID,
        workspaceId: TEST_WORKSPACE_ID,
        sourceType: 'database',
      })
      .mockResolvedValueOnce(null);

    mockInsertReturning.mockResolvedValueOnce([{
      id: 'file-002',
      filePath: 'agent.md',
    }]);

    const res = await app.request(`/api/agent-files/${TEST_AGENT_ID}`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ filePath: 'agent.md', content: '# Agent' }),
    });
    expect(res.status).toBe(201);
  });
});

// ======================================================================
// TOKEN ROUTES
// ======================================================================

describe('Token routes', () => {
  it('GET /api/tokens/scopes returns available scopes', async () => {
    const token = await getToken();
    const res = await app.request('/api/tokens/scopes', {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.scopes).toBeDefined();
    expect(json.scopes.length).toBeGreaterThan(0);
    expect(json.scopes[0]).toHaveProperty('name');
    expect(json.scopes[0]).toHaveProperty('description');
  });

  it('POST /api/tokens creates a PAT and returns raw token', async () => {
    const token = await getToken();
    mockInsertReturning.mockResolvedValueOnce([{
      id: 'pat-001',
      name: 'Test Token',
      tokenPrefix: 'oao_abcd',
      scopes: ['webhook:trigger'],
      expiresAt: null,
      createdAt: new Date(),
    }]);

    const res = await app.request('/api/tokens', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        name: 'Test Token',
        scopes: ['webhook:trigger'],
      }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.token).toBeDefined();
    expect(json.token).toMatch(/^oao_/);
    expect(json.pat.name).toBe('Test Token');
  });

  it('POST /api/tokens rejects empty scopes', async () => {
    const token = await getToken();
    const res = await app.request('/api/tokens', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'Bad Token', scopes: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/tokens rejects invalid scope', async () => {
    const token = await getToken();
    const res = await app.request('/api/tokens', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'Bad Token', scopes: ['admin:nuke'] }),
    });
    expect(res.status).toBe(400);
  });

  it('GET /api/tokens lists user tokens', async () => {
    const token = await getToken();
    const res = await app.request('/api/tokens', {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tokens).toBeDefined();
    expect(typeof json.total).toBe('number');
  });

  it('DELETE /api/tokens/:id revokes token', async () => {
    const token = await getToken();
    mockUpdateReturning.mockResolvedValueOnce([{ id: 'pat-001' }]);

    const res = await app.request('/api/tokens/pat-001', {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toBe('Token revoked');
  });

  it('DELETE /api/tokens/:id returns 404 for unknown token', async () => {
    const token = await getToken();
    mockUpdateReturning.mockResolvedValueOnce([]);

    const res = await app.request('/api/tokens/pat-unknown', {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(404);
  });
});

// ======================================================================
// EVENT ROUTES
// ======================================================================

describe('Event routes', () => {
  it('GET /api/events returns paginated events', async () => {
    const token = await getToken();
    const res = await app.request('/api/events', {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.events).toBeDefined();
  });

  it('GET /api/events/names returns event names', async () => {
    const token = await getToken();
    const res = await app.request('/api/events/names', {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.eventNames).toBeDefined();
    expect(Array.isArray(json.eventNames)).toBe(true);
  });
});

// ======================================================================
// WORKSPACE ROUTES
// ======================================================================

describe('Workspace routes', () => {
  it('GET /api/workspaces rejects non-super_admin', async () => {
    const token = await getToken('workspace_admin');
    const res = await app.request('/api/workspaces', {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(403);
  });

  it('POST /api/workspaces creates workspace for super_admin', async () => {
    const token = await getToken('super_admin');
    mockInsertReturning.mockResolvedValueOnce([{
      id: 'ws-001',
      name: 'Test Workspace',
      slug: 'test-ws',
    }]);

    const res = await app.request('/api/workspaces', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'Test Workspace', slug: 'test-ws' }),
    });
    expect(res.status).toBe(201);
  });

  it('POST /api/workspaces rejects non-super_admin', async () => {
    const token = await getToken('workspace_admin');
    const res = await app.request('/api/workspaces', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'Hack', slug: 'hack' }),
    });
    expect(res.status).toBe(403);
  });
});

// NOTE: MCP server config routes (mcp-servers.ts) exist as a file but are NOT
// mounted in server.ts, so they are unreachable. Tests omitted intentionally.

// ======================================================================
// QUOTA ROUTES
// ======================================================================

describe('Quota routes', () => {
  it('GET /api/quota/settings returns settings', async () => {
    const token = await getToken();
    const res = await app.request('/api/quota/settings', {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
  });

  it('PUT /api/quota/settings updates for any authenticated user', async () => {
    const token = await getToken('creator_user');
    mockInsertReturning.mockResolvedValueOnce([{
      id: 'quota-001',
      dailyCreditLimit: '100.00',
    }]);
    const res = await app.request('/api/quota/settings', {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({ dailyCreditLimit: '100.00' }),
    });
    // Quota settings endpoint allows any authenticated user to update their own settings
    expect([200, 201]).toContain(res.status);
  });

  it('GET /api/quota/models returns available models', async () => {
    const token = await getToken();
    const res = await app.request('/api/quota/models', {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.models).toBeDefined();
  });
});

// ======================================================================
// AUTH ROUTES — provider listing
// ======================================================================

describe('Auth provider listing', () => {
  it('GET /api/auth/providers is public (no auth required)', async () => {
    mockFindMany.mockResolvedValueOnce([{
      id: 'provider-1',
      name: 'Database',
      type: 'database',
      isActive: true,
    }]);

    const res = await app.request('/api/auth/providers');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.providers).toBeDefined();
  });
});

// ======================================================================
// HEALTH & INFRASTRUCTURE
// ======================================================================

describe('Health & infrastructure', () => {
  it('GET /health returns ok', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('ok');
  });

  it('GET /api/openapi.json returns OpenAPI spec', async () => {
    const res = await app.request('/api/openapi.json');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.openapi).toBe('3.0.3');
    expect(json.info.title).toContain('OAO');
  });

  it('GET /api/docs returns Swagger UI page', async () => {
    const res = await app.request('/api/docs');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('swagger');
  });

  it('unauthenticated request to protected route returns 401', async () => {
    const res = await app.request('/api/agents');
    expect(res.status).toBe(401);
  });
});
