/**
 * Extended route handler tests for previously untested routes.
 * Covers: webhooks (HMAC), auth (login/register/change-password),
 * admin (users, models), agent-files, triggers CRUD, executions retry.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import type { Hono } from 'hono';

// ─── Mock database ──────────────────────────────────────────────────
const mockFindFirst = vi.fn();
const mockFindMany = vi.fn().mockResolvedValue([]);
const mockInsertReturning = vi.fn().mockResolvedValue([{ id: 'new-id-001' }]);
const mockUpdateReturning = vi.fn().mockResolvedValue([{ id: 'updated-id-001' }]);
const mockDeleteWhere = vi.fn().mockResolvedValue([]);

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

const mockOnConflictDoUpdate = vi.fn().mockReturnValue({ returning: mockInsertReturning });
const mockValues = vi.fn().mockReturnValue({
  returning: mockInsertReturning,
  onConflictDoUpdate: mockOnConflictDoUpdate,
  onConflictDoNothing: vi.fn().mockResolvedValue([]),
});
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

const mockReturning = vi.fn().mockImplementation(() => mockUpdateReturning());
const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
const mockSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

const mockDeleteObj = vi.fn().mockReturnValue({ where: mockDeleteWhere });

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
      workspaceQuotaSettings: { findFirst: mockFindFirst },
      creditUsage: { findFirst: mockFindFirst, findMany: mockFindMany },
      plugins: { findFirst: mockFindFirst, findMany: mockFindMany },
      agentPlugins: { findFirst: mockFindFirst, findMany: mockFindMany },
    },
    select: vi.fn().mockImplementation(() => createSelectChain([])),
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDeleteObj,
    transaction: vi.fn().mockImplementation(async (fn: Function) => fn(mockDb)),
  };
}

const mockDb = buildChainableMock();

vi.mock('../src/database/index.js', () => ({
  db: mockDb,
}));

vi.mock('../src/services/redis.js', () => ({
  getRedisConnection: vi.fn().mockReturnValue({
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
  }),
  getRedisConnectionOpts: vi.fn().mockReturnValue({ host: 'localhost', port: 6379 }),
}));

vi.mock('../src/services/workflow-engine.js', () => ({
  enqueueWorkflowExecution: vi.fn().mockResolvedValue({
    id: 'exec-new-001',
    status: 'pending',
    workflowId: '550e8400-e29b-41d4-a716-446655440020',
  }),
  retryWorkflowExecution: vi.fn().mockResolvedValue({
    id: 'exec-retry-001',
    status: 'pending',
  }),
}));

vi.mock('../src/services/system-events.js', () => ({
  emitEvent: vi.fn(),
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
  },
}));

let app: Hono;
let createJwt: typeof import('@oao/shared')['createJwt'];
let encrypt: typeof import('@oao/shared')['encrypt'];
let decrypt: typeof import('@oao/shared')['decrypt'];

const TEST_UUID = '550e8400-e29b-41d4-a716-446655440000';
const TEST_WORKSPACE_ID = '550e8400-e29b-41d4-a716-446655440001';
const TEST_AGENT_ID = '550e8400-e29b-41d4-a716-446655440010';
const TEST_WORKFLOW_ID = '550e8400-e29b-41d4-a716-446655440020';
const TEST_FILE_ID = '550e8400-e29b-41d4-a716-446655440030';
const TEST_TRIGGER_ID = '550e8400-e29b-41d4-a716-446655440040';
const TEST_EXECUTION_ID = '550e8400-e29b-41d4-a716-446655440050';
const TEST_MODEL_ID = '550e8400-e29b-41d4-a716-446655440060';
const TEST_WEBHOOK_REG_ID = '550e8400-e29b-41d4-a716-446655440070';

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-key-must-be-at-least-32-chars-long!!';
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  const serverMod = await import('../src/server.js');
  app = serverMod.app;
  const shared = await import('@oao/shared');
  createJwt = shared.createJwt;
  encrypt = shared.encrypt;
  decrypt = shared.decrypt;
});

/** Reset all mock queues AND re-set defaults. Prevents stale mockResolvedValueOnce leaks. */
beforeEach(() => {
  mockFindFirst.mockReset();
  mockFindMany.mockReset();
  mockInsertReturning.mockReset();
  mockUpdateReturning.mockReset();
  mockDeleteWhere.mockReset();

  // Restore defaults
  mockFindFirst.mockResolvedValue(null);
  mockFindMany.mockResolvedValue([]);
  mockInsertReturning.mockResolvedValue([{ id: 'new-id-001' }]);
  mockUpdateReturning.mockResolvedValue([{ id: 'updated-id-001' }]);
  mockDeleteWhere.mockResolvedValue([]);
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
// WEBHOOK ROUTES — HMAC Verification
// ======================================================================

describe('Webhook HMAC verification', () => {
  const WEBHOOK_SECRET = 'my-webhook-secret-key';

  function makeSignature(timestamp: string, body: string, secret: string) {
    return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  }

  it('POST /api/webhooks/:id rejects missing X-Signature header', async () => {
    const body = JSON.stringify({ event: 'push' });
    const res = await app.request(`/api/webhooks/${TEST_WEBHOOK_REG_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Timestamp': String(Math.floor(Date.now() / 1000)),
      },
      body,
    });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/signature/i);
  });

  it('POST /api/webhooks/:id rejects missing X-Timestamp header', async () => {
    const body = JSON.stringify({ event: 'push' });
    const res = await app.request(`/api/webhooks/${TEST_WEBHOOK_REG_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': 'abc123',
      },
      body,
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/webhooks/:id rejects expired timestamp (> 5 minutes)', async () => {
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 400); // 6+ minutes ago
    const body = JSON.stringify({ event: 'push' });
    // Timestamp check occurs BEFORE DB lookup, so no mock needed
    const sig = makeSignature(oldTimestamp, body, WEBHOOK_SECRET);
    const res = await app.request(`/api/webhooks/${TEST_WEBHOOK_REG_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': sig,
        'X-Timestamp': oldTimestamp,
        'X-Event-Id': 'evt-001',
      },
      body,
    });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/timestamp/i);
  });

  it('POST /api/webhooks/:id rejects unknown registration', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ event: 'push' });

    mockFindFirst.mockResolvedValueOnce(null); // not found

    const res = await app.request(`/api/webhooks/${TEST_WEBHOOK_REG_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': 'somesig',
        'X-Timestamp': timestamp,
        'X-Event-Id': 'evt-002',
      },
      body,
    });
    expect(res.status).toBe(404);
  });

  it('POST /api/webhooks/:id rejects inactive registration', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ event: 'push' });

    mockFindFirst.mockResolvedValueOnce({
      id: TEST_WEBHOOK_REG_ID,
      hmacSecretEncrypted: encrypt(WEBHOOK_SECRET),
      isActive: false,
      requestCount: 0,
      triggerId: null,
    });

    const res = await app.request(`/api/webhooks/${TEST_WEBHOOK_REG_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': 'anysig',
        'X-Timestamp': timestamp,
        'X-Event-Id': 'evt-003',
      },
      body,
    });
    expect(res.status).toBe(404);
  });

  it('POST /api/webhooks/:id rejects invalid HMAC signature', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ event: 'push' });

    mockFindFirst.mockResolvedValueOnce({
      id: TEST_WEBHOOK_REG_ID,
      hmacSecretEncrypted: encrypt(WEBHOOK_SECRET),
      isActive: true,
      requestCount: 0,
      triggerId: null,
    });

    // Must be 64 hex chars (same length as sha256 hex digest) to avoid timingSafeEqual length error
    const wrongSig = 'a'.repeat(64);
    const res = await app.request(`/api/webhooks/${TEST_WEBHOOK_REG_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': wrongSig,
        'X-Timestamp': timestamp,
        'X-Event-Id': 'evt-004',
      },
      body,
    });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/signature/i);
  });

  it('POST /api/webhooks/:id accepts valid HMAC signature', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ event: 'push', data: { ref: 'main' } });
    const sig = makeSignature(timestamp, body, WEBHOOK_SECRET);

    mockFindFirst.mockResolvedValueOnce({
      id: TEST_WEBHOOK_REG_ID,
      hmacSecretEncrypted: encrypt(WEBHOOK_SECRET),
      isActive: true,
      requestCount: 5,
      triggerId: null,
    });

    const res = await app.request(`/api/webhooks/${TEST_WEBHOOK_REG_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': sig,
        'X-Timestamp': timestamp,
        'X-Event-Id': 'evt-005',
      },
      body,
    });
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.status).toBe('accepted');
  });

  it('POST /api/webhooks/:id triggers workflow when trigger is active', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ action: 'deploy' });
    const sig = makeSignature(timestamp, body, WEBHOOK_SECRET);

    // 1st findFirst: registration lookup
    mockFindFirst
      .mockResolvedValueOnce({
        id: TEST_WEBHOOK_REG_ID,
        hmacSecretEncrypted: encrypt(WEBHOOK_SECRET),
        isActive: true,
        requestCount: 0,
        triggerId: TEST_TRIGGER_ID,
      })
      // 2nd findFirst: trigger lookup
      .mockResolvedValueOnce({
        id: TEST_TRIGGER_ID,
        workflowId: TEST_WORKFLOW_ID,
        isActive: true,
      });

    const res = await app.request(`/api/webhooks/${TEST_WEBHOOK_REG_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': sig,
        'X-Timestamp': timestamp,
        'X-Event-Id': 'evt-trigger-001',
      },
      body,
    });
    expect(res.status).toBe(202);

    const { enqueueWorkflowExecution } = await import('../src/services/workflow-engine.js');
    expect(enqueueWorkflowExecution).toHaveBeenCalledWith(
      TEST_WORKFLOW_ID,
      TEST_TRIGGER_ID,
      expect.objectContaining({
        type: 'webhook',
        eventId: 'evt-trigger-001',
      }),
    );
  });
});

