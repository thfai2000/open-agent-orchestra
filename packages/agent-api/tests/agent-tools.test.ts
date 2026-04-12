import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// ─── Mock @github/copilot-sdk ───────────────────────────────────────
vi.mock('@github/copilot-sdk', () => ({
  defineTool: vi.fn((name: string, config: { handler: Function }) => ({
    name,
    handler: config.handler,
    _config: config,
  })),
}));

// ─── Mock database ──────────────────────────────────────────────────
const mockTriggerFindFirst = vi.fn();
const mockWebhookRegFindFirst = vi.fn();
const mockDb = {
  query: {
    triggers: { findFirst: mockTriggerFindFirst, findMany: vi.fn().mockResolvedValue([]) },
    workflows: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    workflowSteps: { findMany: vi.fn().mockResolvedValue([]) },
    agentDecisions: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    agentMemories: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    agentVariables: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    userVariables: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    webhookRegistrations: { findFirst: mockWebhookRegFindFirst },
  },
  select: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  }),
  insert: vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 'new-id', createdAt: new Date().toISOString() }]),
      onConflictDoUpdate: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'new-id' }]),
      }),
      onConflictDoNothing: vi.fn().mockResolvedValue([]),
    }),
  }),
  update: vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'updated-id' }]),
      }),
    }),
  }),
  delete: vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue([]),
  }),
  execute: vi.fn().mockResolvedValue({
    rows: [
      { id: 'mem-1', content: 'test memory', memory_type: 'general', tags: [], metadata: null, created_at: new Date().toISOString(), similarity: 0.95 },
    ],
  }),
};

vi.mock('../src/database/index.js', () => ({
  db: mockDb,
}));

// ─── Mock embedding service ─────────────────────────────────────────
vi.mock('../src/services/embedding-service.js', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0.01)),
}));

// ─── Mock Redis ─────────────────────────────────────────────────────
vi.mock('../src/services/redis.js', () => ({
  getRedisConnection: vi.fn().mockReturnValue({}),
}));

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-key-must-be-at-least-32-chars-long!!';
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
});

beforeEach(() => {
  vi.clearAllMocks();
});

const TEST_CONTEXT = {
  agentId: '550e8400-e29b-41d4-a716-446655440010',
  workflowId: '550e8400-e29b-41d4-a716-446655440020',
  executionId: '550e8400-e29b-41d4-a716-446655440030',
  userId: '550e8400-e29b-41d4-a716-446655440000',
};

describe('createAgentTools', () => {
  it('returns all 9 built-in tools when no enabledTools filter', async () => {
    const { createAgentTools } = await import('../src/services/agent-tools.js');
    const credentials = new Map<string, string>();
    const tools = createAgentTools(credentials, TEST_CONTEXT);
    expect(tools.length).toBe(9);
  });

  it('filters tools when enabledTools is provided', async () => {
    const { createAgentTools } = await import('../src/services/agent-tools.js');
    const credentials = new Map<string, string>();
    const tools = createAgentTools(credentials, TEST_CONTEXT, ['record_decision', 'memory_store']);
    expect(tools.length).toBe(2);
    const toolNames = tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain('record_decision');
    expect(toolNames).toContain('memory_store');
  });

  it('returns all tools when enabledTools is empty array (filter requires non-empty)', async () => {
    const { createAgentTools } = await import('../src/services/agent-tools.js');
    const credentials = new Map<string, string>();
    // Empty array doesn't trigger the filter (enabledTools.length > 0 is false)
    const tools = createAgentTools(credentials, TEST_CONTEXT, []);
    expect(tools.length).toBe(9);
  });

  it('returns all tools when enabledTools is undefined', async () => {
    const { createAgentTools } = await import('../src/services/agent-tools.js');
    const credentials = new Map<string, string>();
    const tools = createAgentTools(credentials, TEST_CONTEXT, undefined);
    expect(tools.length).toBe(9);
  });
});

describe('agent-tools: record_decision', () => {
  it('inserts a decision record into the database', async () => {
    const { createAgentTools } = await import('../src/services/agent-tools.js');
    const tools = createAgentTools(new Map(), TEST_CONTEXT);
    const recordDecision = tools.find((t: { name: string }) => t.name === 'record_decision') as { handler: Function };

    const result = await recordDecision.handler({
      category: 'trade',
      action: 'buy_stock',
      reasoning: 'Market looks bullish',
      confidence: 0.85,
      signals: ['rsi_low', 'macd_bullish_crossover'],
    });

    expect(mockDb.insert).toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result.recorded).toBe(true);
    expect(result.decisionId).toBe('new-id');
    expect(result.category).toBe('trade');
  });

  it('handles missing context gracefully', async () => {
    const { createAgentTools } = await import('../src/services/agent-tools.js');
    // No context provided
    const tools = createAgentTools(new Map());
    const recordDecision = tools.find((t: { name: string }) => t.name === 'record_decision') as { handler: Function };

    const result = await recordDecision.handler({
      category: 'test',
      action: 'test_action',
      reasoning: 'Testing without context',
      confidence: 0.5,
      signals: [],
    });
    // Should return error since no agentId in context
    expect(result).toBeDefined();
    expect(result.error).toBeDefined();
  });
});

