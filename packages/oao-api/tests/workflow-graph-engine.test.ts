/**
 * Graph engine smoke tests.
 *
 * Mocks the database layer and Copilot SDK so the topology / dispatch
 * logic runs in isolation. Tests cover:
 *   - sequential graph (start → http → script → end)
 *   - parallel fan-out + join (start → A & B → join → end)
 *   - conditional branching (start → cond → A or B → end)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// All mock infrastructure must be hoisted because vi.mock() runs first.
const hoisted = vi.hoisted(() => {
  interface FakeNode {
    workflowId: string;
    nodeKey: string;
    nodeType: string;
    name: string;
    config: Record<string, unknown>;
    positionX: number;
    positionY: number;
  }
  interface FakeEdge {
    workflowId: string;
    fromNodeKey: string;
    toNodeKey: string;
    branchKey: string | null;
    label: string | null;
  }
  interface FakeWorkflowStep {
    id: string;
    workflowId: string;
    name: string;
    promptTemplate: string;
    stepOrder: number;
    agentId: string | null;
    model: string | null;
    reasoningEffort: string | null;
    workerRuntime: string | null;
    timeoutSeconds: number;
    createdAt: Date;
    updatedAt: Date;
  }
  interface FakeStepExecution {
    id: string;
    workflowExecutionId: string;
    workflowStepId: string;
    stepOrder: number;
    status: string;
  }
  const state: {
    workflow: {
      id: string;
      workspaceId: string;
      userId: string;
      executionMode: string;
      defaultAgentId: string | null;
      defaultModel: string | null;
      defaultReasoningEffort: string | null;
      workerRuntime: 'static' | 'ephemeral';
    };
    execution: {
      id: string;
      workflowId: string;
      triggerMetadata: Record<string, unknown> | null;
      status: string;
      startedAt: Date | null;
      completedAt: Date | null;
      totalSteps: number | null;
      currentStep: number;
      error: string | null;
    };
    nodes: FakeNode[];
    edges: FakeEdge[];
    steps: FakeWorkflowStep[];
    stepExecutions: FakeStepExecution[];
    agent: Record<string, unknown> | null;
    nodeExecutions: Array<Record<string, unknown>>;
  } = {
    workflow: {
      id: 'wf-1',
      workspaceId: 'ws-1',
      userId: 'user-1',
      executionMode: 'graph',
      defaultAgentId: null,
      defaultModel: null,
      defaultReasoningEffort: null,
      workerRuntime: 'static',
    },
    execution: {
      id: 'exec-1',
      workflowId: 'wf-1',
      triggerMetadata: null,
      status: 'pending',
      startedAt: null,
      completedAt: null,
      totalSteps: null,
      currentStep: 0,
      error: null,
    },
    nodes: [],
    edges: [],
    steps: [],
    stepExecutions: [],
    agent: null,
    nodeExecutions: [],
  };
  const mockDb = {
    query: {
      workflows: { findFirst: vi.fn(async () => state.workflow) },
      workflowExecutions: { findFirst: vi.fn(async () => state.execution) },
      workflowNodes: { findMany: vi.fn(async () => state.nodes) },
      workflowEdges: { findMany: vi.fn(async () => state.edges) },
      workflowSteps: { findMany: vi.fn(async () => state.steps) },
      stepExecutions: { findMany: vi.fn(async () => state.stepExecutions) },
      agents: { findFirst: vi.fn(async () => state.agent) },
      nodeExecutions: { findMany: vi.fn(async () => state.nodeExecutions) },
    },
    insert: vi.fn(() => ({
      values: vi.fn((row: Record<string, unknown> | Array<Record<string, unknown>>) => {
        const rows = Array.isArray(row) ? row : [row];
        const records = rows.map((item, index) => ({ id: `ne-${state.nodeExecutions.length + index + 1}`, ...item }));
        state.nodeExecutions.push(...records);
        return {
          returning: vi.fn(async () => records),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((row: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          if ('status' in row && typeof row.status === 'string') state.execution.status = row.status;
          if ('startedAt' in row && row.startedAt instanceof Date) state.execution.startedAt = row.startedAt;
          if ('completedAt' in row && row.completedAt instanceof Date) state.execution.completedAt = row.completedAt;
          if ('error' in row && typeof row.error === 'string') state.execution.error = row.error;
          return [];
        }),
      })),
    })),
    delete: vi.fn(() => ({ where: vi.fn(async () => []) })),
  };
  return { state, mockDb };
});
const { state } = hoisted;

// ─── Mock realtime bus ──────────────────────────────────────────────
vi.mock('../src/services/realtime-bus.js', () => ({
  publishRealtimeEvent: vi.fn(),
}));

// ─── Mock Copilot SDK / agent-workspace (unused by procedural tests) ─
vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: vi.fn(),
  approveAll: vi.fn(),
  defineTool: vi.fn((name: string, config: unknown) => ({ name, _config: config })),
}));

// ─── Mock workflow-engine.executeCopilotSession ─────────────────────
vi.mock('../src/services/workflow-engine.js', () => ({
  executeCopilotSession: vi.fn(async () => ({
    output: 'agent says hi',
    resolvedPrompt: '',
    reasoningTrace: {},
  })),
}));

// ─── Mock variables service ─────────────────────────────────────────
vi.mock('../src/services/workflow-scoped-variables.js', () => ({
  resolveWorkflowVariablesForRender: vi.fn(async () => ({
    properties: { region: 'us-east' },
    credentials: {},
    memories: {},
  })),
  setExecutionVariable: vi.fn(async () => undefined),
  listExecutionVariables: vi.fn(async () => ({})),
  rememberShortMemory: vi.fn(),
  recallShortMemory: vi.fn(),
}));

// ─── Mock resolved-agent-variables ──────────────────────────────────
vi.mock('../src/services/resolved-agent-variables.js', () => ({
  resolveAgentTemplateContextMaps: vi.fn(async () => ({
    credentials: new Map(),
    properties: new Map(),
    envVariables: new Map(),
  })),
}));

vi.mock('../src/database/index.js', () => ({ db: hoisted.mockDb }));

// ─── Mock fetch for http_request nodes ──────────────────────────────
const fetchMock = vi.fn(
  async () =>
    new Response(JSON.stringify({ value: 100 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
);
globalThis.fetch = fetchMock as typeof fetch;

import { executeGraphWorkflow } from '../src/services/workflow-graph-engine.js';
import { executeCopilotSession } from '../src/services/workflow-engine.js';

beforeEach(() => {
  state.workflow.defaultAgentId = null;
  state.workflow.defaultModel = null;
  state.workflow.defaultReasoningEffort = null;
  state.workflow.workerRuntime = 'static';
  state.execution = {
    id: 'exec-1',
    workflowId: 'wf-1',
    triggerMetadata: null,
    status: 'pending',
    startedAt: null,
    completedAt: null,
    totalSteps: null,
    currentStep: 0,
    error: null,
  };
  state.nodeExecutions = [];
  state.nodes = [];
  state.edges = [];
  state.steps = [];
  state.stepExecutions = [];
  state.agent = null;
  fetchMock.mockClear();
  vi.mocked(executeCopilotSession).mockClear();
});

describe('executeGraphWorkflow', () => {
  it('runs a simple sequential graph: start → http_request → script → end', async () => {
    state.nodes = [
      { workflowId: 'wf-1', nodeKey: 'start', nodeType: 'start', name: 'Start', config: {}, positionX: 0, positionY: 0 },
      {
        workflowId: 'wf-1',
        nodeKey: 'fetch',
        nodeType: 'http_request',
        name: 'Fetch data',
        config: { url: 'https://api.example.com/v1', method: 'GET' },
        positionX: 100,
        positionY: 0,
      },
      {
        workflowId: 'wf-1',
        nodeKey: 'transform',
        nodeType: 'script',
        name: 'Transform',
        config: { source: 'return { doubled: input.body.value * 2 }' },
        positionX: 200,
        positionY: 0,
      },
      { workflowId: 'wf-1', nodeKey: 'end', nodeType: 'end', name: 'End', config: {}, positionX: 300, positionY: 0 },
    ];
    state.edges = [
      { workflowId: 'wf-1', fromNodeKey: 'start', toNodeKey: 'fetch', branchKey: null, label: null },
      { workflowId: 'wf-1', fromNodeKey: 'fetch', toNodeKey: 'transform', branchKey: null, label: null },
      { workflowId: 'wf-1', fromNodeKey: 'transform', toNodeKey: 'end', branchKey: null, label: null },
    ];

    const result = await executeGraphWorkflow('exec-1');
    expect(result.status).toBe('completed');
    expect(result.nodesExecuted).toBe(4);
    expect(result.finalOutputs.transform).toEqual({ doubled: 200 });
    expect(state.execution.status).toBe('completed');
  });

  it('runs parallel fan-out + join correctly', async () => {
    state.nodes = [
      { workflowId: 'wf-1', nodeKey: 'start', nodeType: 'start', name: 'Start', config: {}, positionX: 0, positionY: 0 },
      { workflowId: 'wf-1', nodeKey: 'split', nodeType: 'parallel', name: 'Fan out', config: {}, positionX: 100, positionY: 0 },
      {
        workflowId: 'wf-1',
        nodeKey: 'a',
        nodeType: 'script',
        name: 'A',
        config: { source: 'return "a-result"' },
        positionX: 200,
        positionY: -50,
      },
      {
        workflowId: 'wf-1',
        nodeKey: 'b',
        nodeType: 'script',
        name: 'B',
        config: { source: 'return "b-result"' },
        positionX: 200,
        positionY: 50,
      },
      { workflowId: 'wf-1', nodeKey: 'join', nodeType: 'join', name: 'Merge', config: { strategy: 'all' }, positionX: 300, positionY: 0 },
      { workflowId: 'wf-1', nodeKey: 'end', nodeType: 'end', name: 'End', config: {}, positionX: 400, positionY: 0 },
    ];
    state.edges = [
      { workflowId: 'wf-1', fromNodeKey: 'start', toNodeKey: 'split', branchKey: null, label: null },
      { workflowId: 'wf-1', fromNodeKey: 'split', toNodeKey: 'a', branchKey: null, label: null },
      { workflowId: 'wf-1', fromNodeKey: 'split', toNodeKey: 'b', branchKey: null, label: null },
      { workflowId: 'wf-1', fromNodeKey: 'a', toNodeKey: 'join', branchKey: null, label: null },
      { workflowId: 'wf-1', fromNodeKey: 'b', toNodeKey: 'join', branchKey: null, label: null },
      { workflowId: 'wf-1', fromNodeKey: 'join', toNodeKey: 'end', branchKey: null, label: null },
    ];

    const result = await executeGraphWorkflow('exec-1');
    expect(result.status).toBe('completed');
    expect(result.finalOutputs.a).toBe('a-result');
    expect(result.finalOutputs.b).toBe('b-result');
    // The join node should see both parents merged into a single object input.
    const joinInput = result.finalOutputs.join as { a: string; b: string };
    expect(joinInput).toEqual({ a: 'a-result', b: 'b-result' });
  });

  it('routes by conditional branchKey', async () => {
    state.nodes = [
      { workflowId: 'wf-1', nodeKey: 'start', nodeType: 'start', name: 'Start', config: {}, positionX: 0, positionY: 0 },
      {
        workflowId: 'wf-1',
        nodeKey: 'pick',
        nodeType: 'conditional',
        name: 'Pick branch',
        config: { expression: '"alpha"' },
        positionX: 100,
        positionY: 0,
      },
      {
        workflowId: 'wf-1',
        nodeKey: 'a',
        nodeType: 'script',
        name: 'A',
        config: { source: 'return "alpha-took-it"' },
        positionX: 200,
        positionY: -50,
      },
      {
        workflowId: 'wf-1',
        nodeKey: 'b',
        nodeType: 'script',
        name: 'B',
        config: { source: 'return "beta-took-it"' },
        positionX: 200,
        positionY: 50,
      },
      { workflowId: 'wf-1', nodeKey: 'end', nodeType: 'end', name: 'End', config: {}, positionX: 300, positionY: 0 },
    ];
    state.edges = [
      { workflowId: 'wf-1', fromNodeKey: 'start', toNodeKey: 'pick', branchKey: null, label: null },
      { workflowId: 'wf-1', fromNodeKey: 'pick', toNodeKey: 'a', branchKey: 'alpha', label: 'alpha branch' },
      { workflowId: 'wf-1', fromNodeKey: 'pick', toNodeKey: 'b', branchKey: 'beta', label: 'beta branch' },
      { workflowId: 'wf-1', fromNodeKey: 'a', toNodeKey: 'end', branchKey: null, label: null },
      { workflowId: 'wf-1', fromNodeKey: 'b', toNodeKey: 'end', branchKey: null, label: null },
    ];

    const result = await executeGraphWorkflow('exec-1');
    expect(result.status).toBe('completed');
    expect(result.finalOutputs.a).toBe('alpha-took-it');
    expect(result.finalOutputs.b).toBeUndefined(); // b branch should NOT have run
  });

  it('uses trigger metadata as the start node output', async () => {
    state.execution.triggerMetadata = {
      type: 'manual',
      inputs: { ticket: 'OAO-123' },
      payload: { raw: true },
    };
    state.nodes = [
      { workflowId: 'wf-1', nodeKey: 'start', nodeType: 'start', name: 'Start', config: {}, positionX: 0, positionY: 0 },
      {
        workflowId: 'wf-1',
        nodeKey: 'read_input',
        nodeType: 'script',
        name: 'Read input',
        config: { source: 'return { ticket: input.inputs.ticket, triggerType: input.trigger.type, raw: input.payload.raw }' },
        positionX: 100,
        positionY: 0,
      },
      { workflowId: 'wf-1', nodeKey: 'end', nodeType: 'end', name: 'End', config: {}, positionX: 200, positionY: 0 },
    ];
    state.edges = [
      { workflowId: 'wf-1', fromNodeKey: 'start', toNodeKey: 'read_input', branchKey: null, label: null },
      { workflowId: 'wf-1', fromNodeKey: 'read_input', toNodeKey: 'end', branchKey: null, label: null },
    ];

    const result = await executeGraphWorkflow('exec-1');
    expect(result.status).toBe('completed');
    expect(result.finalOutputs.read_input).toEqual({ ticket: 'OAO-123', triggerType: 'manual', raw: true });
  });

  it('skips unchosen conditional branches so downstream joins can complete', async () => {
    state.nodes = [
      { workflowId: 'wf-1', nodeKey: 'start', nodeType: 'start', name: 'Start', config: {}, positionX: 0, positionY: 0 },
      { workflowId: 'wf-1', nodeKey: 'pick', nodeType: 'conditional', name: 'Pick', config: { expression: '"go"' }, positionX: 100, positionY: 0 },
      { workflowId: 'wf-1', nodeKey: 'a', nodeType: 'script', name: 'A', config: { source: 'return "a-result"' }, positionX: 200, positionY: -50 },
      { workflowId: 'wf-1', nodeKey: 'b', nodeType: 'script', name: 'B', config: { source: 'return "b-result"' }, positionX: 200, positionY: 50 },
      { workflowId: 'wf-1', nodeKey: 'join', nodeType: 'join', name: 'Merge', config: { strategy: 'all' }, positionX: 300, positionY: 0 },
      { workflowId: 'wf-1', nodeKey: 'end', nodeType: 'end', name: 'End', config: {}, positionX: 400, positionY: 0 },
    ];
    state.edges = [
      { workflowId: 'wf-1', fromNodeKey: 'start', toNodeKey: 'pick', branchKey: null, label: null },
      { workflowId: 'wf-1', fromNodeKey: 'pick', toNodeKey: 'a', branchKey: 'go', label: null },
      { workflowId: 'wf-1', fromNodeKey: 'pick', toNodeKey: 'b', branchKey: 'stop', label: null },
      { workflowId: 'wf-1', fromNodeKey: 'a', toNodeKey: 'join', branchKey: null, label: null },
      { workflowId: 'wf-1', fromNodeKey: 'b', toNodeKey: 'join', branchKey: null, label: null },
      { workflowId: 'wf-1', fromNodeKey: 'join', toNodeKey: 'end', branchKey: null, label: null },
    ];

    const result = await executeGraphWorkflow('exec-1');
    expect(result.status).toBe('completed');
    expect(result.nodesExecuted).toBe(5);
    expect(result.finalOutputs.join).toEqual({ a: 'a-result' });
    expect(state.nodeExecutions.some((row) => row.nodeKey === 'b' && row.status === 'skipped')).toBe(true);
  });

  it('links agent_step nodes to the matching pre-created step execution', async () => {
    state.workflow.defaultAgentId = 'agent-1';
    state.agent = {
      id: 'agent-1',
      name: 'Agent One',
      description: null,
      sourceType: 'database',
      gitRepoUrl: null,
      gitBranch: null,
      agentFilePath: null,
      skillsPaths: [],
      skillsDirectory: null,
      builtinToolsEnabled: null,
      mcpJsonTemplate: null,
      status: 'active',
      version: 7,
      userId: 'user-1',
    };
    const now = new Date();
    state.steps = [
      {
        id: 'step-1',
        workflowId: 'wf-1',
        name: 'Agent node',
        promptTemplate: 'Handle {{ inputs.ticket }} with {{ node_input.kind }}',
        stepOrder: 1,
        agentId: 'agent-1',
        model: null,
        reasoningEffort: null,
        workerRuntime: null,
        timeoutSeconds: 300,
        createdAt: now,
        updatedAt: now,
      },
    ];
    state.stepExecutions = [
      { id: 'step-exec-1', workflowExecutionId: 'exec-1', workflowStepId: 'step-1', stepOrder: 1, status: 'pending' },
    ];
    state.execution.triggerMetadata = { inputs: { ticket: 'OAO-456' } };
    state.nodes = [
      { workflowId: 'wf-1', nodeKey: 'start', nodeType: 'start', name: 'Start', config: {}, positionX: 0, positionY: 0 },
      {
        workflowId: 'wf-1',
        nodeKey: 'agent_node',
        nodeType: 'agent_step',
        name: 'Agent node',
        config: { promptTemplate: 'Handle {{ inputs.ticket }} with {{ node_input.kind }}', agentId: 'agent-1' },
        positionX: 100,
        positionY: 0,
      },
      { workflowId: 'wf-1', nodeKey: 'end', nodeType: 'end', name: 'End', config: {}, positionX: 200, positionY: 0 },
    ];
    state.edges = [
      { workflowId: 'wf-1', fromNodeKey: 'start', toNodeKey: 'agent_node', branchKey: null, label: null },
      { workflowId: 'wf-1', fromNodeKey: 'agent_node', toNodeKey: 'end', branchKey: null, label: null },
    ];

    const result = await executeGraphWorkflow('exec-1');
    expect(result.status).toBe('completed');
    expect(executeCopilotSession).toHaveBeenCalledWith(expect.objectContaining({
      stepExecutionId: 'step-exec-1',
      nodeExecutionId: 'ne-2',
      nodeKey: 'agent_node',
      inputs: { ticket: 'OAO-456' },
      templateExtra: expect.objectContaining({
        node_input: expect.objectContaining({ inputs: { ticket: 'OAO-456' } }),
      }),
    }));
    expect(state.nodeExecutions.find((row) => row.nodeKey === 'agent_node')?.stepExecutionId).toBe('step-exec-1');
  });

  it('fails the execution when a node throws', async () => {
    state.nodes = [
      { workflowId: 'wf-1', nodeKey: 'start', nodeType: 'start', name: 'Start', config: {}, positionX: 0, positionY: 0 },
      {
        workflowId: 'wf-1',
        nodeKey: 'boom',
        nodeType: 'script',
        name: 'Throw',
        config: { source: 'throw new Error("nope")' },
        positionX: 100,
        positionY: 0,
      },
      { workflowId: 'wf-1', nodeKey: 'end', nodeType: 'end', name: 'End', config: {}, positionX: 200, positionY: 0 },
    ];
    state.edges = [
      { workflowId: 'wf-1', fromNodeKey: 'start', toNodeKey: 'boom', branchKey: null, label: null },
      { workflowId: 'wf-1', fromNodeKey: 'boom', toNodeKey: 'end', branchKey: null, label: null },
    ];

    const result = await executeGraphWorkflow('exec-1');
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/nope/);
    expect(state.execution.status).toBe('failed');
  });

  it('rejects a graph with no start node', async () => {
    state.nodes = [
      { workflowId: 'wf-1', nodeKey: 'a', nodeType: 'script', name: 'A', config: { source: 'return 1' }, positionX: 0, positionY: 0 },
    ];
    state.edges = [];
    const result = await executeGraphWorkflow('exec-1');
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/start node/);
  });
});
