import { describe, expect, it } from 'vitest';
import { buildGraphFromSequentialSteps, deriveWorkflowStepsFromGraph } from '../src/services/workflow-graph-sync.js';

describe('workflow graph sync (v4.0.0 — no synthetic start/end)', () => {
  it('builds visual agent-step nodes from sequential workflow steps', () => {
    const graph = buildGraphFromSequentialSteps([
      {
        id: 'step-a',
        name: 'Analyze',
        promptTemplate: 'Analyze {{ inputs.topic }}',
        stepOrder: 1,
        agentId: 'agent-a',
        model: 'gpt-5-mini',
        reasoningEffort: 'medium',
        workerRuntime: 'ephemeral',
        timeoutSeconds: 600,
      },
      {
        id: 'step-b',
        name: 'Summarize',
        promptTemplate: 'Summarize {{ precedent_output }}',
        stepOrder: 2,
        timeoutSeconds: 300,
      },
    ]);

    expect(graph.nodes.map((node) => node.nodeKey)).toEqual(['step_1', 'step_2']);
    expect(graph.nodes.map((node) => node.nodeType)).toEqual(['agent_step', 'agent_step']);
    expect(graph.nodes.some((node) => node.nodeKey === 'start' || node.nodeKey === 'end')).toBe(false);
    expect(graph.edges.map((edge) => `${edge.fromNodeKey}->${edge.toNodeKey}`)).toEqual([
      'step_1->step_2',
    ]);
    expect(graph.edges.some((edge) => edge.fromNodeKey === 'start' || edge.toNodeKey === 'end')).toBe(false);
    expect(graph.nodes[0]?.config).toMatchObject({
      stepId: 'step-a',
      promptTemplate: 'Analyze {{ inputs.topic }}',
      agentId: 'agent-a',
      model: 'gpt-5-mini',
      reasoningEffort: 'medium',
      workerRuntime: 'ephemeral',
      timeoutSeconds: 600,
    });
  });

  it('derives workflow steps from graph agent-step nodes in edge order', () => {
    const steps = deriveWorkflowStepsFromGraph(
      [
        { nodeKey: 'last', nodeType: 'agent_step', name: 'Last', config: { promptTemplate: 'last', timeoutSeconds: 300 }, positionX: 600, positionY: 0 },
        {
          nodeKey: 'first',
          nodeType: 'agent_step',
          name: 'First',
          config: {
            promptTemplate: 'first',
            agentId: 'agent-a',
            model: 'gpt-5-mini',
            reasoningEffort: 'high',
            workerRuntime: 'static',
            timeoutSeconds: 900,
          },
          positionX: 300,
          positionY: 0,
        },
      ],
      [
        { fromNodeKey: 'first', toNodeKey: 'last' },
      ],
    );

    expect(steps).toEqual([
      {
        name: 'First',
        promptTemplate: 'first',
        stepOrder: 1,
        agentId: 'agent-a',
        model: 'gpt-5-mini',
        reasoningEffort: 'high',
        workerRuntime: 'static',
        timeoutSeconds: 900,
      },
      {
        name: 'Last',
        promptTemplate: 'last',
        stepOrder: 2,
        agentId: null,
        model: null,
        reasoningEffort: null,
        workerRuntime: null,
        timeoutSeconds: 300,
      },
    ]);
  });

  it('rejects agent-step nodes without prompt templates', () => {
    expect(() => deriveWorkflowStepsFromGraph([
      { nodeKey: 'step_1', nodeType: 'agent_step', name: 'Ask', config: {}, positionX: 200, positionY: 0 },
    ], [])).toThrow('Prompt Template');
  });

  it('returns an empty step projection when a graph has no agent-step nodes', () => {
    const steps = deriveWorkflowStepsFromGraph(
      [
        { nodeKey: 'script_1', nodeType: 'script', name: 'Transform', config: { source: 'return input' }, positionX: 200, positionY: 0 },
      ],
      [],
    );

    expect(steps).toEqual([]);
  });
});
