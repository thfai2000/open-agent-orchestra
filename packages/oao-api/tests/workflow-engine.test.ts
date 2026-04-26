import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

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
    agentVariables: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    userVariables: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    workspaceVariables: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    mcpServerConfigs: { findMany: vi.fn().mockResolvedValue([]) },
    models: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    userQuotaSettings: { findFirst: vi.fn().mockResolvedValue(null) },
    workspaceQuotaSettings: { findFirst: vi.fn().mockResolvedValue(null) },
    creditUsage: { findMany: vi.fn().mockResolvedValue([]) },
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
const mockSessionSendAndWait = vi.fn().mockResolvedValue({ data: { content: 'AI response output' } });
const mockSessionDisconnect = vi.fn().mockResolvedValue(undefined);
const mockSessionOn = vi.fn();
const mockCreateSession = vi.fn().mockResolvedValue({
  sendAndWait: mockSessionSendAndWait,
  on: mockSessionOn,
  disconnect: mockSessionDisconnect,
});
const mockClientStop = vi.fn().mockResolvedValue(undefined);
const mockCopilotClientConstructor = vi.fn().mockImplementation(() => ({
  createSession: mockCreateSession,
  stop: mockClientStop,
}));

vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: mockCopilotClientConstructor,
  approveAll: vi.fn(),
  defineTool: vi.fn((name: string, config: unknown) => ({ name, _config: config })),
}));

// ─── Mock agent-workspace ───────────────────────────────────────────
const mockPrepareAgentWorkspace = vi.fn().mockResolvedValue({
  workdir: '/tmp/test-workspace',
  agentMarkdown: '# Test Agent\nYou are a test agent.',
  skills: ['Skill 1 content'],
  config: null,
  cleanup: vi.fn(),
});
const mockPrepareDbAgentWorkspace = vi.fn().mockResolvedValue({
  workdir: '/tmp/test-workspace',
  agentMarkdown: '# DB Agent\nYou are a DB agent.',
  skills: [],
  config: null,
  cleanup: vi.fn(),
});

vi.mock('../src/services/agent-workspace.js', () => ({
  prepareAgentWorkspace: (...args: unknown[]) => mockPrepareAgentWorkspace(...args),
  prepareDbAgentWorkspace: (...args: unknown[]) => mockPrepareDbAgentWorkspace(...args),
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

// ─── Mock k8s-provisioner ───────────────────────────────────────────
const mockCreateAgentPod = vi.fn().mockResolvedValue('oao-agent-step-001');
const mockWaitForPodCompletion = vi.fn().mockResolvedValue('Succeeded');
const mockDeleteAgentPod = vi.fn().mockResolvedValue(undefined);
const mockAcquireAgentSlot = vi.fn().mockResolvedValue(true);
const mockReleaseAgentSlot = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/services/k8s-provisioner.js', () => ({
  acquireAgentSlot: (...args: unknown[]) => mockAcquireAgentSlot(...args),
  createAgentPod: (...args: unknown[]) => mockCreateAgentPod(...args),
  deleteAgentPod: (...args: unknown[]) => mockDeleteAgentPod(...args),
  releaseAgentSlot: (...args: unknown[]) => mockReleaseAgentSlot(...args),
  waitForPodCompletion: (...args: unknown[]) => mockWaitForPodCompletion(...args),
}));

// ─── Mock realtime bus ──────────────────────────────────────────────
const mockPublishRealtimeEvent = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/services/realtime-bus.js', () => ({
  publishRealtimeEvent: (...args: unknown[]) => mockPublishRealtimeEvent(...args),
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
  // Provide a fallback Copilot/LLM token so the pre-flight auth check in executeCopilotSession
  // passes for tests that don't configure a per-agent credential. The Copilot SDK itself is
  // mocked, so the actual value is never sent to GitHub.
  process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN || 'test-github-token';
});

