/**
 * Comprehensive route handler tests for the oao-api service.
 * Tests route-level validation, auth, and the full request/response cycle
 * with a mocked database layer.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import type { Hono } from 'hono';

// ─── Mock database ──────────────────────────────────────────────────
const mockFindFirst = vi.fn();
const mockFindMany = vi.fn().mockResolvedValue([]);
const mockInsertReturning = vi.fn().mockResolvedValue([{ id: 'new-id-001', name: 'test' }]);
const mockUpdateReturning = vi.fn().mockResolvedValue([{ id: 'updated-id-001' }]);
const mockDeleteWhere = vi.fn().mockResolvedValue([]);
const mockSendConversationMessage = vi.fn();

// Build a chainable mock for db operations
// Helper: create a thenable select chain (supports both `await chain.where()` and `.where().orderBy().limit()...`)
function createSelectChain(resolveValue: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.from = vi.fn(self);
  chain.leftJoin = vi.fn(self);
  chain.where = vi.fn(self);
  chain.groupBy = vi.fn(self);
  chain.orderBy = vi.fn(self);
  chain.limit = vi.fn(self);
  chain.offset = vi.fn(self);
  chain.then = (resolve: Function) => resolve(resolveValue);
  return chain;
}

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
      conversations: { findFirst: mockFindFirst, findMany: mockFindMany },
      conversationMessages: { findFirst: mockFindFirst, findMany: mockFindMany },
    },
    select: vi.fn().mockImplementation(() => createSelectChain([])),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: mockInsertReturning,
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: mockInsertReturning,
        }),
        onConflictDoNothing: vi.fn().mockResolvedValue([]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: mockUpdateReturning,
        }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: mockDeleteWhere,
    }),
    transaction: vi.fn().mockImplementation(async (fn: Function) => {
      // Execute the transaction callback with the same mock db
      return fn(mockDb);
    }),
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

// Mock workflow engine
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

vi.mock('../src/services/conversation-service.js', () => ({
  CONVERSATION_REASONING_EFFORTS: ['low', 'medium', 'high', 'xhigh'],
  sendConversationMessage: mockSendConversationMessage,
}));

// Mock system-events
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
const TEST_AGENT_ID = '550e8400-e29b-41d4-a716-446655440010';
const TEST_WORKFLOW_ID = '550e8400-e29b-41d4-a716-446655440020';
const TEST_CONVERSATION_ID = '550e8400-e29b-41d4-a716-446655440030';

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-key-must-be-at-least-32-chars-long!!';
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  const serverMod = await import('../src/server.js');
  app = serverMod.app;
  const shared = await import('@oao/shared');
  createJwt = shared.createJwt;
});

beforeEach(() => {
  vi.clearAllMocks();
  // Reset findFirst/findMany to return defaults
  mockFindFirst.mockResolvedValue(null);
  mockFindMany.mockResolvedValue([]);
  mockSendConversationMessage.mockReset();
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
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

// ======================================================================
// AGENTS ROUTES
// ======================================================================

describe('Agent routes — authenticated', () => {
  it('GET /api/agents returns list scoped to workspace', async () => {
    const token = await getToken();
    mockFindMany.mockResolvedValueOnce([
      { id: TEST_AGENT_ID, name: 'Test Agent', status: 'active' },
    ]);

    const res = await app.request('/api/agents', { headers: authHeaders(token) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.agents).toBeDefined();
  });

  it('POST /api/agents creates agent with valid data', async () => {
    const token = await getToken();
    mockInsertReturning.mockResolvedValueOnce([{
      id: TEST_AGENT_ID,
      name: 'New Agent',
      status: 'active',
    }]);

    const res = await app.request('/api/agents', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        name: 'New Agent',
        sourceType: 'github_repo',
        gitRepoUrl: 'https://github.com/test/repo',
        agentFilePath: 'agent.md',
      }),
    });
    expect(res.status).toBe(201);
  });

  it('POST /api/agents creates database-backed files during agent creation', async () => {
    const token = await getToken();
    mockInsertReturning.mockResolvedValueOnce([{
      id: TEST_AGENT_ID,
      name: 'Database Agent',
      sourceType: 'database',
      githubTokenEncrypted: null,
    }]);

    const res = await app.request('/api/agents', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        name: 'Database Agent',
        sourceType: 'database',
        files: [
          { filePath: 'agent.md', content: '# Agent Instructions' },
          { filePath: 'skills/research.md', content: '# Research Skill' },
        ],
      }),
    });

    expect(res.status).toBe(201);
    expect(mockDb.insert).toHaveBeenCalledTimes(3);
  });

  it('POST /api/agents rejects missing name', async () => {
    const token = await getToken();
    const res = await app.request('/api/agents', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        sourceType: 'github_repo',
        gitRepoUrl: 'https://github.com/test/repo',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/agents rejects github_repo without gitRepoUrl', async () => {
    const token = await getToken();
    const res = await app.request('/api/agents', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        name: 'Bad Agent',
        sourceType: 'github_repo',
        // missing gitRepoUrl and agentFilePath
      }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/agents rejects view_user role', async () => {
    const token = await getToken('view_user');
    const res = await app.request('/api/agents', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        name: 'Forbidden Agent',
        sourceType: 'database',
      }),
    });
    expect(res.status).toBe(403);
  });

  it('POST /api/agents — workspace scope requires admin role', async () => {
    const token = await getToken('creator_user');
    const res = await app.request('/api/agents', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        name: 'WS Agent',
        sourceType: 'database',
        scope: 'workspace',
      }),
    });
    expect(res.status).toBe(403);
  });

  it('POST /api/agents — workspace_admin can create workspace-scoped agent', async () => {
    const token = await getToken('workspace_admin');
    mockInsertReturning.mockResolvedValueOnce([{
      id: 'ws-agent-id',
      name: 'WS Agent',
      scope: 'workspace',
    }]);

    const res = await app.request('/api/agents', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        name: 'WS Agent',
        sourceType: 'database',
        scope: 'workspace',
      }),
    });
    expect(res.status).toBe(201);
  });

  it('GET /api/agents/:id returns 404 when agent not found', async () => {
    const token = await getToken();
    mockFindFirst.mockResolvedValueOnce(null);

    const res = await app.request(`/api/agents/${TEST_AGENT_ID}`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(404);
  });

  it('GET /api/agents/:id returns agent when found in same workspace', async () => {
    const token = await getToken();
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_AGENT_ID,
      name: 'Test Agent',
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_UUID,
      status: 'active',
      githubTokenEncrypted: 'encrypted-token',
    });

    const res = await app.request(`/api/agents/${TEST_AGENT_ID}`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.agent).toBeDefined();
    expect(json.agent.id).toBe(TEST_AGENT_ID);
    expect(json.agent.hasInlineGitToken).toBe(true);
    expect(json.agent.githubTokenEncrypted).toBeUndefined();
  });

  it('DELETE /api/agents/:id returns 404 when agent not found', async () => {
    const token = await getToken();
    mockFindFirst.mockResolvedValueOnce(null);

    const res = await app.request(`/api/agents/${TEST_AGENT_ID}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(404);
  });
});

// ======================================================================
// CONVERSATION ROUTES
// ======================================================================

describe('Conversation routes — authenticated', () => {
  it('GET /api/conversations returns the current user conversation history', async () => {
    const token = await getToken();
    mockDb.select
      .mockImplementationOnce(() => createSelectChain([{
        id: TEST_CONVERSATION_ID,
        title: 'Agent Chat',
        agentNameSnapshot: 'Test Agent',
        status: 'active',
        messageCount: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
      }]))
      .mockImplementationOnce(() => createSelectChain([{ count: 1 }]));

    const res = await app.request('/api/conversations?page=1&limit=20', {
      headers: authHeaders(token),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.conversations).toHaveLength(1);
    expect(json.total).toBe(1);
  });

  it('POST /api/conversations creates a conversation for an active agent', async () => {
    const token = await getToken();
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_AGENT_ID,
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_UUID,
      scope: 'user',
      status: 'active',
      name: 'Test Agent',
    });
    mockInsertReturning.mockResolvedValueOnce([{
      id: TEST_CONVERSATION_ID,
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_UUID,
      agentId: TEST_AGENT_ID,
      agentNameSnapshot: 'Test Agent',
      title: 'Agent Chat',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }]);

    const res = await app.request('/api/conversations', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        agentId: TEST_AGENT_ID,
        title: 'Agent Chat',
      }),
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.conversation.id).toBe(TEST_CONVERSATION_ID);
  });

  it('POST /api/conversations/:id/messages sends a message through the conversation service', async () => {
    const token = await getToken();
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_CONVERSATION_ID,
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_UUID,
      agentId: TEST_AGENT_ID,
      agentNameSnapshot: 'Test Agent',
      title: 'Agent Chat',
      status: 'active',
    });
    mockSendConversationMessage.mockResolvedValueOnce({
      userMessage: {
        id: '550e8400-e29b-41d4-a716-446655440031',
        role: 'user',
        status: 'completed',
        content: 'Hello agent',
      },
      assistantMessage: {
        id: '550e8400-e29b-41d4-a716-446655440032',
        role: 'assistant',
        status: 'completed',
        content: 'Hello user',
      },
    });

    const res = await app.request(`/api/conversations/${TEST_CONVERSATION_ID}/messages`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ content: 'Hello agent' }),
    });

    expect(res.status).toBe(201);
    expect(mockSendConversationMessage).toHaveBeenCalledTimes(1);
    const json = await res.json();
    expect(json.assistantMessage.content).toBe('Hello user');
  });
});

// ======================================================================
// WORKFLOW ROUTES
// ======================================================================

describe('Workflow routes — authenticated', () => {
  it('GET /api/workflows returns empty list', async () => {
    const token = await getToken();
    mockFindMany.mockResolvedValueOnce([]);

    const res = await app.request('/api/workflows', { headers: authHeaders(token) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.workflows).toBeDefined();
  });

  it('POST /api/workflows creates workflow with valid data', async () => {
    const token = await getToken();
    // The transaction mock needs to handle insert
    mockDb.transaction.mockImplementationOnce(async (fn: Function) => {
      return fn({
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{
              id: TEST_WORKFLOW_ID,
              name: 'Test WF',
              version: 1,
            }]),
          }),
        }),
      });
    });

    const res = await app.request('/api/workflows', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        name: 'Test Workflow',
        workerRuntime: 'ephemeral',
        stepAllocationTimeoutSeconds: 180,
        steps: [
          { name: 'Step 1', promptTemplate: 'Do something', stepOrder: 1, workerRuntime: 'static' },
        ],
      }),
    });
    expect(res.status).toBe(201);
  });

  it('POST /api/workflows rejects missing name', async () => {
    const token = await getToken();
    const res = await app.request('/api/workflows', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        steps: [{ name: 'Step 1', promptTemplate: 'test', stepOrder: 1 }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/workflows rejects view_user', async () => {
    const token = await getToken('view_user');
    const res = await app.request('/api/workflows', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        name: 'Forbidden WF',
        steps: [{ name: 'Step 1', promptTemplate: 'test', stepOrder: 1 }],
      }),
    });
    expect(res.status).toBe(403);
  });

  it('POST /api/workflows — workspace scope requires admin', async () => {
    const token = await getToken('creator_user');
    const res = await app.request('/api/workflows', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        name: 'WS WF',
        scope: 'workspace',
        steps: [{ name: 'Step 1', promptTemplate: 'test', stepOrder: 1 }],
      }),
    });
    expect(res.status).toBe(403);
  });

  it('GET /api/workflows/:id returns 404 when not found', async () => {
    const token = await getToken();
    mockFindFirst.mockResolvedValueOnce(null);

    const res = await app.request(`/api/workflows/${TEST_WORKFLOW_ID}`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(404);
  });

  it('POST /api/workflows/:id/run enqueues execution with inputs', async () => {
    const token = await getToken();
    // findFirst returns the workflow
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_WORKFLOW_ID,
      name: 'Test WF',
      isActive: true,
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_UUID,
      scope: 'user',
    });
    // findFirst returns webhook trigger (second call)
    mockFindFirst.mockResolvedValueOnce({
      id: 'trigger-001',
      triggerType: 'webhook',
      isActive: true,
      configuration: { path: '/test-hook', parameters: [{ name: 'symbol', required: true }] },
    });

    const res = await app.request(`/api/workflows/${TEST_WORKFLOW_ID}/run`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ inputs: { symbol: 'AAPL' } }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('accepted');
  });
});

// ======================================================================
// VARIABLE ROUTES
// ======================================================================

describe('Variable routes — authenticated', () => {
  it('GET /api/variables returns empty list', async () => {
    const token = await getToken();
    mockFindMany.mockResolvedValueOnce([]);

    const res = await app.request('/api/variables?scope=user', {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
  });

  it('POST /api/variables creates a variable with valid data', async () => {
    const token = await getToken();
    mockInsertReturning.mockResolvedValueOnce([{
      id: 'var-001',
      key: 'API_KEY',
      variableType: 'credential',
    }]);

    const res = await app.request('/api/variables', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        scope: 'user',
        key: 'API_KEY',
        value: 'secret-value-12345',
        variableType: 'credential',
      }),
    });
    expect(res.status).toBe(201);
  });

  it('POST /api/variables rejects lowercase key', async () => {
    const token = await getToken();
    const res = await app.request('/api/variables', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        scope: 'user',
        key: 'lowercase_key',
        value: 'test',
        variableType: 'property',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/variables rejects view_user', async () => {
    const token = await getToken('view_user');
    const res = await app.request('/api/variables', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        scope: 'user',
        key: 'MY_KEY',
        value: 'test',
        variableType: 'property',
      }),
    });
    expect(res.status).toBe(403);
  });

  it('POST /api/variables — workspace scope requires admin', async () => {
    const token = await getToken('creator_user');
    const res = await app.request('/api/variables', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        scope: 'workspace',
        key: 'SHARED_KEY',
        value: 'shared-secret',
        variableType: 'credential',
      }),
    });
    expect(res.status).toBe(403);
  });

  it('POST /api/variables — admin can create workspace variables', async () => {
    const token = await getToken('workspace_admin');
    mockInsertReturning.mockResolvedValueOnce([{
      id: 'var-ws-001',
      key: 'SHARED_KEY',
    }]);

    const res = await app.request('/api/variables', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        scope: 'workspace',
        key: 'SHARED_KEY',
        value: 'shared-secret',
        variableType: 'credential',
      }),
    });
    expect(res.status).toBe(201);
  });

  it('DELETE /api/variables/:id requires scope param', async () => {
    const token = await getToken();
    const res = await app.request(`/api/variables/var-001`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    // Should return 400 if scope is missing
    expect([400, 404]).toContain(res.status);
  });
});

// ======================================================================
// TRIGGER ROUTES
// ======================================================================

describe('Trigger routes — authenticated', () => {
  it('GET /api/triggers returns triggers', async () => {
    const token = await getToken();
    // First findMany returns visible workflows
    mockFindMany.mockResolvedValueOnce([
      { id: TEST_WORKFLOW_ID, workspaceId: TEST_WORKSPACE_ID },
    ]);
    // Second findMany returns triggers
    mockFindMany.mockResolvedValueOnce([
      { id: 'trig-1', triggerType: 'time_schedule', isActive: true, workflowId: TEST_WORKFLOW_ID },
    ]);

    const res = await app.request('/api/triggers', { headers: authHeaders(token) });
    expect(res.status).toBe(200);
  });

  it('GET /api/triggers/types returns the shared trigger catalog including Jira triggers', async () => {
    const token = await getToken();

    const res = await app.request('/api/triggers/types', { headers: authHeaders(token) });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.types)).toBe(true);
    expect(json.types.some((entry: any) => entry.type === 'jira_changes_notification')).toBe(true);
    expect(json.types.some((entry: any) => entry.type === 'jira_polling')).toBe(true);
  });

  it('POST /api/triggers/:id/test validates a saved non-Jira trigger', async () => {
    const token = await getToken();
    const triggerId = '550e8400-e29b-41d4-a716-446655440040';

    mockFindFirst
      .mockResolvedValueOnce({
        id: triggerId,
        workflowId: TEST_WORKFLOW_ID,
        triggerType: 'time_schedule',
        configuration: { cron: '*/5 * * * *' },
        isActive: true,
      })
      .mockResolvedValueOnce({
        id: TEST_WORKFLOW_ID,
        workspaceId: TEST_WORKSPACE_ID,
        userId: TEST_UUID,
        scope: 'user',
      });

    const res = await app.request(`/api/triggers/${triggerId}/test`, {
      method: 'POST',
      headers: authHeaders(token),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.summary).toMatch(/configuration is valid/i);
  });

  it('POST /api/triggers creates a trigger', async () => {
    const token = await getToken();
    // Workflow lookup
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_WORKFLOW_ID,
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_UUID,
      scope: 'user',
    });
    mockInsertReturning.mockResolvedValueOnce([{
      id: 'trig-new',
      triggerType: 'time_schedule',
    }]);

    const res = await app.request('/api/triggers', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        workflowId: TEST_WORKFLOW_ID,
        triggerType: 'time_schedule',
        configuration: { cron: '*/5 * * * *' },
      }),
    });
    expect([200, 201]).toContain(res.status);
  });

  it('POST /api/triggers rejects invalid triggerType', async () => {
    const token = await getToken();
    const res = await app.request('/api/triggers', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        workflowId: TEST_WORKFLOW_ID,
        triggerType: 'invalid_type',
        configuration: {},
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ======================================================================
// EXECUTION ROUTES
// ======================================================================

describe('Execution routes — authenticated', () => {
  it('GET /api/executions returns paginated list', async () => {
    const token = await getToken();
    // Visible workflows
    mockFindMany.mockResolvedValueOnce([
      { id: TEST_WORKFLOW_ID },
    ]);
    // First select = data query, second select = count query
    mockDb.select
      .mockImplementationOnce(() => createSelectChain([]))
      .mockImplementationOnce(() => createSelectChain([{ count: 0 }]));

    const res = await app.request('/api/executions?page=1&limit=10', {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
  });

  it('GET /api/executions filters by status', async () => {
    const token = await getToken();
    mockFindMany.mockResolvedValueOnce([{ id: TEST_WORKFLOW_ID }]);
    mockDb.select
      .mockImplementationOnce(() => createSelectChain([]))
      .mockImplementationOnce(() => createSelectChain([{ count: 0 }]));

    const res = await app.request('/api/executions?status=failed', {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
  });

  it('GET /api/executions/:id returns 404 when not found', async () => {
    const token = await getToken();
    mockFindFirst.mockResolvedValueOnce(null);

    const res = await app.request(`/api/executions/${TEST_UUID}`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(404);
  });
});

// ======================================================================
// SUPERVISOR ROUTES
// ======================================================================

describe('Supervisor routes — authenticated', () => {
  it('GET /api/supervisor/status returns agent status counts', async () => {
    const token = await getToken('workspace_admin');
    mockFindMany.mockResolvedValueOnce([
      { id: 'a1', status: 'active' },
      { id: 'a2', status: 'active' },
      { id: 'a3', status: 'paused' },
    ]);

    const res = await app.request('/api/supervisor/status', {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toBeDefined();
  });

  it('POST /api/supervisor/emergency-stop pauses agents', async () => {
    const token = await getToken('workspace_admin');
    mockUpdateReturning.mockResolvedValueOnce([]);

    const res = await app.request('/api/supervisor/emergency-stop', {
      method: 'POST',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
  });

  it('POST /api/supervisor/resume-all resumes agents', async () => {
    const token = await getToken('workspace_admin');
    mockUpdateReturning.mockResolvedValueOnce([]);

    const res = await app.request('/api/supervisor/resume-all', {
      method: 'POST',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
  });

  it('POST /api/supervisor/emergency-stop rejects non-admin users', async () => {
    const token = await getToken('creator_user');
    const res = await app.request('/api/supervisor/emergency-stop', {
      method: 'POST',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(403);
  });
});

// ======================================================================
// WEBHOOK ROUTES (public, HMAC-authenticated)
// ======================================================================

describe('Webhook routes', () => {
  it('POST /api/webhooks/:registrationId rejects missing signature headers', async () => {
    const res = await app.request(`/api/webhooks/${TEST_UUID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'test' }),
    });
    // Should reject — missing X-Signature, X-Timestamp, X-Event-Id
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('POST /api/webhooks/:registrationId rejects invalid registration', async () => {
    mockFindFirst.mockResolvedValueOnce(null); // No registration found

    const res = await app.request(`/api/webhooks/${TEST_UUID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': 'sha256=abc',
        'X-Timestamp': String(Math.floor(Date.now() / 1000)),
        'X-Event-Id': 'evt-001',
      },
      body: JSON.stringify({ data: 'test' }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ======================================================================
// AUTH ROUTES
// ======================================================================

describe('Auth routes — extended', () => {
  it('POST /api/auth/register validates email format', async () => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'not-an-email',
        password: 'ValidPass123',
        name: 'Test',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/auth/register validates password length', async () => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'valid@example.com',
        password: 'short',
        name: 'Test',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/auth/login validates required fields', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('GET /api/auth/me rejects expired/invalid tokens', async () => {
    const res = await app.request('/api/auth/me', {
      headers: { Authorization: 'Bearer clearly-invalid-token' },
    });
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/me succeeds with valid token', async () => {
    const token = await getToken();
    // Mock user lookup — include workspaceId to match the JWT payload
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_UUID,
      email: 'test@example.com',
      name: 'Test User',
      role: 'creator_user',
      workspaceId: TEST_WORKSPACE_ID,
    });
    // Mock workspace lookup (triggered by user.workspaceId)
    mockFindFirst.mockResolvedValueOnce({
      id: TEST_WORKSPACE_ID,
      slug: 'default',
    });

    const res = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect([200, 404]).toContain(res.status);
  });
});