// ======================================================================
// AUTH ROUTES — Login, Register, Change Password
// ======================================================================

describe('Auth routes — login flow', () => {
  it('POST /api/auth/login rejects non-existent user', async () => {
    // findFirst returns null (user not found) — default mock is sufficient
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'no@one.com', password: 'password123' }),
    });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/invalid/i);
  });

  it('POST /api/auth/login rejects wrong password', async () => {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('correct-password', 4);

    // Single findFirst: user lookup by email
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_UUID,
      email: 'user@test.com',
      name: 'Test',
      role: 'creator_user',
      passwordHash: hash,
      workspaceId: TEST_WORKSPACE_ID,
    });

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@test.com', password: 'wrong-password' }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/auth/login succeeds with correct credentials', async () => {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('my-password', 4);

    // 1st findFirst: user lookup by email
    // 2nd findFirst: workspace lookup by user.workspaceId
    mockFindFirst
      .mockResolvedValueOnce({
        id: TEST_UUID,
        email: 'user@test.com',
        name: 'Test User',
        role: 'creator_user',
        passwordHash: hash,
        workspaceId: TEST_WORKSPACE_ID,
      })
      .mockResolvedValueOnce({
        id: TEST_WORKSPACE_ID,
        slug: 'default',
      });

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@test.com', password: 'my-password' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.token).toBeDefined();
    expect(json.user.email).toBe('user@test.com');
    expect(json.user.workspaceSlug).toBe('default');
  });

  it('POST /api/auth/register rejects duplicate email', async () => {
    // 1st findFirst: check existing email — returns existing user
    mockFindFirst.mockResolvedValueOnce({ id: 'existing-user', email: 'dup@test.com' });

    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'dup@test.com',
        password: 'ValidPass123!',
        name: 'Dup User',
      }),
    });
    expect(res.status).toBe(409);
  });

  it('POST /api/auth/register rejects non-existent workspace slug', async () => {
    // 1st findFirst: check existing email — no match
    // 2nd findFirst: workspace lookup — not found
    mockFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'new@test.com',
        password: 'ValidPass123!',
        name: 'New User',
        workspaceSlug: 'nonexistent',
      }),
    });
    expect(res.status).toBe(404);
  });

  it('POST /api/auth/register succeeds and returns token', async () => {
    // 1st findFirst: check existing email — no match
    // 2nd findFirst: workspace lookup (defaults to 'default' slug) — found
    mockFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: TEST_WORKSPACE_ID, slug: 'default' });

    mockInsertReturning.mockResolvedValueOnce([{
      id: 'new-user-id',
      email: 'fresh@test.com',
      name: 'Fresh User',
      role: 'creator_user',
      workspaceId: TEST_WORKSPACE_ID,
    }]);

    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'fresh@test.com',
        password: 'ValidPass123!',
        name: 'Fresh User',
      }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.token).toBeDefined();
    expect(json.user.email).toBe('fresh@test.com');
  });
});