describe('agent-tools: memory_store', () => {
  it('stores a memory with embedding', async () => {
    const { createAgentTools } = await import('../src/services/agent-tools.js');
    const tools = createAgentTools(new Map(), TEST_CONTEXT);
    const memoryStore = tools.find((t: { name: string }) => t.name === 'memory_store') as { handler: Function };

    const result = await memoryStore.handler({
      content: 'Important fact about the market',
      memoryType: 'observation',
    });

    expect(mockDb.insert).toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result.stored).toBe(true);
  });
});

describe('agent-tools: memory_retrieve', () => {
  it('retrieves memories via similarity search using db.execute', async () => {
    const { createAgentTools } = await import('../src/services/agent-tools.js');
    const tools = createAgentTools(new Map(), TEST_CONTEXT);
    const memoryRetrieve = tools.find((t: { name: string }) => t.name === 'memory_retrieve') as { handler: Function };

    const result = await memoryRetrieve.handler({
      query: 'market data',
      limit: 5,
    });

    expect(mockDb.execute).toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result.memories).toBeDefined();
    expect(result.count).toBe(1);
  });
});

describe('agent-tools: schedule_next_workflow_execution', () => {
  it('creates a new exact_datetime trigger when none exists', async () => {
    mockTriggerFindFirst.mockResolvedValueOnce(null); // No existing trigger

    const { createAgentTools } = await import('../src/services/agent-tools.js');
    const tools = createAgentTools(new Map(), TEST_CONTEXT);
    const scheduleTool = tools.find((t: { name: string }) => t.name === 'schedule_next_workflow_execution') as { handler: Function };

    const result = await scheduleTool.handler({
      datetime: '2026-12-01T10:00:00Z',
      reason: 'Check quarterly report',
    });

    expect(mockDb.insert).toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result.created).toBe(true);
  });

  it('updates existing trigger when one exists', async () => {
    mockTriggerFindFirst.mockResolvedValueOnce({
      id: 'trigger-1',
      workflowId: TEST_CONTEXT.workflowId,
      triggerType: 'exact_datetime',
    });

    const { createAgentTools } = await import('../src/services/agent-tools.js');
    const tools = createAgentTools(new Map(), TEST_CONTEXT);
    const scheduleTool = tools.find((t: { name: string }) => t.name === 'schedule_next_workflow_execution') as { handler: Function };

    const result = await scheduleTool.handler({
      datetime: '2026-12-01T10:00:00Z',
      reason: 'Updated schedule',
    });

    expect(mockDb.update).toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result.updated).toBe(true);
  });

  it('returns error for past datetime', async () => {
    const { createAgentTools } = await import('../src/services/agent-tools.js');
    const tools = createAgentTools(new Map(), TEST_CONTEXT);
    const scheduleTool = tools.find((t: { name: string }) => t.name === 'schedule_next_workflow_execution') as { handler: Function };

    const result = await scheduleTool.handler({
      datetime: '2020-01-01T10:00:00Z',
    });

    expect(result.error).toBeDefined();
  });

  it('returns error without workflow context', async () => {
    const { createAgentTools } = await import('../src/services/agent-tools.js');
    const tools = createAgentTools(new Map()); // no context
    const scheduleTool = tools.find((t: { name: string }) => t.name === 'schedule_next_workflow_execution') as { handler: Function };

    const result = await scheduleTool.handler({
      datetime: '2026-12-01T10:00:00Z',
    });

    expect(result.error).toBeDefined();
  });
});

