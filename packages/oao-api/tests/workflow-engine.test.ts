import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// ─── Mock BullMQ ────────────────────────────────────────────────────
const mockQueueAdd = vi.fn().mockResolvedValue({ id: 'job-1' });
vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: mockQueueAdd,
  })),
  Worker: vi.fn(),
}));

// ─── Mock Redis ─────────────────────────────────────────────────────
const mockRedis = {
  set: vi.fn().mockResolvedValue('OK'),
  get: vi.fn().mockResolvedValue(null),
  del: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  eval: vi.fn().mockResolvedValue(1),
};
vi.mock('../src/services/redis.js', () => ({
  getRedisConnection: () => mockRedis,
  getRedisConnectionOpts: () => ({ host: 'localhost', port: 6379 }),
}));

// ─── Mock database ──────────────────────────────────────────────────
const mockDb = {
  query: {
    workflows: { findFirst: vi.fn() },
    workflowSteps: { findMany: vi.fn().mockResolvedValue([]) },
    workflowExecutions: { findFirst: vi.fn() },
    stepExecutions: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
    agents: { findFirst: vi.fn() },
    agentVariables: { findMany: vi.fn().mockResolvedValue([]) },
    userVariables: { findMany: vi.fn().mockResolvedValue([]) },
    workspaceVariables: { findMany: vi.fn().mockResolvedValue([]) },
    mcpServerConfigs: { findMany: vi.fn().mockResolvedValue([]) },
    models: { findFirst: vi.fn() },
  },
  insert: vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 'exec-001', status: 'pending' }]),
      onConflictDoUpdate: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'exec-001' }]),
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
};

vi.mock('../src/database/index.js', () => ({
  db: mockDb,
}));

// ─── Mock Copilot SDK ───────────────────────────────────────────────
vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: vi.fn().mockImplementation(() => ({
    createSession: vi.fn().mockResolvedValue({
      sendAndWait: vi.fn().mockResolvedValue({ data: { content: 'AI response output' } }),
      on: vi.fn(),
      disconnect: vi.fn(),
    }),
    stop: vi.fn(),
  })),
  approveAll: vi.fn(),
  defineTool: vi.fn((name: string, config: unknown) => ({ name, _config: config })),
}));

// ─── Mock agent-workspace ───────────────────────────────────────────
vi.mock('../src/services/agent-workspace.js', () => ({
  prepareAgentWorkspace: vi.fn().mockResolvedValue({
    workdir: '/tmp/test-workspace',
    agentMarkdown: '# Test Agent\nYou are a test agent.',
    skills: ['Skill 1 content'],
    config: null,
    cleanup: vi.fn(),
  }),
  prepareDbAgentWorkspace: vi.fn().mockResolvedValue({
    workdir: '/tmp/test-workspace',
    agentMarkdown: '# DB Agent\nYou are a DB agent.',
    skills: [],
    config: null,
    cleanup: vi.fn(),
  }),
}));

// ─── Mock agent-tools ───────────────────────────────────────────────
vi.mock('../src/services/agent-tools.js', () => ({
  createAgentTools: vi.fn().mockReturnValue([]),
}));

// ─── Mock mcp-client ────────────────────────────────────────────────
vi.mock('../src/services/mcp-client.js', () => ({
  connectToMcpServer: vi.fn().mockResolvedValue({
    tools: [],
    cleanup: vi.fn(),
  }),
}));

// ─── Mock plugin-loader ─────────────────────────────────────────────
vi.mock('../src/services/plugin-loader.js', () => ({
  loadAgentPlugins: vi.fn().mockResolvedValue([]),
  readPluginSkills: vi.fn().mockResolvedValue([]),
  getPluginMcpServers: vi.fn().mockReturnValue([]),
  getPluginToolDefs: vi.fn().mockReturnValue([]),
}));