describe('Auth routes — change password', () => {
  it('PUT /api/auth/change-password requires authentication', async () => {
    const res = await app.request('/api/auth/change-password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'old',
        newPassword: 'NewPass123!',
      }),
    });
    expect(res.status).toBe(401);
  });

  it('PUT /api/auth/change-password rejects wrong current password', async () => {
    const token = await getToken();
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('actual-password', 4);

    // findFirst: user lookup by userId
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_UUID,
      passwordHash: hash,
    });

    const res = await app.request('/api/auth/change-password', {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({
        currentPassword: 'wrong-password',
        newPassword: 'NewValidPass123!',
      }),
    });
    expect(res.status).toBe(401);
  });

  it('PUT /api/auth/change-password succeeds with valid inputs', async () => {
    const token = await getToken();
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('CurrentPass123!', 4);

    // findFirst: user lookup by userId
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_UUID,
      passwordHash: hash,
    });

    const res = await app.request('/api/auth/change-password', {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({
        currentPassword: 'CurrentPass123!',
        newPassword: 'BrandNewPass456!',
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toMatch(/changed/i);
  });
});

// ======================================================================
// ADMIN ROUTES — Users, Models, Quota
// ======================================================================

describe('Admin routes — user management', () => {
  it('GET /api/admin/users rejects non-admin', async () => {
    const token = await getToken('creator_user');
    const res = await app.request('/api/admin/users', { headers: authHeaders(token) });
    expect(res.status).toBe(403);
  });

  it('GET /api/admin/users returns user list for workspace_admin', async () => {
    const token = await getToken('workspace_admin');
    mockFindMany.mockResolvedValueOnce([
      { id: 'u1', email: 'admin@test.com', role: 'workspace_admin' },
      { id: 'u2', email: 'user@test.com', role: 'creator_user' },
    ]);

    const res = await app.request('/api/admin/users', { headers: authHeaders(token) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.users).toHaveLength(2);
  });

  it('POST /api/admin/users creates user in workspace', async () => {
    const token = await getToken('workspace_admin');
    // findFirst: check existing email — no match
    mockFindFirst.mockResolvedValueOnce(null);
    // insert returns the new user (with specific returning columns)
    mockInsertReturning.mockResolvedValueOnce([{
      id: 'new-admin-user',
      email: 'newguy@test.com',
      name: 'New Guy',
      role: 'creator_user',
    }]);

    const res = await app.request('/api/admin/users', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        email: 'newguy@test.com',
        password: 'ValidPass123!',
        name: 'New Guy',
        role: 'creator_user',
      }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.user.email).toBe('newguy@test.com');
  });

  it('POST /api/admin/users rejects duplicate email', async () => {
    const token = await getToken('workspace_admin');
    // findFirst: check existing email — found
    mockFindFirst.mockResolvedValueOnce({ id: 'existing', email: 'dup@test.com' });

    const res = await app.request('/api/admin/users', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        email: 'dup@test.com',
        password: 'ValidPass123!',
        name: 'Dup',
      }),
    });
    expect(res.status).toBe(409);
  });

  it('PUT /api/admin/users/:id/role updates user role', async () => {
    const token = await getToken('workspace_admin');
    // findFirst: get target user
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_UUID,
      role: 'creator_user',
      workspaceId: TEST_WORKSPACE_ID,
    });
    // update returns the updated user
    mockUpdateReturning.mockResolvedValueOnce([{
      id: TEST_UUID,
      email: 'user@test.com',
      name: 'Test',
      role: 'view_user',
    }]);

    const res = await app.request(`/api/admin/users/${TEST_UUID}/role`, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({ role: 'view_user' }),
    });
    expect(res.status).toBe(200);
  });

  it('PUT /api/admin/users/:id/role rejects changing super_admin', async () => {
    const token = await getToken('workspace_admin');
    // findFirst: target user is super_admin
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_UUID,
      role: 'super_admin',
      workspaceId: TEST_WORKSPACE_ID,
    });

    const res = await app.request(`/api/admin/users/${TEST_UUID}/role`, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({ role: 'view_user' }),
    });
    expect(res.status).toBe(403);
  });

  it('PUT /api/admin/users/:id/role rejects cross-workspace', async () => {
    const token = await getToken('workspace_admin');
    // findFirst: target user in different workspace
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_UUID,
      role: 'creator_user',
      workspaceId: 'different-workspace-id',
    });

    const res = await app.request(`/api/admin/users/${TEST_UUID}/role`, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({ role: 'view_user' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('Admin routes — model management', () => {
  it('GET /api/admin/models returns workspace models', async () => {
    const token = await getToken('workspace_admin');
    mockFindMany.mockResolvedValueOnce([
      { id: TEST_MODEL_ID, name: 'gpt-4.1', provider: 'github' },
    ]);

    const res = await app.request('/api/admin/models', { headers: authHeaders(token) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.models).toBeDefined();
  });

  it('POST /api/admin/models creates model', async () => {
    const token = await getToken('workspace_admin');
    mockInsertReturning.mockResolvedValueOnce([{
      id: TEST_MODEL_ID,
      name: 'gpt-5',
      provider: 'github',
      creditCost: '2.00',
    }]);

    const res = await app.request('/api/admin/models', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'gpt-5', creditCost: '2.00' }),
    });
    expect(res.status).toBe(201);
  });

  it('PUT /api/admin/models/:id updates model', async () => {
    const token = await getToken('workspace_admin');
    // findFirst: existing model in same workspace
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_MODEL_ID,
      name: 'gpt-4.1',
      workspaceId: TEST_WORKSPACE_ID,
    });
    mockUpdateReturning.mockResolvedValueOnce([{
      id: TEST_MODEL_ID,
      name: 'gpt-4.1-turbo',
    }]);

    const res = await app.request(`/api/admin/models/${TEST_MODEL_ID}`, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'gpt-4.1-turbo' }),
    });
    expect(res.status).toBe(200);
  });

  it('PUT /api/admin/models/:id rejects cross-workspace', async () => {
    const token = await getToken('workspace_admin');
    // findFirst: model in different workspace
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_MODEL_ID,
      workspaceId: 'other-workspace',
    });

    const res = await app.request(`/api/admin/models/${TEST_MODEL_ID}`, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'hacked' }),
    });
    expect(res.status).toBe(403);
  });

  it('DELETE /api/admin/models/:id deletes model', async () => {
    const token = await getToken('workspace_admin');
    // findFirst: model exists in same workspace
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_MODEL_ID,
      workspaceId: TEST_WORKSPACE_ID,
    });

    const res = await app.request(`/api/admin/models/${TEST_MODEL_ID}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
  });

  it('DELETE /api/admin/models/:id returns 404 when not found', async () => {
    const token = await getToken('workspace_admin');
    // findFirst: null (default) — model not found

    const res = await app.request(`/api/admin/models/${TEST_MODEL_ID}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(404);
  });
});