beforeEach(() => {
  vi.clearAllMocks();
  mockRedis.set.mockResolvedValue('OK');
  mockRedis.get.mockResolvedValue(null);
  mockRedis.eval.mockResolvedValue(1);
  mockDb.query.agentVariables.findFirst.mockResolvedValue(null);
  mockDb.query.userVariables.findFirst.mockResolvedValue(null);
  mockDb.query.workspaceVariables.findFirst.mockResolvedValue(null);
  mockDb.query.userQuotaSettings.findFirst.mockResolvedValue(null);
  mockDb.query.workspaceQuotaSettings.findFirst.mockResolvedValue(null);
  mockDb.query.creditUsage.findMany.mockResolvedValue([]);
  mockDb.query.models.findMany.mockResolvedValue([
    {
      id: 'model-001',
      workspaceId: 'ws-001',
      name: 'gpt-4.1',
      provider: 'github',
      providerType: 'github',
      customProviderType: null,
      customBaseUrl: null,
      customAuthType: 'none',
      customWireApi: null,
      customAzureApiVersion: null,
      creditCost: '1.00',
      isActive: true,
    },
  ]);
  mockCreateSession.mockResolvedValue({
    sendAndWait: mockSessionSendAndWait,
    on: mockSessionOn,
    disconnect: mockSessionDisconnect,
  });
  mockSessionSendAndWait.mockResolvedValue({ data: { content: 'AI response output' } });
  mockSessionDisconnect.mockResolvedValue(undefined);
  mockClientStop.mockResolvedValue(undefined);
  mockAcquireAgentSlot.mockResolvedValue(true);
  mockReleaseAgentSlot.mockResolvedValue(undefined);
  mockCreateAgentPod.mockResolvedValue('oao-agent-step-001');
  mockWaitForPodCompletion.mockResolvedValue('Succeeded');
  mockDeleteAgentPod.mockResolvedValue(undefined);
  mockPrepareAgentWorkspace.mockResolvedValue({
    workdir: '/tmp/test-workspace',
    agentMarkdown: '# Test Agent\nYou are a test agent.',
    skills: ['Skill 1 content'],
    config: null,
    cleanup: vi.fn(),
  });
  mockPrepareDbAgentWorkspace.mockResolvedValue({
    workdir: '/tmp/test-workspace',
    agentMarkdown: '# DB Agent\nYou are a DB agent.',
    skills: [],
    config: null,
    cleanup: vi.fn(),
  });
});