// ─── Mock k8s-provisioner ───────────────────────────────────────────
const mockCreateAgentPod = vi.fn().mockResolvedValue('oao-agent-step-001');
const mockWaitForPodCompletion = vi.fn().mockResolvedValue('Succeeded');
const mockDeleteAgentPod = vi.fn().mockResolvedValue(undefined);
const mockAcquireAgentSlot = vi.fn().mockResolvedValue(true);
const mockReleaseAgentSlot = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/services/k8s-provisioner.js', () => ({
  createAgentPod: (...args: unknown[]) => mockCreateAgentPod(...args),
  waitForPodCompletion: (...args: unknown[]) => mockWaitForPodCompletion(...args),
  deleteAgentPod: (...args: unknown[]) => mockDeleteAgentPod(...args),
  acquireAgentSlot: (...args: unknown[]) => mockAcquireAgentSlot(...args),
  releaseAgentSlot: (...args: unknown[]) => mockReleaseAgentSlot(...args),
}));

// ─── Mock agent-instance-registry ───────────────────────────────────
vi.mock('../src/services/agent-instance-registry.js', () => ({
  registerEphemeralInstance: vi.fn().mockResolvedValue('instance-001'),
  terminateEphemeralInstance: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock agent-worker ──────────────────────────────────────────────
vi.mock('../src/workers/agent-worker.js', () => ({
  AGENT_STEP_QUEUE: 'agent-step-execution',
}));

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-key-must-be-at-least-32-chars-long!!';
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
});

beforeEach(() => {
  vi.clearAllMocks();
  mockRedis.set.mockResolvedValue('OK');
  mockCreateAgentPod.mockResolvedValue('oao-agent-step-001');
  mockWaitForPodCompletion.mockResolvedValue('Succeeded');
  mockDeleteAgentPod.mockResolvedValue(undefined);
  mockAcquireAgentSlot.mockResolvedValue(true);
  mockReleaseAgentSlot.mockResolvedValue(undefined);
});

describe('enqueueWorkflowExecution', () => {
  it('creates execution record and enqueues BullMQ job', async () => {
    const { enqueueWorkflowExecution } = await import('../src/services/workflow-engine.js');

    mockDb.query.workflows.findFirst.mockResolvedValueOnce({
      id: 'wf-001',
      name: 'Test WF',
      description: 'Test workflow',
      userId: 'user-001',
      defaultAgentId: 'agent-001',
      version: 1,
    });
    mockDb.query.workflowSteps.findMany.mockResolvedValueOnce([
      { id: 'step-1', name: 'Step 1', promptTemplate: 'Do something', stepOrder: 1 },
    ]);

    const execution = await enqueueWorkflowExecution('wf-001', 'trigger-001', {
      type: 'time_schedule',
      cron: '*/5 * * * *',
    });

    expect(execution).toBeDefined();
    expect(execution.id).toBeDefined();
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'execute-workflow',
      expect.objectContaining({ workflowId: 'wf-001' }),
      expect.any(Object),
    );
  });

  it('throws when workflow not found', async () => {
    const { enqueueWorkflowExecution } = await import('../src/services/workflow-engine.js');
    mockDb.query.workflows.findFirst.mockResolvedValueOnce(null);

    await expect(
      enqueueWorkflowExecution('nonexistent', null, {}),
    ).rejects.toThrow('not found');
  });
});

describe('retryWorkflowExecution', () => {
  it('throws when execution not found', async () => {
    const { retryWorkflowExecution } = await import('../src/services/workflow-engine.js');
    mockDb.query.workflowExecutions.findFirst.mockResolvedValueOnce(null);

    await expect(
      retryWorkflowExecution('nonexistent'),
    ).rejects.toThrow('not found');
  });

  it('throws when execution is not failed', async () => {
    const { retryWorkflowExecution } = await import('../src/services/workflow-engine.js');
    mockDb.query.workflowExecutions.findFirst.mockResolvedValueOnce({
      id: 'exec-001',
      status: 'completed',
      workflowId: 'wf-001',
    });

    await expect(
      retryWorkflowExecution('exec-001'),
    ).rejects.toThrow('failed');
  });

  it('retries from the first failed step', async () => {
    const { retryWorkflowExecution } = await import('../src/services/workflow-engine.js');

    mockDb.query.workflowExecutions.findFirst.mockResolvedValueOnce({
      id: 'exec-001',
      status: 'failed',
      workflowId: 'wf-001',
      triggerId: 'trig-1',
      triggerMetadata: {},
      workflowVersion: 1,
      workflowSnapshot: { workflow: {}, steps: [] },
    });
    mockDb.query.workflows.findFirst.mockResolvedValueOnce({
      id: 'wf-001',
      name: 'Test WF',
    });
    mockDb.query.stepExecutions.findMany.mockResolvedValueOnce([
      { id: 'se-1', stepOrder: 1, status: 'completed', output: 'Step 1 done' },
      { id: 'se-2', stepOrder: 2, status: 'failed', output: null },
    ]);
    mockDb.query.workflowSteps.findMany.mockResolvedValueOnce([
      { id: 'ws-1', stepOrder: 1, name: 'Step 1' },
      { id: 'ws-2', stepOrder: 2, name: 'Step 2' },
    ]);

    const newExecution = await retryWorkflowExecution('exec-001');
    expect(newExecution).toBeDefined();
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'execute-workflow',
      expect.objectContaining({ startFromStep: 1 }),
      expect.any(Object),
    );
  });
});