describe('agent-tools: manage_webhook_trigger', () => {
  it('creates a new webhook trigger with endpointPath', async () => {
    const { createAgentTools } = await import('../src/services/agent-tools.js');
    const tools = createAgentTools(new Map(), TEST_CONTEXT);
    const webhookTool = tools.find((t: { name: string }) => t.name === 'manage_webhook_trigger') as { handler: Function };

    const result = await webhookTool.handler({
      action: 'create',
      endpointPath: '/my-agent/trade-signal',
    });

    expect(mockDb.insert).toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result.created).toBe(true);
  });

  it('returns error when creating without endpointPath', async () => {
    const { createAgentTools } = await import('../src/services/agent-tools.js');
    const tools = createAgentTools(new Map(), TEST_CONTEXT);
    const webhookTool = tools.find((t: { name: string }) => t.name === 'manage_webhook_trigger') as { handler: Function };

    const result = await webhookTool.handler({
      action: 'create',
    });

    expect(result.error).toBeDefined();
  });

  it('deactivates an existing webhook trigger', async () => {
    mockWebhookRegFindFirst.mockResolvedValueOnce({
      id: 'webhook-1',
      agentId: TEST_CONTEXT.agentId,
      isActive: true,
    });

    const { createAgentTools } = await import('../src/services/agent-tools.js');
    const tools = createAgentTools(new Map(), TEST_CONTEXT);
    const webhookTool = tools.find((t: { name: string }) => t.name === 'manage_webhook_trigger') as { handler: Function };

    const result = await webhookTool.handler({
      action: 'deactivate',
    });

    expect(mockDb.update).toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result.deactivated).toBe(true);
  });

  it('returns error when no active webhook to deactivate', async () => {
    mockWebhookRegFindFirst.mockResolvedValueOnce(null);

    const { createAgentTools } = await import('../src/services/agent-tools.js');
    const tools = createAgentTools(new Map(), TEST_CONTEXT);
    const webhookTool = tools.find((t: { name: string }) => t.name === 'manage_webhook_trigger') as { handler: Function };

    const result = await webhookTool.handler({
      action: 'deactivate',
    });

    expect(result.error).toBeDefined();
  });
});

describe('agent-tools: edit_workflow', () => {
  it('lists triggers for the workflow', async () => {
    mockDb.query.triggers.findMany.mockResolvedValueOnce([
      { id: 'trig-1', triggerType: 'time_schedule', isActive: true },
    ]);

    const { createAgentTools } = await import('../src/services/agent-tools.js');
    const tools = createAgentTools(new Map(), TEST_CONTEXT);
    const editWorkflow = tools.find((t: { name: string }) => t.name === 'edit_workflow') as { handler: Function };

    const result = await editWorkflow.handler({
      action: 'list_triggers',
    });

    expect(result).toBeDefined();
    expect(result.triggers).toBeDefined();
  });

  it('adds a trigger to the workflow', async () => {
    const { createAgentTools } = await import('../src/services/agent-tools.js');
    const tools = createAgentTools(new Map(), TEST_CONTEXT);
    const editWorkflow = tools.find((t: { name: string }) => t.name === 'edit_workflow') as { handler: Function };

    const result = await editWorkflow.handler({
      action: 'add_trigger',
      triggerData: {
        triggerType: 'time_schedule',
        configuration: { cron: '*/5 * * * *' },
        isActive: true,
      },
    });

    expect(mockDb.insert).toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result.created).toBe(true);
  });

  it('updates steps in the workflow', async () => {
    const { createAgentTools } = await import('../src/services/agent-tools.js');
    const tools = createAgentTools(new Map(), TEST_CONTEXT);
    const editWorkflow = tools.find((t: { name: string }) => t.name === 'edit_workflow') as { handler: Function };

    const result = await editWorkflow.handler({
      action: 'update_steps',
      steps: [
        { name: 'Step 1', promptTemplate: 'Analyze data', stepOrder: 1 },
        { name: 'Step 2', promptTemplate: 'Generate report', stepOrder: 2 },
      ],
    });

    expect(mockDb.delete).toHaveBeenCalled();
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.update).toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result.updated).toBe(true);
  });
});

describe('agent-tools: read_variables', () => {
  it('reads agent-scoped variables', async () => {
    mockDb.query.agentVariables.findMany.mockResolvedValueOnce([
      { id: 'v1', key: 'API_KEY', variableType: 'credential', valueEncrypted: 'enc_value', description: null, injectAsEnvVariable: false },
      { id: 'v2', key: 'SETTING', variableType: 'property', valueEncrypted: 'enc_setting', description: 'A setting', injectAsEnvVariable: true },
    ]);

    const { createAgentTools } = await import('../src/services/agent-tools.js');
    const tools = createAgentTools(new Map(), TEST_CONTEXT);
    const readVars = tools.find((t: { name: string }) => t.name === 'read_variables') as { handler: Function };

    const result = await readVars.handler({ scope: 'agent', variableType: 'all' });

    expect(result).toBeDefined();
    expect(result.variables).toBeDefined();
    expect(result.variables.length).toBe(2);
    // Credential values should be masked
    const credVar = result.variables.find((v: { key: string }) => v.key === 'API_KEY');
    expect(credVar.value).toBe('••••••••');
  });

  it('reads user-scoped variables', async () => {
    mockDb.query.userVariables.findMany.mockResolvedValueOnce([
      { id: 'uv1', key: 'USER_PREF', variableType: 'property', valueEncrypted: 'enc', description: null, injectAsEnvVariable: false },
    ]);

    const { createAgentTools } = await import('../src/services/agent-tools.js');
    const tools = createAgentTools(new Map(), TEST_CONTEXT);
    const readVars = tools.find((t: { name: string }) => t.name === 'read_variables') as { handler: Function };

    const result = await readVars.handler({ scope: 'user', variableType: 'all' });

    expect(result).toBeDefined();
    expect(result.variables).toBeDefined();
  });
});

