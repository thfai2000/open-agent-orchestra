type NodeType = 'start' | 'end' | 'agent_step' | 'http_request' | 'script' | 'conditional' | 'parallel' | 'join';
type ReasoningEffort = 'high' | 'medium' | 'low';
type WorkerRuntime = 'static' | 'ephemeral';

export interface SequentialWorkflowStepLike {
  id?: string;
  name: string;
  promptTemplate: string;
  stepOrder: number;
  agentId?: string | null;
  model?: string | null;
  reasoningEffort?: ReasoningEffort | null;
  workerRuntime?: WorkerRuntime | null;
  timeoutSeconds?: number | null;
}

export interface WorkflowGraphNodeLike {
  nodeKey: string;
  nodeType: NodeType;
  name: string;
  config?: Record<string, unknown> | null;
  positionX?: number | null;
  positionY?: number | null;
}

export interface WorkflowGraphEdgeLike {
  fromNodeKey: string;
  toNodeKey: string;
  branchKey?: string | null;
  label?: string | null;
}

export interface DerivedWorkflowStep {
  name: string;
  promptTemplate: string;
  stepOrder: number;
  agentId: string | null;
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
  workerRuntime: WorkerRuntime | null;
  timeoutSeconds: number;
}

const STEP_X = 320;
const STEP_Y = 170;
const STEP_GAP_X = 240;

function normalizeNodeKey(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_.-]/g, '_');
  return /^[A-Za-z]/.test(normalized) ? normalized : `n_${normalized}`;
}

export function buildGraphFromSequentialSteps(
  steps: SequentialWorkflowStepLike[],
): { nodes: WorkflowGraphNodeLike[]; edges: WorkflowGraphEdgeLike[] } {
  const orderedSteps = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);
  const nodes: WorkflowGraphNodeLike[] = [
    { nodeKey: 'start', nodeType: 'start', name: 'Start', config: {}, positionX: 80, positionY: STEP_Y },
  ];

  for (const [index, step] of orderedSteps.entries()) {
    nodes.push({
      nodeKey: normalizeNodeKey(`step_${step.stepOrder || index + 1}`),
      nodeType: 'agent_step',
      name: step.name || `Step ${index + 1}`,
      config: {
        stepId: step.id ?? null,
        stepOrder: index + 1,
        promptTemplate: step.promptTemplate,
        agentId: step.agentId ?? null,
        model: step.model ?? null,
        reasoningEffort: step.reasoningEffort ?? null,
        workerRuntime: step.workerRuntime ?? null,
        timeoutSeconds: step.timeoutSeconds ?? 300,
      },
      positionX: STEP_X + index * STEP_GAP_X,
      positionY: STEP_Y,
    });
  }

  nodes.push({
    nodeKey: 'end',
    nodeType: 'end',
    name: 'End',
    config: {},
    positionX: STEP_X + orderedSteps.length * STEP_GAP_X,
    positionY: STEP_Y,
  });

  const edges: WorkflowGraphEdgeLike[] = [];
  for (let index = 0; index < nodes.length - 1; index++) {
    edges.push({ fromNodeKey: nodes[index]!.nodeKey, toNodeKey: nodes[index + 1]!.nodeKey, branchKey: null, label: null });
  }

  return { nodes, edges };
}

function positionSort(a: WorkflowGraphNodeLike, b: WorkflowGraphNodeLike): number {
  const ay = a.positionY ?? 0;
  const by = b.positionY ?? 0;
  if (ay !== by) return ay - by;
  const ax = a.positionX ?? 0;
  const bx = b.positionX ?? 0;
  if (ax !== bx) return ax - bx;
  return a.nodeKey.localeCompare(b.nodeKey);
}

export function graphOrderedAgentNodes(nodes: WorkflowGraphNodeLike[], edges: WorkflowGraphEdgeLike[]): WorkflowGraphNodeLike[] {
  const nodesByKey = new Map(nodes.map((node) => [node.nodeKey, node]));
  const outgoing = new Map<string, WorkflowGraphEdgeLike[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.fromNodeKey) ?? [];
    list.push(edge);
    outgoing.set(edge.fromNodeKey, list);
  }
  for (const list of outgoing.values()) {
    list.sort((a, b) => {
      const targetA = nodesByKey.get(a.toNodeKey);
      const targetB = nodesByKey.get(b.toNodeKey);
      if (targetA && targetB) return positionSort(targetA, targetB);
      return a.toNodeKey.localeCompare(b.toNodeKey);
    });
  }

  const ordered: WorkflowGraphNodeLike[] = [];
  const visited = new Set<string>();
  const start = nodes.find((node) => node.nodeType === 'start');
  const queue = start ? [start.nodeKey] : [];

  while (queue.length > 0) {
    const key = queue.shift()!;
    if (visited.has(key)) continue;
    visited.add(key);
    const node = nodesByKey.get(key);
    if (node?.nodeType === 'agent_step') ordered.push(node);
    for (const edge of outgoing.get(key) ?? []) queue.push(edge.toNodeKey);
  }

  const remaining = nodes
    .filter((node) => node.nodeType === 'agent_step' && !visited.has(node.nodeKey))
    .sort((a, b) => {
      const orderA = typeof a.config?.stepOrder === 'number' ? a.config.stepOrder : Number.MAX_SAFE_INTEGER;
      const orderB = typeof b.config?.stepOrder === 'number' ? b.config.stepOrder : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return positionSort(a, b);
    });

  return [...ordered, ...remaining];
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function nullableReasoningEffort(value: unknown): ReasoningEffort | null {
  return value === 'high' || value === 'medium' || value === 'low' ? value : null;
}

function nullableWorkerRuntime(value: unknown): WorkerRuntime | null {
  return value === 'static' || value === 'ephemeral' ? value : null;
}

function timeoutSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return 300;
  if (value < 30 || value > 3600) throw new Error('Agent step timeoutSeconds must be between 30 and 3600');
  return value;
}

export function deriveWorkflowStepsFromGraph(
  nodes: WorkflowGraphNodeLike[],
  edges: WorkflowGraphEdgeLike[],
): DerivedWorkflowStep[] {
  return graphOrderedAgentNodes(nodes, edges).map((node, index) => {
    const config = node.config ?? {};
    const promptTemplate = typeof config.promptTemplate === 'string' ? config.promptTemplate : '';
    if (!promptTemplate.trim()) {
      throw new Error(`Agent step "${node.name}" must include a Prompt Template`);
    }

    return {
      name: node.name,
      promptTemplate,
      stepOrder: index + 1,
      agentId: nullableString(config.agentId),
      model: nullableString(config.model),
      reasoningEffort: nullableReasoningEffort(config.reasoningEffort),
      workerRuntime: nullableWorkerRuntime(config.workerRuntime),
      timeoutSeconds: timeoutSeconds(config.timeoutSeconds),
    };
  });
}