describe('Admin routes — quota', () => {
  it('GET /api/admin/quota returns settings', async () => {
    const token = await getToken('workspace_admin');
    // findFirst: quota settings exist
    mockFindFirst.mockResolvedValueOnce({
      workspaceId: TEST_WORKSPACE_ID,
      dailyCreditLimit: '100.00',
      monthlyCreditLimit: '3000.00',
    });

    const res = await app.request('/api/admin/quota', { headers: authHeaders(token) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.settings).toBeDefined();
    expect(json.settings.dailyCreditLimit).toBe('100.00');
  });

  it('GET /api/admin/quota returns defaults when no settings', async () => {
    const token = await getToken('workspace_admin');
    // findFirst: null (default) — no settings, route returns fallback object

    const res = await app.request('/api/admin/quota', { headers: authHeaders(token) });
    expect(res.status).toBe(200);
    const json = await res.json();
    // Route returns: settings ?? { dailyCreditLimit: null, monthlyCreditLimit: null }
    expect(json.settings).toBeDefined();
    expect(json.settings.dailyCreditLimit).toBeNull();
    expect(json.settings.monthlyCreditLimit).toBeNull();
  });
});

// ======================================================================
// AGENT FILES ROUTES
// ======================================================================

describe('Agent files routes', () => {
  it('GET /api/agent-files/:agentId returns files for agent', async () => {
    const token = await getToken();
    // findFirst: agent lookup — in same workspace
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_AGENT_ID,
      workspaceId: TEST_WORKSPACE_ID,
    });
    // findMany: list files for agent
    mockFindMany.mockResolvedValueOnce([
      { id: TEST_FILE_ID, filePath: 'agent.md', agentId: TEST_AGENT_ID },
    ]);

    const res = await app.request(`/api/agent-files/${TEST_AGENT_ID}`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.files).toHaveLength(1);
  });

  it('GET /api/agent-files/:agentId returns 404 for unknown agent', async () => {
    const token = await getToken();
    // findFirst: null (default) — agent not found

    const res = await app.request(`/api/agent-files/${TEST_AGENT_ID}`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(404);
  });

  it('GET /api/agent-files/:agentId returns 403 for cross-workspace', async () => {
    const token = await getToken();
    // findFirst: agent in different workspace
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_AGENT_ID,
      workspaceId: 'other-workspace',
    });

    const res = await app.request(`/api/agent-files/${TEST_AGENT_ID}`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(403);
  });

  it('POST /api/agent-files/:agentId creates file', async () => {
    const token = await getToken();
    // 1st findFirst: agent lookup — database source, same workspace
    mockFindFirst
      .mockResolvedValueOnce({ id: TEST_AGENT_ID, workspaceId: TEST_WORKSPACE_ID, sourceType: 'database' })
      // 2nd findFirst: check duplicate filePath — not found
      .mockResolvedValueOnce(null);
    // insert returns the new file
    mockInsertReturning.mockResolvedValueOnce([{
      id: TEST_FILE_ID,
      filePath: 'skills/analysis.md',
      content: '# Analysis',
    }]);

    const res = await app.request(`/api/agent-files/${TEST_AGENT_ID}`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        filePath: 'skills/analysis.md',
        content: '# Analysis skill',
      }),
    });
    expect(res.status).toBe(201);
  });

  it('POST /api/agent-files/:agentId rejects non-database source agent', async () => {
    const token = await getToken();
    // findFirst: agent with github_repo source
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_AGENT_ID,
      workspaceId: TEST_WORKSPACE_ID,
      sourceType: 'github_repo',
    });

    const res = await app.request(`/api/agent-files/${TEST_AGENT_ID}`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        filePath: 'agent.md',
        content: '# Agent',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/agent-files/:agentId rejects duplicate file path', async () => {
    const token = await getToken();
    // 1st findFirst: agent — database source, same workspace
    mockFindFirst
      .mockResolvedValueOnce({ id: TEST_AGENT_ID, workspaceId: TEST_WORKSPACE_ID, sourceType: 'database' })
      // 2nd findFirst: duplicate filePath — exists
      .mockResolvedValueOnce({ id: 'existing-file', filePath: 'agent.md' });

    const res = await app.request(`/api/agent-files/${TEST_AGENT_ID}`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        filePath: 'agent.md',
        content: '# Duplicate',
      }),
    });
    expect(res.status).toBe(409);
  });

  it('POST /api/agent-files/:agentId rejects view_user', async () => {
    const token = await getToken('view_user');

    const res = await app.request(`/api/agent-files/${TEST_AGENT_ID}`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        filePath: 'agent.md',
        content: '# Forbidden',
      }),
    });
    expect(res.status).toBe(403);
  });
});

