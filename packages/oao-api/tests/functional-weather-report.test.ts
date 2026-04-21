/**
 * Functional tests — "Weather Report" scenario.
 *
 * Tests the complete lifecycle:
 *   1. Register & login
 *   2. Create agent (database source)
 *   3. Create agent instruction/skill files
 *   4. Create workflow with steps & inline trigger
 *   5. Execute the workflow manually
 *   6. Verify execution, cancel, retry
 *   7. Update agent/workflow, verify versioning
 *   8. Delete resources cleanly
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import type { Hono } from 'hono';

// ─── Mock database ──────────────────────────────────────────────────
const mockFindFirst = vi.fn();
const mockFindMany = vi.fn().mockResolvedValue([]);
const mockInsertReturning = vi.fn().mockResolvedValue([{ id: 'new-id-001' }]);
const mockUpdateReturning = vi.fn().mockResolvedValue([{ id: 'updated-id' }]);
const mockDeleteReturning = vi.fn().mockResolvedValue([]);

function createSelectChain(resolveValue: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.from = vi.fn(self);
  chain.where = vi.fn(self);
  chain.orderBy = vi.fn(self);
  chain.limit = vi.fn(self);
  chain.offset = vi.fn(self);
  chain.groupBy = vi.fn(self);
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
      workflowSteps: { findFirst: mockFindFirst, findMany: mockFindMany },
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
      agentVersions: { findFirst: mockFindFirst, findMany: mockFindMany },
      workflowVersions: { findFirst: mockFindFirst, findMany: mockFindMany },
    },
    select: vi.fn().mockImplementation(() => createSelectChain([{ count: 0 }])),
    execute: vi.fn().mockResolvedValue([]),
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

const mockEnqueue = vi.fn().mockResolvedValue({
  id: 'exec-weather-001',
  status: 'pending',
  workflowId: 'wf-weather-001',
});

vi.mock('../src/services/workflow-engine.js', () => ({
  enqueueWorkflowExecution: mockEnqueue,
  retryWorkflowExecution: vi.fn().mockResolvedValue({
    id: 'exec-retry-001',
    status: 'pending',
  }),
}));

const mockEmitEvent = vi.fn().mockResolvedValue('event-id-001');

vi.mock('../src/services/system-events.js', () => ({
  emitEvent: mockEmitEvent,
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

vi.mock('../src/services/agent-instance-registry.js', () => ({
  listInstances: vi.fn().mockResolvedValue([]),
  cleanupOldInstances: vi.fn().mockResolvedValue(0),
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

let app: Hono;
let createJwt: typeof import('@oao/shared')['createJwt'];

const WS_ID = '550e8400-e29b-41d4-a716-446655440001';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const AGENT_ID = '550e8400-e29b-41d4-a716-446655440a01';
const WF_ID = '550e8400-e29b-41d4-a716-446655440b01';
const STEP1_ID = '550e8400-e29b-41d4-a716-446655440c01';
const STEP2_ID = '550e8400-e29b-41d4-a716-446655440c02';
const TRIGGER_ID = '550e8400-e29b-41d4-a716-446655440d01';
const EXEC_ID = '550e8400-e29b-41d4-a716-446655440e01';
const FILE1_ID = '550e8400-e29b-41d4-a716-446655440f01';
const FILE2_ID = '550e8400-e29b-41d4-a716-446655440f02';

// The "Weather Report" agent & workflow fixture data
const WEATHER_AGENT = {
  id: AGENT_ID,
  name: 'Weather Report Agent',
  description: 'Generates daily weather summaries for specified locations',
  sourceType: 'database',
  gitRepoUrl: null,
  gitBranch: 'main',
  agentFilePath: null,
  skillsPaths: [],
  skillsDirectory: null,
  githubToken: null,
  githubTokenCredentialId: null,
  copilotTokenCredentialId: null,
  scope: 'user',
  status: 'active',
  version: 1,
  workspaceId: WS_ID,
  userId: USER_ID,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  builtinToolsEnabled: ['simple_http_request', 'memory_store'],
  mcpJsonTemplate: null,
};

const WEATHER_FILES = [
  {
    id: FILE1_ID,
    agentId: AGENT_ID,
    filePath: 'agent.md',
    content: '# Weather Agent\nYou are a weather reporting agent. Use web search to find current weather data and generate readable reports.',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  },
  {
    id: FILE2_ID,
    agentId: AGENT_ID,
    filePath: 'skills/weather-lookup.md',
    content: '# Weather Lookup Skill\n\n## Steps\n1. Search for current weather in the specified city\n2. Extract temperature, humidity, and conditions\n3. Format as a readable summary',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  },
];

const WEATHER_WORKFLOW = {
  id: WF_ID,
  name: 'Daily Weather Report',
  description: 'Generates a weather report for major cities',
  labels: ['weather', 'daily'],
  defaultAgentId: AGENT_ID,
  defaultModel: 'gpt-5 mini',
  defaultReasoningEffort: 'low',
  workerRuntime: 'static',
  stepAllocationTimeoutSeconds: 300,
  isActive: true,
  scope: 'user',
  version: 1,
  workspaceId: WS_ID,
  userId: USER_ID,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

const WEATHER_STEPS = [
  {
    id: STEP1_ID,
    workflowId: WF_ID,
    name: 'Fetch Weather Data',
    promptTemplate: 'Search for the current weather in {{city}}. Return temperature in Celsius, humidity percentage, and general conditions.',
    stepOrder: 1,
    agentId: AGENT_ID,
    model: 'gpt-5 mini',
    reasoningEffort: null,
    workerRuntime: 'static',
    timeoutSeconds: 300,
  },
  {
    id: STEP2_ID,
    workflowId: WF_ID,
    name: 'Format Report',
    promptTemplate: 'Using the weather data from the previous step, format a professional weather report. Include:\n- City: {{city}}\n- Date: {{date}}\n- Temperature\n- Humidity\n- Conditions\n- Brief outlook',
    stepOrder: 2,
    agentId: AGENT_ID,
    model: 'gpt-5 mini',
    reasoningEffort: null,
    workerRuntime: 'static',
    timeoutSeconds: 300,
  },
];

const WEATHER_TRIGGER = {
  id: TRIGGER_ID,
  workflowId: WF_ID,
  triggerType: 'webhook',
  configuration: {
    path: '/weather-report',
    parameters: [
      { name: 'city', type: 'string', required: true },
      { name: 'date', type: 'string', required: false },
    ],
  },
  isActive: true,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

const WEATHER_EXECUTION = {
  id: EXEC_ID,
  workflowId: WF_ID,
  triggerId: TRIGGER_ID,
  status: 'running',
  inputs: { city: 'London', date: '2025-07-08' },
  output: null,
  error: null,
  workflowSnapshot: WEATHER_WORKFLOW,
  startedAt: new Date('2025-01-01T08:00:00Z'),
  completedAt: null,
  createdAt: new Date('2025-01-01'),
};

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
  mockUpdateReturning.mockReset().mockResolvedValue([{ id: 'updated-id' }]);
  mockDeleteReturning.mockReset().mockResolvedValue([]);
  mockEmitEvent.mockClear();
  mockEnqueue.mockClear();
});

// ─── Helpers ────────────────────────────────────────────────────────

async function getToken(role = 'creator_user', workspaceId = WS_ID) {
  return createJwt({
    userId: USER_ID,
    email: 'weather-tester@example.com',
    name: 'Weather Tester',
    role,
    workspaceId,
    workspaceSlug: 'default',
  });
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// ======================================================================
// PHASE 1: Create the Weather Report Agent
// ======================================================================

describe('Weather Report — Phase 1: Agent Creation', () => {
  it('creates a database-source agent for weather reporting', async () => {
    const token = await getToken();
    mockInsertReturning.mockResolvedValueOnce([WEATHER_AGENT]);

    const res = await app.request('/api/agents', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        name: 'Weather Report Agent',
        description: 'Generates daily weather summaries for specified locations',
        sourceType: 'database',
        scope: 'user',
        builtinToolsEnabled: ['simple_http_request', 'memory_store'],
      }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.agent.name).toBe('Weather Report Agent');
    expect(json.agent.sourceType).toBe('database');
  });

  it('rejects agent creation without a name', async () => {
    const token = await getToken();
    const res = await app.request('/api/agents', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ sourceType: 'database' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects github_repo source without gitRepoUrl', async () => {
    const token = await getToken();
    const res = await app.request('/api/agents', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        name: 'Bad Agent',
        sourceType: 'github_repo',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('view_user cannot create agents', async () => {
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

  it('retrieves agent by ID', async () => {
    const token = await getToken();
    mockFindFirst.mockResolvedValueOnce(WEATHER_AGENT);

    const res = await app.request(`/api/agents/${AGENT_ID}`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.agent.id).toBe(AGENT_ID);
    expect(json.agent.name).toBe('Weather Report Agent');
  });

  it('returns 404 for non-existent agent', async () => {
    const token = await getToken();
    const res = await app.request(`/api/agents/${WF_ID}`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(404);
  });
});

// ======================================================================
// PHASE 2: Create Agent Files (Instructions + Skills)
// ======================================================================

describe('Weather Report — Phase 2: Agent Files', () => {
  it('creates the main agent.md instruction file', async () => {
    const token = await getToken();
    mockFindFirst
      .mockResolvedValueOnce(WEATHER_AGENT) // agent lookup
      .mockResolvedValueOnce(null); // no duplicate file

    mockInsertReturning.mockResolvedValueOnce([WEATHER_FILES[0]]);

    const res = await app.request(`/api/agent-files/${AGENT_ID}`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        filePath: 'agent.md',
        content: WEATHER_FILES[0].content,
      }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.file.filePath).toBe('agent.md');
  });

  it('creates a skill file in a subdirectory', async () => {
    const token = await getToken();
    mockFindFirst
      .mockResolvedValueOnce(WEATHER_AGENT)
      .mockResolvedValueOnce(null);

    mockInsertReturning.mockResolvedValueOnce([WEATHER_FILES[1]]);

    const res = await app.request(`/api/agent-files/${AGENT_ID}`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        filePath: 'skills/weather-lookup.md',
        content: WEATHER_FILES[1].content,
      }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.file.filePath).toBe('skills/weather-lookup.md');
  });

  it('rejects duplicate filePath on same agent', async () => {
    const token = await getToken();
    mockFindFirst
      .mockResolvedValueOnce(WEATHER_AGENT)
      .mockResolvedValueOnce(WEATHER_FILES[0]); // duplicate exists

    const res = await app.request(`/api/agent-files/${AGENT_ID}`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ filePath: 'agent.md', content: 'dup' }),
    });
    expect(res.status).toBe(409);
  });

  it('rejects files for github_repo source agent', async () => {
    const token = await getToken();
    mockFindFirst.mockResolvedValueOnce({
      ...WEATHER_AGENT,
      sourceType: 'github_repo',
      gitRepoUrl: 'https://github.com/test/repo',
    });

    const res = await app.request(`/api/agent-files/${AGENT_ID}`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ filePath: 'agent.md', content: 'nope' }),
    });
    expect(res.status).toBe(400);
  });

  it('lists files for the weather agent', async () => {
    const token = await getToken();
    mockFindFirst.mockResolvedValueOnce(WEATHER_AGENT);
    mockFindMany.mockResolvedValueOnce(WEATHER_FILES);

    const res = await app.request(`/api/agent-files/${AGENT_ID}`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.files).toHaveLength(2);
  });

  it('updates a file content', async () => {
    const token = await getToken();
    mockFindFirst
      .mockResolvedValueOnce(WEATHER_AGENT) // agent
      .mockResolvedValueOnce(WEATHER_FILES[0]); // existing file

    mockUpdateReturning.mockResolvedValueOnce([{
      ...WEATHER_FILES[0],
      content: '# Updated Weather Agent\nEnhanced instructions.',
    }]);

    const res = await app.request(`/api/agent-files/${AGENT_ID}/${FILE1_ID}`, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({ content: '# Updated Weather Agent\nEnhanced instructions.' }),
    });
    expect(res.status).toBe(200);
  });

  it('deletes a file', async () => {
    const token = await getToken();
    mockFindFirst
      .mockResolvedValueOnce(WEATHER_AGENT)
      .mockResolvedValueOnce(WEATHER_FILES[1]);

    const res = await app.request(`/api/agent-files/${AGENT_ID}/${FILE2_ID}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });
});

// ======================================================================
// PHASE 3: Create Workflow with Steps and Trigger
// ======================================================================

describe('Weather Report — Phase 3: Workflow Creation', () => {
  it('creates a workflow with 2 steps and a webhook trigger', async () => {
    const token = await getToken();

    // Mock sequence: #1 agents.findFirst (defaultAgentId), #2 triggers.findFirst (webhook path uniqueness → no conflict)
    mockFindFirst
      .mockResolvedValueOnce(WEATHER_AGENT)   // defaultAgentId check
      .mockResolvedValueOnce(null);            // webhook path uniqueness (no conflict)
    mockInsertReturning
      .mockResolvedValueOnce([WEATHER_WORKFLOW]) // workflow insert
      .mockResolvedValueOnce(WEATHER_STEPS)      // steps insert
      .mockResolvedValueOnce([WEATHER_TRIGGER])  // trigger insert
      .mockResolvedValueOnce([{ id: 'ver-001' }]); // version snapshot

    const res = await app.request('/api/workflows', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        name: 'Daily Weather Report',
        description: 'Generates a weather report for major cities',
        labels: ['weather', 'daily'],
        defaultAgentId: AGENT_ID,
        defaultModel: 'gpt-5 mini',
        defaultReasoningEffort: 'low',
        workerRuntime: 'static',
        steps: [
          {
            name: 'Fetch Weather Data',
            promptTemplate: 'Search for the current weather in {{city}}. Return temperature in Celsius, humidity percentage, and general conditions.',
            stepOrder: 1,
            agentId: AGENT_ID,
            model: 'gpt-5 mini',
            timeoutSeconds: 300,
          },
          {
            name: 'Format Report',
            promptTemplate: 'Using the weather data from the previous step, format a professional weather report.',
            stepOrder: 2,
            model: 'gpt-5 mini',
            timeoutSeconds: 300,
          },
        ],
        triggers: [
          {
            triggerType: 'webhook',
            configuration: {
              path: '/weather-report',
              parameters: [
                { name: 'city', type: 'string', required: true },
                { name: 'date', type: 'string', required: false },
              ],
            },
          },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.workflow.name).toBe('Daily Weather Report');
  });

  it('rejects workflow without steps', async () => {
    const token = await getToken();
    const res = await app.request('/api/workflows', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        name: 'Empty Workflow',
        steps: [],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects workflow with step missing name', async () => {
    const token = await getToken();
    const res = await app.request('/api/workflows', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        name: 'Bad Step Workflow',
        steps: [{ promptTemplate: 'Do something', stepOrder: 1 }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('retrieves workflow detail with steps and triggers', async () => {
    const token = await getToken();
    // Mock: #1 workflow, #2 owner user (parallel), #3 last execution (parallel)
    mockFindFirst
      .mockResolvedValueOnce(WEATHER_WORKFLOW)
      .mockResolvedValueOnce({ name: 'Test', email: 'test@example.com' }) // owner
      .mockResolvedValueOnce(null); // no last execution
    mockFindMany
      .mockResolvedValueOnce(WEATHER_STEPS) // steps
      .mockResolvedValueOnce([WEATHER_TRIGGER]); // triggers

    const res = await app.request(`/api/workflows/${WF_ID}`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.workflow.name).toBe('Daily Weather Report');
    expect(json.steps).toHaveLength(2);
    expect(json.triggers).toHaveLength(1);
    expect(json.triggers[0].triggerType).toBe('webhook');
  });

  it('view_user cannot create workflows', async () => {
    const token = await getToken('view_user');
    const res = await app.request('/api/workflows', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        name: 'Forbidden',
        steps: [{ name: 'S1', promptTemplate: 'Do', stepOrder: 1 }],
      }),
    });
    expect(res.status).toBe(403);
  });

  it('lists workflows with pagination', async () => {
    const token = await getToken();
    // findMany(workflows) + select count (parallel), then findFirst per workflow
    mockFindMany.mockResolvedValueOnce([WEATHER_WORKFLOW]);
    // findFirst for lastExec → null, findFirst for owner
    mockFindFirst
      .mockResolvedValueOnce(null) // lastExec
      .mockResolvedValueOnce({ name: 'Test User' }); // owner

    const res = await app.request('/api/workflows?page=1&limit=10', {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.workflows).toBeDefined();
  });

  it('GET /api/workflows/labels returns labels', async () => {
    const token = await getToken();
    // The labels endpoint uses db.execute(sql)
    mockDb.execute.mockResolvedValueOnce([{ label: 'weather' }, { label: 'daily' }]);

    const res = await app.request('/api/workflows/labels', {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.labels).toBeDefined();
  });
});

// ======================================================================
// PHASE 4: Execute the Workflow
// ======================================================================

describe('Weather Report — Phase 4: Execution', () => {
  it('manually runs the workflow via POST /:id/run', async () => {
    const token = await getToken();
    // Mock: #1 workflow findFirst, #2 trigger findFirst
    mockFindFirst
      .mockResolvedValueOnce(WEATHER_WORKFLOW)
      .mockResolvedValueOnce(WEATHER_TRIGGER); // active webhook trigger

    const res = await app.request(`/api/workflows/${WF_ID}/run`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        inputs: { city: 'London', date: '2025-07-08' },
      }),
    });
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.status).toBe('accepted');
  });

  it('rejects manual run on inactive workflow', async () => {
    const token = await getToken();
    mockFindFirst.mockResolvedValueOnce({ ...WEATHER_WORKFLOW, isActive: false });

    const res = await app.request(`/api/workflows/${WF_ID}/run`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ inputs: {} }),
    });
    expect(res.status).toBe(400);
  });

  it('lists executions for the workflow', async () => {
    const token = await getToken();
    // getVisibleWorkflowIds: findMany(workflows)
    mockFindMany.mockResolvedValueOnce([{ id: WF_ID }]);
    // Then two select() chains run in parallel (executions + count)

    const res = await app.request(`/api/executions?workflowId=${WF_ID}`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.executions).toBeDefined();
  });

  it('retrieves execution detail with steps', async () => {
    const token = await getToken();
    // verifyExecutionAccess: #1 execution findFirst, #2 workflow findFirst
    // then: #3 trigger findFirst (triggerId exists)
    mockFindFirst
      .mockResolvedValueOnce(WEATHER_EXECUTION)   // execution
      .mockResolvedValueOnce(WEATHER_WORKFLOW)     // workflow
      .mockResolvedValueOnce(WEATHER_TRIGGER);     // trigger
    mockFindMany.mockResolvedValueOnce([
      {
        id: 'se-001',
        executionId: EXEC_ID,
        stepId: STEP1_ID,
        status: 'completed',
        output: 'London: 22°C, 65% humidity, partly cloudy',
        startedAt: new Date(),
        completedAt: new Date(),
      },
      {
        id: 'se-002',
        executionId: EXEC_ID,
        stepId: STEP2_ID,
        status: 'running',
        output: null,
        startedAt: new Date(),
        completedAt: null,
      },
    ]);

    const res = await app.request(`/api/executions/${EXEC_ID}`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.execution.id).toBe(EXEC_ID);
    expect(json.steps).toHaveLength(2);
    expect(json.steps[0].status).toBe('completed');
    expect(json.steps[1].status).toBe('running');
  });

  it('cancels a running execution', async () => {
    const token = await getToken();
    // verifyExecutionAccess: #1 execution, #2 workflow
    mockFindFirst
      .mockResolvedValueOnce({ ...WEATHER_EXECUTION, status: 'running' })
      .mockResolvedValueOnce(WEATHER_WORKFLOW);
    mockUpdateReturning.mockResolvedValueOnce([{
      ...WEATHER_EXECUTION,
      status: 'cancelled',
    }]);

    const res = await app.request(`/api/executions/${EXEC_ID}/cancel`, {
      method: 'POST',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.execution.status).toBe('cancelled');
  });

  it('cannot cancel a completed execution', async () => {
    const token = await getToken();
    mockFindFirst
      .mockResolvedValueOnce({ ...WEATHER_EXECUTION, status: 'completed' })
      .mockResolvedValueOnce(WEATHER_WORKFLOW);

    const res = await app.request(`/api/executions/${EXEC_ID}/cancel`, {
      method: 'POST',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(400);
  });

  it('retries a failed execution', async () => {
    const token = await getToken();
    mockFindFirst
      .mockResolvedValueOnce({ ...WEATHER_EXECUTION, status: 'failed' })
      .mockResolvedValueOnce(WEATHER_WORKFLOW);

    const res = await app.request(`/api/executions/${EXEC_ID}/retry`, {
      method: 'POST',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.execution.status).toBe('pending');
  });

  it('cannot retry a running execution', async () => {
    const token = await getToken();
    mockFindFirst
      .mockResolvedValueOnce({ ...WEATHER_EXECUTION, status: 'running' })
      .mockResolvedValueOnce(WEATHER_WORKFLOW);

    const res = await app.request(`/api/executions/${EXEC_ID}/retry`, {
      method: 'POST',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(400);
  });

  it('lists active executions', async () => {
    const token = await getToken();
    // GET /active: findFirst(workflows) then select().from() chain
    mockFindFirst.mockResolvedValueOnce(WEATHER_WORKFLOW);

    const res = await app.request(`/api/executions/active?workflowId=${WF_ID}`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.executions).toBeDefined();
  });

  it('filters executions by status', async () => {
    const token = await getToken();
    // getVisibleWorkflowIds: findMany(workflows)
    mockFindMany.mockResolvedValueOnce([{ id: WF_ID }]);
    // Override select to return empty for rows, then {count:0} for count
    let callIdx = 0;
    mockDb.select.mockImplementation(() => {
      callIdx++;
      return callIdx === 1 ? createSelectChain([]) : createSelectChain([{ count: 0 }]);
    });

    const res = await app.request('/api/executions?status=completed', {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.executions).toHaveLength(0);
  });
});

// ======================================================================
// PHASE 5: Update & Version Control
// ======================================================================

describe('Weather Report — Phase 5: Updates & Versioning', () => {
  it('updates agent description (bumps version)', async () => {
    const token = await getToken();
    mockFindFirst.mockResolvedValueOnce(WEATHER_AGENT);
    mockUpdateReturning.mockResolvedValueOnce([{
      ...WEATHER_AGENT,
      description: 'Enhanced weather reporting with forecasts',
      version: 2,
    }]);
    mockInsertReturning.mockResolvedValueOnce([{ id: 'aver-001' }]); // version snapshot

    const res = await app.request(`/api/agents/${AGENT_ID}`, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({
        description: 'Enhanced weather reporting with forecasts',
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.agent.description).toBe('Enhanced weather reporting with forecasts');
  });

  it('updates agent status to paused', async () => {
    const token = await getToken();
    mockFindFirst.mockResolvedValueOnce(WEATHER_AGENT);
    mockUpdateReturning.mockResolvedValueOnce([{
      ...WEATHER_AGENT,
      status: 'paused',
    }]);

    const res = await app.request(`/api/agents/${AGENT_ID}`, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({ status: 'paused' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.agent.status).toBe('paused');
  });

  it('updates workflow name', async () => {
    const token = await getToken();
    mockFindFirst.mockResolvedValueOnce(WEATHER_WORKFLOW);
    mockUpdateReturning.mockResolvedValueOnce([{
      ...WEATHER_WORKFLOW,
      name: 'Hourly Weather Report',
      version: 2,
    }]);

    const res = await app.request(`/api/workflows/${WF_ID}`, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'Hourly Weather Report' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.workflow.name).toBe('Hourly Weather Report');
  });

  it('updates workflow steps (replace all)', async () => {
    const token = await getToken();
    mockFindFirst.mockResolvedValueOnce(WEATHER_WORKFLOW);
    // deleteReturning for old steps, then insertReturning for new
    mockInsertReturning.mockResolvedValueOnce([
      { ...WEATHER_STEPS[0], name: 'Get Weather' },
      WEATHER_STEPS[1],
      { id: 'step-3', name: 'Email Summary', stepOrder: 3 },
    ]);

    const res = await app.request(`/api/workflows/${WF_ID}/steps`, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({
        steps: [
          { name: 'Get Weather', promptTemplate: 'Fetch weather for {{city}}', stepOrder: 1, model: 'gpt-5 mini' },
          { name: 'Format Report', promptTemplate: 'Format the weather data.', stepOrder: 2, model: 'gpt-5 mini' },
          { name: 'Email Summary', promptTemplate: 'Send weather summary email.', stepOrder: 3, model: 'gpt-5 mini' },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.steps).toHaveLength(3);
  });

  it('deactivates the workflow', async () => {
    const token = await getToken();
    mockFindFirst.mockResolvedValueOnce(WEATHER_WORKFLOW);
    mockUpdateReturning.mockResolvedValueOnce([{
      ...WEATHER_WORKFLOW,
      isActive: false,
    }]);

    const res = await app.request(`/api/workflows/${WF_ID}`, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({ isActive: false }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.workflow.isActive).toBe(false);
  });
});

// ======================================================================
// PHASE 6: Trigger Management
// ======================================================================

describe('Weather Report — Phase 6: Trigger CRUD', () => {
  it('creates a time_schedule trigger', async () => {
    const token = await getToken();
    // POST /triggers: findFirst(workflows)
    mockFindFirst.mockResolvedValueOnce(WEATHER_WORKFLOW);
    mockInsertReturning.mockResolvedValueOnce([{
      id: 'trig-sched-001',
      workflowId: WF_ID,
      triggerType: 'time_schedule',
      configuration: { cron: '0 8 * * *' },
      isActive: true,
    }]);

    const res = await app.request('/api/triggers', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        workflowId: WF_ID,
        triggerType: 'time_schedule',
        configuration: { cron: '0 8 * * *' },
      }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.trigger.triggerType).toBe('time_schedule');
  });

  it('lists triggers for a workflow', async () => {
    const token = await getToken();
    // GET /triggers?workflowId=: findFirst(workflows), then findMany(triggers)
    mockFindFirst.mockResolvedValueOnce(WEATHER_WORKFLOW);
    mockFindMany.mockResolvedValueOnce([WEATHER_TRIGGER]);

    const res = await app.request(`/api/triggers?workflowId=${WF_ID}`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.triggers).toHaveLength(1);
  });

  it('updates trigger configuration', async () => {
    const token = await getToken();
    // verifyTriggerAccess: findFirst(triggers), findFirst(workflows)
    mockFindFirst
      .mockResolvedValueOnce(WEATHER_TRIGGER)  // trigger
      .mockResolvedValueOnce(WEATHER_WORKFLOW); // workflow
    mockUpdateReturning.mockResolvedValueOnce([{
      ...WEATHER_TRIGGER,
      configuration: { path: '/weather-v2' },
    }]);

    const res = await app.request(`/api/triggers/${TRIGGER_ID}`, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({
        configuration: { path: '/weather-v2' },
      }),
    });
    expect(res.status).toBe(200);
  });

  it('deletes a trigger', async () => {
    const token = await getToken();
    // verifyTriggerAccess: findFirst(triggers), findFirst(workflows)
    mockFindFirst
      .mockResolvedValueOnce(WEATHER_TRIGGER)
      .mockResolvedValueOnce(WEATHER_WORKFLOW);

    const res = await app.request(`/api/triggers/${TRIGGER_ID}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
  });

  it('rejects invalid triggerType', async () => {
    const token = await getToken();
    const res = await app.request('/api/triggers', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        workflowId: WF_ID,
        triggerType: 'invalid_type',
        configuration: {},
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ======================================================================
// PHASE 7: Cleanup — Delete Resources
// ======================================================================

describe('Weather Report — Phase 7: Cleanup', () => {
  it('deletes the workflow', async () => {
    const token = await getToken();
    mockFindFirst.mockResolvedValueOnce(WEATHER_WORKFLOW);

    const res = await app.request(`/api/workflows/${WF_ID}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('deletes the agent', async () => {
    const token = await getToken();
    mockFindFirst.mockResolvedValueOnce(WEATHER_AGENT);

    const res = await app.request(`/api/agents/${AGENT_ID}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('view_user cannot delete agents', async () => {
    const token = await getToken('view_user');
    mockFindFirst.mockResolvedValueOnce(WEATHER_AGENT);
    const res = await app.request(`/api/agents/${AGENT_ID}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(403);
  });

  it('view_user can delete their own user-scoped workflow (no role check)', async () => {
    const token = await getToken('view_user');
    mockFindFirst.mockResolvedValueOnce(WEATHER_WORKFLOW);
    const res = await app.request(`/api/workflows/${WF_ID}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    // Workflow delete only checks scope ownership, not view_user role
    expect(res.status).toBe(200);
  });
});

// ======================================================================
// PHASE 8: Edge Cases & Validation
// ======================================================================

describe('Weather Report — Phase 8: Edge Cases', () => {
  it('rejects workflow step with stepOrder < 1', async () => {
    const token = await getToken();
    const res = await app.request('/api/workflows', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        name: 'Bad Order Workflow',
        steps: [{ name: 'Step', promptTemplate: 'Do', stepOrder: 0 }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects workflow with too many steps (>20)', async () => {
    const token = await getToken();
    const steps = Array.from({ length: 21 }, (_, i) => ({
      name: `Step ${i + 1}`,
      promptTemplate: 'Do stuff',
      stepOrder: i + 1,
    }));
    const res = await app.request('/api/workflows', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'Too Many Steps', steps }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects agent name exceeding 100 chars', async () => {
    const token = await getToken();
    const res = await app.request('/api/agents', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        name: 'A'.repeat(101),
        sourceType: 'database',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects execution detail for non-existent ID', async () => {
    const token = await getToken();
    const res = await app.request(`/api/executions/${EXEC_ID}`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(404);
  });

  it('pagination defaults are applied', async () => {
    const token = await getToken();
    // findMany(agents) + select count in parallel
    mockFindMany.mockResolvedValueOnce([]);

    const res = await app.request('/api/agents', {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.page).toBe(1);
    expect(json.limit).toBeGreaterThanOrEqual(1);
  });

  it('agent list limit is silently capped at 100', async () => {
    const token = await getToken();
    mockFindMany.mockResolvedValueOnce([]);

    const res = await app.request('/api/agents?limit=300', {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.limit).toBeLessThanOrEqual(100);
  });

  it('model specified as "gpt-5 mini" in workflow creation is accepted', async () => {
    const token = await getToken();
    mockInsertReturning
      .mockResolvedValueOnce([{ ...WEATHER_WORKFLOW, defaultModel: 'gpt-5 mini' }])
      .mockResolvedValueOnce(WEATHER_STEPS)
      .mockResolvedValueOnce([{ id: 'ver-001' }]);

    const res = await app.request('/api/workflows', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        name: 'Model Test Workflow',
        defaultModel: 'gpt-5 mini',
        steps: [
          { name: 'S1', promptTemplate: 'Test', stepOrder: 1, model: 'gpt-5 mini' },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.workflow.defaultModel).toBe('gpt-5 mini');
  });
});