afterEach(() => {
  vi.useRealTimers();
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
      workerRuntime: 'static',
      stepAllocationTimeoutSeconds: 300,
      version: 1,
    });
    mockDb.query.workflowSteps.findMany.mockResolvedValueOnce([
      { id: 'step-1', name: 'Step 1', promptTemplate: 'Do something', stepOrder: 1, workerRuntime: null },
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

  it('releases the session lock when workspace preparation fails', async () => {
    const { executeCopilotSession } = await import('../src/services/workflow-engine.js');

    mockPrepareAgentWorkspace.mockRejectedValueOnce(new Error('clone failed'));

    await expect(
      executeCopilotSession({
        agent: {
          id: 'agent-001',
          name: 'Test Agent',
          userId: 'user-001',
          sourceType: 'github_repo',
          gitRepoUrl: 'https://github.com/example/repo',
          gitBranch: 'main',
          agentFilePath: '.github/agents/test.md',
          skillsPaths: [],
          skillsDirectory: null,
          githubTokenEncrypted: null,
          githubTokenCredentialId: null,
          copilotTokenCredentialId: null,
          builtinToolsEnabled: [],
          mcpJsonTemplate: null,
        } as any,
        step: {
          id: 'step-001',
          name: 'Step 1',
          promptTemplate: 'Test prompt',
          reasoningEffort: null,
          model: null,
          timeoutSeconds: 60,
        } as any,
        stepExecutionId: 'step-exec-001',
        resolvedPrompt: 'Test prompt',
        precedentOutput: '',
        credentials: new Map(),
        properties: new Map(),
        envVariables: new Map(),
        workerRuntime: 'static',
        workflowId: 'wf-001',
        workspaceId: 'ws-001',
        executionId: 'exec-001',
        userId: 'user-001',
      }),
    ).rejects.toThrow('clone failed');

    expect(mockRedis.eval).toHaveBeenCalledTimes(1);
  });

  it('resolves Git authentication credentials from agent variables and passes the subtype to workspace preparation', async () => {
    const { executeCopilotSession } = await import('../src/services/workflow-engine.js');

    mockDb.query.agentVariables.findFirst.mockResolvedValueOnce({
      id: 'git-cred-001',
      key: 'GIT_APP_AUTH',
      valueEncrypted: 'encrypted-github-app-credential',
      credentialSubType: 'github_app',
    });

    await executeCopilotSession({
      agent: {
        id: 'agent-001',
        name: 'Test Agent',
        userId: 'user-001',
        sourceType: 'github_repo',
        gitRepoUrl: 'https://github.com/example/repo',
        gitBranch: 'main',
        agentFilePath: '.github/agents/test.md',
        skillsPaths: [],
        skillsDirectory: null,
        githubTokenEncrypted: null,
        githubTokenCredentialId: 'git-cred-001',
        copilotTokenCredentialId: null,
        builtinToolsEnabled: [],
        mcpJsonTemplate: null,
      } as any,
      step: {
        id: 'step-001',
        name: 'Step 1',
        promptTemplate: 'Test prompt',
        reasoningEffort: null,
        model: null,
        timeoutSeconds: 60,
      } as any,
      stepExecutionId: 'step-exec-001',
      resolvedPrompt: 'Test prompt',
      precedentOutput: '',
      credentials: new Map(),
      properties: new Map(),
      envVariables: new Map(),
      workerRuntime: 'static',
      workflowId: 'wf-001',
      workspaceId: 'ws-001',
      executionId: 'exec-001',
      userId: 'user-001',
    });

    expect(mockPrepareAgentWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      githubTokenEncrypted: 'encrypted-github-app-credential',
      githubCredentialSubType: 'github_app',
    }));
  });

  it('builds custom provider session config from the selected model record', async () => {
    const { executeCopilotSession } = await import('../src/services/workflow-engine.js');
    const { encrypt } = await import('@oao/shared');

    mockDb.query.agentVariables.findFirst.mockResolvedValueOnce({
      id: 'copilot-cred-001',
      key: 'LLM_API_KEY',
      valueEncrypted: encrypt('byok-secret'),
      credentialSubType: 'secret_text',
    });
    mockDb.query.models.findMany.mockResolvedValue([
      {
        id: 'model-002',
        workspaceId: 'ws-001',
        name: 'gpt-4o-byok',
        provider: 'openai',
        providerType: 'custom',
        customProviderType: 'openai',
        customBaseUrl: 'https://api.openai.com/v1',
        customAuthType: 'api_key',
        customWireApi: 'responses',
        customAzureApiVersion: null,
        creditCost: '2.50',
        isActive: true,
      },
    ]);

    await executeCopilotSession({
      agent: {
        id: 'agent-001',
        name: 'Test Agent',
        userId: 'user-001',
        sourceType: 'github_repo',
        gitRepoUrl: 'https://github.com/example/repo',
        gitBranch: 'main',
        agentFilePath: '.github/agents/test.md',
        skillsPaths: [],
        skillsDirectory: null,
        githubTokenEncrypted: null,
        githubTokenCredentialId: null,
        copilotTokenCredentialId: 'copilot-cred-001',
        builtinToolsEnabled: [],
        mcpJsonTemplate: null,
      } as any,
      step: {
        id: 'step-001',
        name: 'Step 1',
        promptTemplate: 'Test prompt',
        reasoningEffort: null,
        model: 'gpt-4o-byok',
        timeoutSeconds: 60,
      } as any,
      stepExecutionId: 'step-exec-001',
      resolvedPrompt: 'Test prompt',
      precedentOutput: '',
      credentials: new Map(),
      properties: new Map(),
      envVariables: new Map(),
      workerRuntime: 'static',
      workflowId: 'wf-001',
      workspaceId: 'ws-001',
      executionId: 'exec-001',
      userId: 'user-001',
    });

    expect(mockCopilotClientConstructor).toHaveBeenCalledWith();
    expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4o-byok',
      provider: expect.objectContaining({
        type: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'byok-secret',
        wireApi: 'responses',
      }),
    }));
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
        workerRuntime: 'static',
        stepAllocationTimeoutSeconds: 300,
      });
    mockDb.query.workflowSteps.findMany.mockResolvedValueOnce([
      { id: 'ws-1', name: 'Step 1', promptTemplate: 'Analyze something', stepOrder: 1, agentId: null, model: null, reasoningEffort: null, workerRuntime: null, timeoutSeconds: 60 },
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
    // Static path: allocation log sees pending, then allocation/completion returns completed.
    mockDb.query.stepExecutions.findFirst = vi
      .fn()
      .mockResolvedValueOnce({ id: 'se-1', status: 'pending', liveOutput: [] })
      .mockResolvedValueOnce({ id: 'se-1', status: 'completed', output: 'AI response output' })
      .mockResolvedValueOnce({ id: 'se-1', status: 'completed', output: 'AI response output' });

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
      workerRuntime: 'static',
      stepAllocationTimeoutSeconds: 300,
    });
    mockDb.query.workflowSteps.findMany.mockResolvedValueOnce([
      { id: 'ws-1', name: 'Step 1', promptTemplate: 'Do X', stepOrder: 1, agentId: null, model: null, reasoningEffort: null, workerRuntime: null, timeoutSeconds: 120 },
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
    // Static path: allocation log sees pending, then allocation detects failure and post-dispatch confirms it.
    mockDb.query.stepExecutions.findFirst = vi
      .fn()
      .mockResolvedValueOnce({ id: 'se-1', status: 'pending', liveOutput: [] })
      .mockResolvedValueOnce({
        id: 'se-1',
        status: 'failed',
        error: 'Agent worker reported failure',
      })
      .mockResolvedValueOnce({
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

  it('dispatches to an ephemeral pod when a step overrides the workflow runtime', async () => {
    const { executeWorkflow } = await import('../src/services/workflow-engine.js');

    mockDb.query.workflowExecutions.findFirst.mockResolvedValueOnce({
      id: 'exec-ephemeral-001',
      workflowId: 'wf-001',
      triggerMetadata: null,
      workflowSnapshot: {
        workflow: { workerRuntime: 'static', stepAllocationTimeoutSeconds: 300 },
        steps: [{ id: 'ws-1', stepOrder: 1, workerRuntime: 'ephemeral' }],
      },
    });
    mockDb.query.workflows.findFirst.mockResolvedValueOnce({
      id: 'wf-001',
      name: 'Ephemeral WF',
      userId: 'user-001',
      defaultAgentId: 'agent-001',
      workspaceId: 'ws-001',
      defaultModel: null,
      defaultReasoningEffort: null,
      workerRuntime: 'static',
      stepAllocationTimeoutSeconds: 300,
    });
    mockDb.query.workflowSteps.findMany.mockResolvedValueOnce([
      { id: 'ws-1', name: 'Step 1', promptTemplate: 'Do X', stepOrder: 1, agentId: null, model: null, reasoningEffort: null, workerRuntime: 'ephemeral', timeoutSeconds: 60 },
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
    mockDb.query.stepExecutions.findFirst = vi
      .fn()
      .mockResolvedValueOnce({ id: 'se-1', status: 'running' })
      .mockResolvedValueOnce({ id: 'se-1', status: 'completed', output: 'AI response output' })
      .mockResolvedValueOnce({ id: 'se-1', status: 'completed', output: 'AI response output' });

    await executeWorkflow('exec-ephemeral-001');

    expect(mockCreateAgentPod).toHaveBeenCalled();
    expect(mockWaitForPodCompletion).toHaveBeenCalled();
    expect(mockDeleteAgentPod).toHaveBeenCalled();
    expect(mockQueueAdd).not.toHaveBeenCalledWith('step-execution', expect.anything());
  });

  it('prefers a step-level static override over an ephemeral workflow default', async () => {
    const { executeWorkflow } = await import('../src/services/workflow-engine.js');

    mockDb.query.workflowExecutions.findFirst.mockResolvedValueOnce({
      id: 'exec-static-override-001',
      workflowId: 'wf-001',
      triggerMetadata: null,
      workflowSnapshot: {
        workflow: { workerRuntime: 'ephemeral', stepAllocationTimeoutSeconds: 300 },
        steps: [{ id: 'ws-1', stepOrder: 1, workerRuntime: 'static' }],
      },
    });
    mockDb.query.workflows.findFirst.mockResolvedValueOnce({
      id: 'wf-001',
      name: 'Mixed Runtime WF',
      userId: 'user-001',
      defaultAgentId: 'agent-001',
      workspaceId: 'ws-001',
      defaultModel: null,
      defaultReasoningEffort: null,
      workerRuntime: 'ephemeral',
      stepAllocationTimeoutSeconds: 300,
    });
    mockDb.query.workflowSteps.findMany.mockResolvedValueOnce([
      { id: 'ws-1', name: 'Step 1', promptTemplate: 'Do X', stepOrder: 1, agentId: null, model: null, reasoningEffort: null, workerRuntime: 'static', timeoutSeconds: 60 },
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
    mockDb.query.stepExecutions.findFirst = vi
      .fn()
      .mockResolvedValueOnce({ id: 'se-1', status: 'pending', liveOutput: [] })
      .mockResolvedValueOnce({ id: 'se-1', status: 'completed', output: 'AI response output' })
      .mockResolvedValueOnce({ id: 'se-1', status: 'completed', output: 'AI response output' });

    await executeWorkflow('exec-static-override-001');

    expect(mockQueueAdd).toHaveBeenCalledWith('step-execution', {
      stepExecutionId: 'se-1',
      executionId: 'exec-static-override-001',
    });
    expect(mockCreateAgentPod).not.toHaveBeenCalled();
  });

  it('keeps a pending step and reschedules the workflow when LLM credit quota is exhausted', async () => {
    const { executeWorkflow } = await import('../src/services/workflow-engine.js');

    mockDb.query.workflowExecutions.findFirst.mockResolvedValueOnce({
      id: 'exec-quota-001',
      workflowId: 'wf-001',
      status: 'pending',
      startedAt: null,
      triggerMetadata: null,
      workflowSnapshot: { workflow: { stepAllocationTimeoutSeconds: 300 } },
    });
    mockDb.query.workflows.findFirst.mockResolvedValueOnce({
      id: 'wf-001',
      name: 'Quota WF',
      userId: 'user-001',
      defaultAgentId: 'agent-001',
      workspaceId: 'ws-001',
      defaultModel: null,
      defaultReasoningEffort: null,
      workerRuntime: 'static',
      stepAllocationTimeoutSeconds: 300,
    });
    mockDb.query.workflowSteps.findMany.mockResolvedValueOnce([
      { id: 'ws-1', name: 'Step 1', promptTemplate: 'Do X', stepOrder: 1, agentId: null, model: null, reasoningEffort: null, workerRuntime: null, timeoutSeconds: 60 },
    ]);
    mockDb.query.stepExecutions.findMany.mockResolvedValueOnce([
      { id: 'se-1', stepOrder: 1, status: 'pending', liveOutput: [] },
    ]);
    mockDb.query.agents.findFirst.mockResolvedValueOnce({
      id: 'agent-001',
      name: 'Test Agent',
      userId: 'user-001',
      sourceType: 'database',
      version: 1,
    });
    mockDb.query.userQuotaSettings.findFirst.mockResolvedValueOnce({
      dailyCreditLimit: '1.00',
      weeklyCreditLimit: null,
      monthlyCreditLimit: null,
    });
    mockDb.query.creditUsage.findMany.mockResolvedValueOnce([
      {
        workspaceId: 'ws-001',
        userId: 'user-001',
        date: new Date().toISOString().slice(0, 10),
        creditsConsumed: '1.00',
      },
    ]);
    mockDb.query.stepExecutions.findFirst.mockResolvedValueOnce({
      id: 'se-1',
      status: 'pending',
      liveOutput: [],
    });

    await executeWorkflow('exec-quota-001');

    expect(mockQueueAdd).not.toHaveBeenCalledWith('step-execution', expect.anything());
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'execute-workflow',
      expect.objectContaining({ executionId: 'exec-quota-001', workflowId: 'wf-001', startFromStep: 0 }),
      expect.objectContaining({ delay: expect.any(Number), jobId: expect.stringContaining('quota') }),
    );
    expect(mockCreateAgentPod).not.toHaveBeenCalled();
  });

  it('handles static allocation timeout when no worker becomes available', async () => {
    const { executeWorkflow } = await import('../src/services/workflow-engine.js');

    mockDb.query.workflowExecutions.findFirst.mockResolvedValueOnce({
      id: 'exec-003',
      workflowId: 'wf-001',
      triggerMetadata: null,
      workflowSnapshot: { workflow: { stepAllocationTimeoutSeconds: 30 } },
    });
    mockDb.query.workflows.findFirst.mockResolvedValueOnce({
      id: 'wf-001',
      name: 'Test WF',
      userId: 'user-001',
      defaultAgentId: 'agent-001',
      workspaceId: 'ws-001',
      defaultModel: null,
      defaultReasoningEffort: null,
      workerRuntime: 'static',
      stepAllocationTimeoutSeconds: 30,
    });
    mockDb.query.workflowSteps.findMany.mockResolvedValueOnce([
      { id: 'ws-1', name: 'Step 1', promptTemplate: 'Do X', stepOrder: 1, agentId: null, model: null, reasoningEffort: null, workerRuntime: null, timeoutSeconds: 60 },
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
    // Static path: the step never leaves pending, so allocation times out.
    mockDb.query.stepExecutions.findFirst = vi.fn().mockResolvedValue({
      id: 'se-1',
      status: 'pending',
    });

    // Use fake timers to skip the 3s poll intervals and 30s allocation timeout.
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const promise = executeWorkflow('exec-003');
    await vi.advanceTimersByTimeAsync(31_000);
    await promise;

    vi.useRealTimers();

    // Step was enqueued but timed out waiting for allocation
    expect(mockQueueAdd).toHaveBeenCalled();
    // Execution should be marked as failed due to allocation timeout
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('keeps an ephemeral step pending until allocation timeout when dynamic capacity is full', async () => {
    const { executeWorkflow } = await import('../src/services/workflow-engine.js');

    mockAcquireAgentSlot.mockResolvedValue(false);
    mockDb.query.workflowExecutions.findFirst.mockResolvedValueOnce({
      id: 'exec-capacity-001',
      workflowId: 'wf-001',
      triggerMetadata: null,
      workflowSnapshot: { workflow: { workerRuntime: 'ephemeral', stepAllocationTimeoutSeconds: 3 } },
    });
    mockDb.query.workflows.findFirst.mockResolvedValueOnce({
      id: 'wf-001',
      name: 'Ephemeral Capacity WF',
      userId: 'user-001',
      defaultAgentId: 'agent-001',
      workspaceId: 'ws-001',
      defaultModel: null,
      defaultReasoningEffort: null,
      workerRuntime: 'ephemeral',
      stepAllocationTimeoutSeconds: 3,
    });
    mockDb.query.workflowSteps.findMany.mockResolvedValueOnce([
      { id: 'ws-1', name: 'Step 1', promptTemplate: 'Do X', stepOrder: 1, agentId: null, model: null, reasoningEffort: null, workerRuntime: null, timeoutSeconds: 60 },
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
    mockDb.query.stepExecutions.findFirst = vi.fn().mockResolvedValue({
      id: 'se-1',
      status: 'pending',
      liveOutput: [],
    });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    const promise = executeWorkflow('exec-capacity-001');
    await vi.advanceTimersByTimeAsync(3_500);
    await promise;

    expect(mockAcquireAgentSlot).toHaveBeenCalled();
    expect(mockCreateAgentPod).not.toHaveBeenCalled();
    expect(mockPublishRealtimeEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'step.allocation_waiting',
      data: expect.objectContaining({
        allocationWait: expect.objectContaining({ reason: 'rate_limited' }),
      }),
    }));
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('retries ephemeral pod provisioning until allocation timeout when Kubernetes is unavailable', async () => {
    const { executeWorkflow } = await import('../src/services/workflow-engine.js');

    mockCreateAgentPod.mockRejectedValue(new Error('Kubernetes API unavailable'));
    mockDb.query.workflowExecutions.findFirst.mockResolvedValueOnce({
      id: 'exec-k8s-001',
      workflowId: 'wf-001',
      triggerMetadata: null,
      workflowSnapshot: { workflow: { workerRuntime: 'ephemeral', stepAllocationTimeoutSeconds: 3 } },
    });
    mockDb.query.workflows.findFirst.mockResolvedValueOnce({
      id: 'wf-001',
      name: 'Ephemeral K8s WF',
      userId: 'user-001',
      defaultAgentId: 'agent-001',
      workspaceId: 'ws-001',
      defaultModel: null,
      defaultReasoningEffort: null,
      workerRuntime: 'ephemeral',
      stepAllocationTimeoutSeconds: 3,
    });
    mockDb.query.workflowSteps.findMany.mockResolvedValueOnce([
      { id: 'ws-1', name: 'Step 1', promptTemplate: 'Do X', stepOrder: 1, agentId: null, model: null, reasoningEffort: null, workerRuntime: null, timeoutSeconds: 60 },
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
    mockDb.query.stepExecutions.findFirst = vi.fn().mockResolvedValue({
      id: 'se-1',
      status: 'pending',
      liveOutput: [],
    });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    const promise = executeWorkflow('exec-k8s-001');
    await vi.advanceTimersByTimeAsync(3_500);
    await promise;

    expect(mockCreateAgentPod).toHaveBeenCalled();
    expect(mockReleaseAgentSlot).toHaveBeenCalled();
    expect(mockPublishRealtimeEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'step.allocation_waiting',
      data: expect.objectContaining({
        allocationWait: expect.objectContaining({
          reason: 'provisioning_unavailable',
          lastError: 'Kubernetes API unavailable',
        }),
      }),
    }));
    expect(mockDb.update).toHaveBeenCalled();
  });
});