// ======================================================================
// TRIGGER ROUTES — extended CRUD
// ======================================================================

describe('Trigger routes — updates and deletes', () => {
  it('PUT /api/triggers/:id updates trigger configuration', async () => {
    const token = await getToken();
    // verifyTriggerAccess: 1st findFirst = trigger, 2nd findFirst = workflow
    mockFindFirst
      .mockResolvedValueOnce({
        id: TEST_TRIGGER_ID,
        workflowId: TEST_WORKFLOW_ID,
        triggerType: 'time_schedule',
        configuration: { cron: '*/5 * * * *' },
      })
      .mockResolvedValueOnce({
        id: TEST_WORKFLOW_ID,
        workspaceId: TEST_WORKSPACE_ID,
        userId: TEST_UUID,
        scope: 'user',
      });
    mockUpdateReturning.mockResolvedValueOnce([{
      id: TEST_TRIGGER_ID,
      configuration: { cron: '*/10 * * * *' },
    }]);

    const res = await app.request(`/api/triggers/${TEST_TRIGGER_ID}`, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({ configuration: { cron: '*/10 * * * *' } }),
    });
    expect(res.status).toBe(200);
  });

  it('PUT /api/triggers/:id can deactivate trigger', async () => {
    const token = await getToken();
    // verifyTriggerAccess: 1st = trigger, 2nd = workflow
    mockFindFirst
      .mockResolvedValueOnce({
        id: TEST_TRIGGER_ID,
        workflowId: TEST_WORKFLOW_ID,
        isActive: true,
      })
      .mockResolvedValueOnce({
        id: TEST_WORKFLOW_ID,
        workspaceId: TEST_WORKSPACE_ID,
        userId: TEST_UUID,
        scope: 'user',
      });
    mockUpdateReturning.mockResolvedValueOnce([{
      id: TEST_TRIGGER_ID,
      isActive: false,
    }]);

    const res = await app.request(`/api/triggers/${TEST_TRIGGER_ID}`, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({ isActive: false }),
    });
    expect(res.status).toBe(200);
  });

  it('PUT /api/triggers/:id returns 404 for non-existent', async () => {
    const token = await getToken();
    // verifyTriggerAccess: trigger not found — returns null → 404

    const res = await app.request(`/api/triggers/${TEST_TRIGGER_ID}`, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({ isActive: false }),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/triggers/:id deletes trigger', async () => {
    const token = await getToken();
    // verifyTriggerAccess: 1st = trigger, 2nd = workflow (user-scoped, same user)
    mockFindFirst
      .mockResolvedValueOnce({
        id: TEST_TRIGGER_ID,
        workflowId: TEST_WORKFLOW_ID,
      })
      .mockResolvedValueOnce({
        id: TEST_WORKFLOW_ID,
        workspaceId: TEST_WORKSPACE_ID,
        userId: TEST_UUID,
        scope: 'user',
      });

    const res = await app.request(`/api/triggers/${TEST_TRIGGER_ID}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
  });

  it('DELETE /api/triggers/:id — non-admin cannot delete workspace-scope trigger', async () => {
    const token = await getToken('creator_user');
    // verifyTriggerAccess: 1st = trigger, 2nd = workflow
    // workflow is workspace-scoped and owned by someone else
    // verifyTriggerAccess returns the access object, then the route checks scope
    mockFindFirst
      .mockResolvedValueOnce({
        id: TEST_TRIGGER_ID,
        workflowId: TEST_WORKFLOW_ID,
      })
      .mockResolvedValueOnce({
        id: TEST_WORKFLOW_ID,
        workspaceId: TEST_WORKSPACE_ID,
        userId: 'other-user-id',
        scope: 'workspace',
      });

    const res = await app.request(`/api/triggers/${TEST_TRIGGER_ID}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(403);
  });

  it('POST /api/triggers creates trigger for own workflow', async () => {
    const token = await getToken();
    // findFirst: workflow exists in same workspace, user-scoped by same user
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_WORKFLOW_ID,
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_UUID,
      scope: 'user',
    });
    mockInsertReturning.mockResolvedValueOnce([{
      id: TEST_TRIGGER_ID,
      workflowId: TEST_WORKFLOW_ID,
      triggerType: 'time_schedule',
    }]);

    const res = await app.request('/api/triggers', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        workflowId: TEST_WORKFLOW_ID,
        triggerType: 'time_schedule',
        configuration: { cron: '* * * * *' },
      }),
    });
    expect(res.status).toBe(201);
  });
});