describe('agent-tools: edit_variables', () => {
  it('creates a new variable', async () => {
    const { createAgentTools } = await import('../src/services/agent-tools.js');
    const tools = createAgentTools(new Map(), TEST_CONTEXT);
    const editVars = tools.find((t: { name: string }) => t.name === 'edit_variables') as { handler: Function };

    const result = await editVars.handler({
      action: 'create',
      key: 'NEW_KEY',
      value: 'new_value',
      variableType: 'property',
    });

    expect(mockDb.insert).toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result.created).toBe(true);
  });

  it('updates an existing variable by id', async () => {
    const { createAgentTools } = await import('../src/services/agent-tools.js');
    const tools = createAgentTools(new Map(), TEST_CONTEXT);
    const editVars = tools.find((t: { name: string }) => t.name === 'edit_variables') as { handler: Function };

    const result = await editVars.handler({
      action: 'update',
      key: 'EXISTING_KEY',
      value: 'updated_value',
      variableId: '550e8400-e29b-41d4-a716-446655440050',
    });

    expect(mockDb.update).toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result.updated).toBe(true);
  });

  it('deletes a variable by id', async () => {
    const { createAgentTools } = await import('../src/services/agent-tools.js');
    const tools = createAgentTools(new Map(), TEST_CONTEXT);
    const editVars = tools.find((t: { name: string }) => t.name === 'edit_variables') as { handler: Function };

    const result = await editVars.handler({
      action: 'delete',
      key: 'OLD_KEY',
      variableId: '550e8400-e29b-41d4-a716-446655440051',
    });

    expect(mockDb.delete).toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result.deleted).toBe(true);
  });

  it('returns error when creating without value', async () => {
    const { createAgentTools } = await import('../src/services/agent-tools.js');
    const tools = createAgentTools(new Map(), TEST_CONTEXT);
    const editVars = tools.find((t: { name: string }) => t.name === 'edit_variables') as { handler: Function };

    const result = await editVars.handler({
      action: 'create',
      key: 'NO_VALUE_KEY',
    });

    expect(result.error).toBeDefined();
  });
});

describe('agent-tools: simple_http_request credential masking', () => {
  it('renders Jinja2 templates and sends real credentials in headers to the target', async () => {
    const { createAgentTools } = await import('../src/services/agent-tools.js');

    const mockFetchResponse = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': 'application/json' },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse);

    try {
      const templateContext = {
        credentials: { API_TOKEN: 'super-secret-token-123' },
        properties: { API_BASE: 'https://api.example.com' },
      };
      const tools = createAgentTools(new Map(), TEST_CONTEXT, undefined, templateContext);
      const httpTool = tools.find((t: { name: string }) => t.name === 'simple_http_request') as { handler: Function };

      const result = await httpTool.handler({
        url: '{{ properties.API_BASE }}/data',
        method: 'GET',
        headers: '{"Authorization": "Bearer {{ credentials.API_TOKEN }}"}',
        auth_type: 'none',
        timeout_ms: 5000,
        follow_redirects: true,
        max_redirects: 10,
        include_response_headers: false,
        max_response_size: 1048576,
        verify_ssl: true,
      });

      // The HTTP request should succeed
      expect(result.status).toBe(200);

      // Verify fetch was called with the RENDERED credential in the header
      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const fetchHeaders = fetchCall[1].headers as Record<string, string>;
      expect(fetchHeaders['Authorization']).toBe('Bearer super-secret-token-123');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('renders Jinja2 templates in URL and bearer auth_value', async () => {
    const { createAgentTools } = await import('../src/services/agent-tools.js');

    const mockFetchResponse = new Response('OK', { status: 200, statusText: 'OK' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse);

    try {
      const templateContext = {
        credentials: { TOKEN: 'my-bearer-token' },
        properties: { HOST: 'https://example.com' },
      };
      const tools = createAgentTools(new Map(), TEST_CONTEXT, undefined, templateContext);
      const httpTool = tools.find((t: { name: string }) => t.name === 'simple_http_request') as { handler: Function };

      await httpTool.handler({
        url: '{{ properties.HOST }}/api/v1',
        method: 'GET',
        auth_type: 'bearer',
        auth_value: '{{ credentials.TOKEN }}',
        timeout_ms: 5000,
        follow_redirects: true,
        max_redirects: 10,
        include_response_headers: false,
        max_response_size: 1048576,
        verify_ssl: true,
      });

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(fetchCall[0]).toBe('https://example.com/api/v1');
      const fetchHeaders = fetchCall[1].headers as Record<string, string>;
      expect(fetchHeaders['Authorization']).toBe('Bearer my-bearer-token');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