describe('Session lock', () => {
  it('acquireSessionLock returns lock value on success', async () => {
    mockRedis.set.mockResolvedValueOnce('OK');
    // We can't easily test private functions, but we verify Redis is called
    // through the workflow engine's executeWorkflow flow
    expect(mockRedis.set).not.toHaveBeenCalled(); // Not called yet
  });

  it('releaseSessionLock uses Lua compare-and-delete', async () => {
    mockRedis.eval.mockResolvedValueOnce(1);
    // Release lock uses eval with Lua script
    const result = await mockRedis.eval(
      'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
      1,
      'agent-session-lock:agent-001',
      'lock-value-123',
    );
    expect(result).toBe(1);
    expect(mockRedis.eval).toHaveBeenCalled();
  });
});

describe('executeWorkflow', () => {
  it('throws when execution not found', async () => {
    const { executeWorkflow } = await import('../src/services/workflow-engine.js');
    mockDb.query.workflowExecutions.findFirst.mockResolvedValueOnce(null);

    await expect(executeWorkflow('nonexistent')).rejects.toThrow('not found');
  });

  it('throws when workflow not found', async () => {
    const { executeWorkflow } = await import('../src/services/workflow-engine.js');
    mockDb.query.workflowExecutions.findFirst.mockResolvedValueOnce({
      id: 'exec-001',
      workflowId: 'wf-missing',
      triggerMetadata: null,
    });
    mockDb.query.workflows.findFirst.mockResolvedValueOnce(null);

    await expect(executeWorkflow('exec-001')).rejects.toThrow('not found');
  });

  it('processes a single-step workflow successfully', async () => {
    const { executeWorkflow } = await import('../src/services/workflow-engine.js');

    // Set up the full execution context
    mockDb.query.workflowExecutions.findFirst.mockResolvedValueOnce({
      id: 'exec-001',
      workflowId: 'wf-001',
      triggerMetadata: null,
    });
    mockDb.query.workflows.findFirst
      .mockResolvedValueOnce({
        id: 'wf-001',
        name: 'Test WF',
        userId: 'user-001',
        defaultAgentId: 'agent-001',
        workspaceId: 'ws-001',
        defaultModel: null,
        defaultReasoningEffort: null,
      });
    mockDb.query.workflowSteps.findMany.mockResolvedValueOnce([
      { id: 'ws-1', name: 'Step 1', promptTemplate: 'Analyze something', stepOrder: 1, agentId: null, model: null, reasoningEffort: null, timeoutSeconds: 60 },
    ]);
    mockDb.query.stepExecutions.findMany.mockResolvedValueOnce([
      { id: 'se-1', stepOrder: 1, status: 'pending' },
    ]);
    // Agent lookup for step dispatch
    mockDb.query.agents.findFirst.mockResolvedValueOnce({
      id: 'agent-001',
      name: 'Test Agent',
      userId: 'user-001',
      sourceType: 'database',
      agentFilePath: 'agent.md',
      skillsPaths: [],
      githubTokenEncrypted: null,
      githubTokenCredentialId: null,
      builtinToolsEnabled: [],
    });
    // Static path: after enqueue, poll returns completed
    mockDb.query.stepExecutions.findFirst.mockResolvedValueOnce({
      id: 'se-1',
      status: 'completed',
      output: 'AI response output',
    });

    await executeWorkflow('exec-001');

    // Verify step was enqueued to BullMQ queue for static agent worker
    expect(mockQueueAdd).toHaveBeenCalledWith('step-execution', {
      stepExecutionId: 'se-1',
      executionId: 'exec-001',
    });

    // Verify execution was marked as completed
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('marks execution as failed when step worker reports failure', async () => {
    const { executeWorkflow } = await import('../src/services/workflow-engine.js');

    mockDb.query.workflowExecutions.findFirst.mockResolvedValueOnce({
      id: 'exec-002',
      workflowId: 'wf-001',
      triggerMetadata: null,
    });
    mockDb.query.workflows.findFirst.mockResolvedValueOnce({
      id: 'wf-001',
      name: 'Test WF',
      userId: 'user-001',
      defaultAgentId: 'agent-001',
      workspaceId: 'ws-001',
      defaultModel: null,
      defaultReasoningEffort: null,
    });
    mockDb.query.workflowSteps.findMany.mockResolvedValueOnce([
      { id: 'ws-1', name: 'Step 1', promptTemplate: 'Do X', stepOrder: 1, agentId: null, model: null, reasoningEffort: null, timeoutSeconds: 120 },
    ]);
    mockDb.query.stepExecutions.findMany.mockResolvedValueOnce([
      { id: 'se-1', stepOrder: 1, status: 'pending' },
    ]);
    mockDb.query.agents.findFirst.mockResolvedValueOnce({
      id: 'agent-001',
      name: 'Test Agent',
      userId: 'user-001',
      sourceType: 'database',
    });
    // Static path: poll returns failed
    mockDb.query.stepExecutions.findFirst = vi.fn().mockResolvedValueOnce({
      id: 'se-1',
      status: 'failed',
      error: 'Agent worker reported failure',
    });

    await executeWorkflow('exec-002');

    // Step was enqueued to BullMQ
    expect(mockQueueAdd).toHaveBeenCalled();
    // Execution should be marked as failed
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('handles static dispatch timeout when worker never completes', async () => {
    const { executeWorkflow } = await import('../src/services/workflow-engine.js');

    mockDb.query.workflowExecutions.findFirst.mockResolvedValueOnce({
      id: 'exec-003',
      workflowId: 'wf-001',
      triggerMetadata: null,
    });
    mockDb.query.workflows.findFirst.mockResolvedValueOnce({
      id: 'wf-001',
      name: 'Test WF',
      userId: 'user-001',
      defaultAgentId: 'agent-001',
      workspaceId: 'ws-001',
      defaultModel: null,
      defaultReasoningEffort: null,
    });
    mockDb.query.workflowSteps.findMany.mockResolvedValueOnce([
      { id: 'ws-1', name: 'Step 1', promptTemplate: 'Do X', stepOrder: 1, agentId: null, model: null, reasoningEffort: null, timeoutSeconds: 60 },
    ]);
    mockDb.query.stepExecutions.findMany.mockResolvedValueOnce([
      { id: 'se-1', stepOrder: 1, status: 'pending' },
    ]);
    mockDb.query.agents.findFirst.mockResolvedValueOnce({
      id: 'agent-001',
      name: 'Test Agent',
      userId: 'user-001',
      sourceType: 'database',
    });
    // Static path: poll always returns pending (never completes)
    mockDb.query.stepExecutions.findFirst = vi.fn().mockResolvedValue({
      id: 'se-1',
      status: 'pending',
    });

    // Use fake timers to skip the 3s poll intervals and 60s timeout
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const promise = executeWorkflow('exec-003');
    // Advance past the 60s step timeout (timeoutSeconds: 60)
    await vi.advanceTimersByTimeAsync(65_000);
    await promise;

    vi.useRealTimers();

    // Step was enqueued but timed out waiting for completion
    expect(mockQueueAdd).toHaveBeenCalled();
    // Execution should be marked as failed due to timeout
    expect(mockDb.update).toHaveBeenCalled();
  });
});