// ======================================================================
// EXECUTION ROUTES — extended
// ======================================================================

describe('Execution routes — extended', () => {
  it('GET /api/executions returns empty when no visible workflows', async () => {
    const token = await getToken();
    // getVisibleWorkflowIds: findMany returns empty → no visible workflows
    mockFindMany.mockResolvedValueOnce([]);

    const res = await app.request('/api/executions', { headers: authHeaders(token) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.executions).toEqual([]);
    expect(json.total).toBe(0);
  });

  it('GET /api/executions/:id returns execution with steps', async () => {
    const token = await getToken();
    // verifyExecutionAccess: 1st findFirst = execution, 2nd findFirst = workflow
    mockFindFirst
      .mockResolvedValueOnce({
        id: TEST_EXECUTION_ID,
        workflowId: TEST_WORKFLOW_ID,
        status: 'completed',
        triggerId: null,
      })
      .mockResolvedValueOnce({
        id: TEST_WORKFLOW_ID,
        workspaceId: TEST_WORKSPACE_ID,
        userId: TEST_UUID,
        scope: 'user',
      });
    // findMany: step executions
    mockFindMany.mockResolvedValueOnce([
      { id: 'step-1', stepOrder: 1, status: 'completed', output: 'Done' },
    ]);

    const res = await app.request(`/api/executions/${TEST_EXECUTION_ID}`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.execution).toBeDefined();
  });

  it('POST /api/executions/:id/retry retries failed execution', async () => {
    const token = await getToken();
    // verifyExecutionAccess: 1st findFirst = execution, 2nd findFirst = workflow
    mockFindFirst
      .mockResolvedValueOnce({
        id: TEST_EXECUTION_ID,
        workflowId: TEST_WORKFLOW_ID,
        status: 'failed',
      })
      .mockResolvedValueOnce({
        id: TEST_WORKFLOW_ID,
        workspaceId: TEST_WORKSPACE_ID,
        userId: TEST_UUID,
        scope: 'user',
      });

    const res = await app.request(`/api/executions/${TEST_EXECUTION_ID}/retry`, {
      method: 'POST',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(201);
  });
});

// ======================================================================
// VARIABLES ROUTES — extended
// ======================================================================

describe('Variable routes — extended', () => {
  it('GET /api/variables?scope=workspace returns workspace vars', async () => {
    const token = await getToken();
    // findMany: workspace variables
    mockFindMany.mockResolvedValueOnce([
      { id: 'wv1', key: 'SHARED_CONFIG', variableType: 'property' },
    ]);

    const res = await app.request('/api/variables?scope=workspace', {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.scope).toBe('workspace');
  });

  it('GET /api/variables?agentId=... returns agent vars', async () => {
    const token = await getToken();
    // findFirst: agent lookup — same workspace
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_AGENT_ID,
      workspaceId: TEST_WORKSPACE_ID,
    });
    // findMany: agent variables
    mockFindMany.mockResolvedValueOnce([
      { id: 'av1', key: 'AGENT_TOKEN', variableType: 'credential' },
    ]);

    const res = await app.request(`/api/variables?agentId=${TEST_AGENT_ID}`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.scope).toBe('agent');
  });

  it('GET /api/variables?agentId=... rejects cross-workspace agent', async () => {
    const token = await getToken();
    // findFirst: agent in different workspace
    // Route checks: if (!agent || agent.workspaceId !== user.workspaceId) → 404
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_AGENT_ID,
      workspaceId: 'different-workspace',
    });

    const res = await app.request(`/api/variables?agentId=${TEST_AGENT_ID}`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(404);
  });

  it('GET /api/variables returns 400 without scope or agentId', async () => {
    const token = await getToken();
    const res = await app.request('/api/variables', { headers: authHeaders(token) });
    expect(res.status).toBe(400);
  });

  it('POST /api/variables creates agent-scoped variable', async () => {
    const token = await getToken();
    // findFirst: agent lookup — same workspace
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_AGENT_ID,
      workspaceId: TEST_WORKSPACE_ID,
    });
    mockInsertReturning.mockResolvedValueOnce([{
      id: 'av-new',
      key: 'MY_TOKEN',
      agentId: TEST_AGENT_ID,
    }]);

    const res = await app.request('/api/variables', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        agentId: TEST_AGENT_ID,
        scope: 'agent',
        key: 'MY_TOKEN',
        value: 'secret-value',
        variableType: 'credential',
      }),
    });
    expect(res.status).toBe(201);
  });

  it('POST /api/variables creates user-scoped variable', async () => {
    const token = await getToken();
    mockInsertReturning.mockResolvedValueOnce([{
      id: 'uv-new',
      key: 'MY_KEY',
      userId: TEST_UUID,
    }]);

    const res = await app.request('/api/variables', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        scope: 'user',
        key: 'MY_KEY',
        value: 'some-value',
        variableType: 'property',
      }),
    });
    expect(res.status).toBe(201);
  });
});
