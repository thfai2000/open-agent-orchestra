/**
 * Graph workflow engine — DAG runner for visual workflows.
 *
 * Supports a mix of agent_step and procedural (http_request, script,
 * conditional, parallel, join) nodes connected by typed edges. Each node
 * fires once its incoming edges all have a satisfied predecessor (or the
 * branch keys match for conditional / parallel splits). Successors are
 * scheduled as soon as a node completes, so independent branches run
 * concurrently.
 *
 * Live progress is published through the existing realtime bus using
 * `node.*` and `step.*` event types so node-level graph progress and
 * agent-step output are available from a single subscription.
 */

import { and, eq } from 'drizzle-orm';
import { createLogger } from '@oao/shared';

import { db } from '../database/index.js';
import {
  workflowExecutions,
  workflows,
  workflowSteps,
  workflowNodes,
  workflowEdges,
  nodeExecutions,
  stepExecutions,
  agents,
} from '../database/schema.js';
import { publishRealtimeEvent } from './realtime-bus.js';
import { renderTemplate, buildTemplateContext } from './jinja-renderer.js';
import { resolveAgentTemplateContextMaps } from './resolved-agent-variables.js';
import { executeCopilotSession } from './workflow-engine.js';
import { graphOrderedAgentNodes } from './workflow-graph-sync.js';
import {
  resolveWorkflowVariablesForRender,
  setExecutionVariable,
  listExecutionVariables,
} from './workflow-scoped-variables.js';
import {
  executeHttpRequest,
  executeScript,
  evaluateConditional,
  type ProceduralContext,
} from './workflow-procedural.js';

const logger = createLogger('workflow-graph-engine');

type NodeRow = typeof workflowNodes.$inferSelect;
type EdgeRow = typeof workflowEdges.$inferSelect;
type StepRow = typeof workflowSteps.$inferSelect;
type StepExecutionRow = typeof stepExecutions.$inferSelect;

function orderedNodes(nodes: NodeRow[]): NodeRow[] {
  return [...nodes].sort((left, right) => {
    const y = (left.positionY ?? 0) - (right.positionY ?? 0);
    if (y !== 0) return y;
    const x = (left.positionX ?? 0) - (right.positionX ?? 0);
    if (x !== 0) return x;
    return left.nodeKey.localeCompare(right.nodeKey);
  });
}

function orderedEdges(edges: EdgeRow[]): EdgeRow[] {
  return [...edges].sort((left, right) => {
    const from = left.fromNodeKey.localeCompare(right.fromNodeKey);
    return from !== 0 ? from : left.toNodeKey.localeCompare(right.toNodeKey);
  });
}

function orderedSteps(steps: StepRow[]): StepRow[] {
  return [...steps].sort((left, right) => left.stepOrder - right.stepOrder);
}

function orderedEntryCandidates(nodes: NodeRow[], edges: EdgeRow[]): NodeRow[] {
  const targetKeys = new Set(edges.map((edge) => edge.toNodeKey));
  const roots = nodes.filter((node) => !targetKeys.has(node.nodeKey));
  const nonRoots = nodes.filter((node) => targetKeys.has(node.nodeKey));
  const byCanvas = (left: NodeRow, right: NodeRow) => {
    const x = (left.positionX ?? 0) - (right.positionX ?? 0);
    if (x !== 0) return x;
    const y = (left.positionY ?? 0) - (right.positionY ?? 0);
    if (y !== 0) return y;
    return left.nodeKey.localeCompare(right.nodeKey);
  };
  return [...roots.sort(byCanvas), ...nonRoots.sort(byCanvas)];
}

function snapshotRows<T>(snapshot: Record<string, unknown>, key: string): T[] | null {
  const rows = snapshot[key];
  return Array.isArray(rows) ? rows as T[] : null;
}

export interface GraphExecutionResult {
  executionId: string;
  status: 'completed' | 'failed';
  nodesExecuted: number;
  finalOutputs: Record<string, unknown>;
  error?: string;
}

const MAX_NODE_FIRINGS = 500; // safety: prevent infinite cycles

type NodeTerminalStatus = 'completed' | 'failed' | 'skipped';

/**
 * Pure helper: choose the entry node for a graph execution. Resolution order:
 *   1. The trigger's `_entryNodeKey` (if it exists in the graph).
 *   2. The first node in the graph (positional fallback).
 *   3. `null` if the graph is empty — the engine treats this as fatal.
 * Exported for testing.
 */
export function pickEntryNode<T extends { nodeKey: string; nodeType: string }>(
  nodes: T[],
  overrideEntryKey: string | null | undefined,
): T | null {
  if (overrideEntryKey) {
    const match = nodes.find((n) => n.nodeKey === overrideEntryKey);
    if (match) return match;
  }
  return nodes[0] ?? null;
}

/**
 * Execute a graph-mode workflow. Called from the workflow worker for every
 * workflow (graph mode is the only execution mode as of v4.0.0).
 */
export async function executeGraphWorkflow(executionId: string): Promise<GraphExecutionResult> {
  const execution = await db.query.workflowExecutions.findFirst({
    where: eq(workflowExecutions.id, executionId),
  });
  if (!execution) throw new Error(`Execution ${executionId} not found`);
  if (
    execution.status === 'completed' ||
    execution.status === 'failed' ||
    execution.status === 'cancelled'
  ) {
    logger.info({ executionId, status: execution.status }, 'Graph execution already terminal, skipping');
    return {
      executionId,
      status: execution.status === 'completed' ? 'completed' : 'failed',
      nodesExecuted: 0,
      finalOutputs: {},
      error: execution.error ?? undefined,
    };
  }

  const workflow = await db.query.workflows.findFirst({
    where: eq(workflows.id, execution.workflowId),
  });
  if (!workflow) throw new Error(`Workflow ${execution.workflowId} not found`);

  const workflowSnapshot = asRecord(execution.workflowSnapshot);
  const snapshotNodes = snapshotRows<NodeRow>(workflowSnapshot, 'nodes');
  const snapshotEdges = snapshotRows<EdgeRow>(workflowSnapshot, 'edges');
  const snapshotSteps = snapshotRows<StepRow>(workflowSnapshot, 'steps');

  const nodes = orderedNodes(snapshotNodes ?? (await db.query.workflowNodes.findMany({
    where: eq(workflowNodes.workflowId, workflow.id),
  })));
  const edges = orderedEdges(snapshotEdges ?? (await db.query.workflowEdges.findMany({
    where: eq(workflowEdges.workflowId, workflow.id),
  })));
  const steps = orderedSteps(snapshotSteps ?? (await db.query.workflowSteps.findMany({
    where: eq(workflowSteps.workflowId, workflow.id),
    orderBy: workflowSteps.stepOrder,
  })));
  const stepExecs = await db.query.stepExecutions.findMany({
    where: eq(stepExecutions.workflowExecutionId, executionId),
    orderBy: stepExecutions.stepOrder,
  });
  if (nodes.length === 0) {
    await markExecutionFailed(executionId, 'Graph workflow has no nodes');
    return { executionId, status: 'failed', nodesExecuted: 0, finalOutputs: {}, error: 'no nodes' };
  }

  // Per-trigger entry override: enqueueWorkflowExecution stores the trigger's
  // entryNodeKey on triggerMetadata._entryNodeKey so multiple triggers may
  // point at different entry nodes inside the same graph. When no override
  // is provided, fall back to the first root node by canvas position and key.
  const triggerMetaForEntry = asRecord(execution.triggerMetadata);
  const overrideEntryKey = typeof triggerMetaForEntry._entryNodeKey === 'string'
    ? triggerMetaForEntry._entryNodeKey
    : null;
  const entryNode = pickEntryNode(orderedEntryCandidates(nodes, edges), overrideEntryKey);
  if (!entryNode) {
    await markExecutionFailed(executionId, 'Graph workflow has no entry node');
    return { executionId, status: 'failed', nodesExecuted: 0, finalOutputs: {}, error: 'no entry node' };
  }

  const nodesByKey = new Map<string, NodeRow>();
  for (const n of nodes) nodesByKey.set(n.nodeKey, n);

  const outgoingEdgesByFrom = new Map<string, EdgeRow[]>();
  const incomingEdgesByTo = new Map<string, EdgeRow[]>();
  for (const e of edges) {
    const out = outgoingEdgesByFrom.get(e.fromNodeKey) ?? [];
    out.push(e);
    outgoingEdgesByFrom.set(e.fromNodeKey, out);
    const inn = incomingEdgesByTo.get(e.toNodeKey) ?? [];
    inn.push(e);
    incomingEdgesByTo.set(e.toNodeKey, inn);
  }

  const orderedAgentNodes = graphOrderedAgentNodes(
    nodes.map((node) => ({ ...node, config: asRecord(node.config) })),
    edges,
  );
  const agentStepExecutionsByNodeKey = new Map<string, { step: StepRow; stepExec: StepExecutionRow }>();
  for (const [index, node] of orderedAgentNodes.entries()) {
    const step = steps[index];
    const stepExec = stepExecs[index];
    if (step && stepExec) agentStepExecutionsByNodeKey.set(node.nodeKey, { step, stepExec });
  }

  await db
    .update(workflowExecutions)
    .set({
      status: 'running',
      startedAt: execution.startedAt ?? new Date(),
      totalSteps: nodes.length,
      currentStep: 0,
    })
    .where(eq(workflowExecutions.id, executionId));

  publishRealtimeEvent({
    type: 'execution.started',
    executionId,
    workflowId: workflow.id,
    workspaceId: workflow.workspaceId ?? undefined,
    data: { status: 'running', mode: 'graph', totalNodes: nodes.length },
    timestamp: new Date().toISOString(),
  });

  const nodeOutputs = new Map<string, unknown>();
  const nodeStatuses = new Map<string, NodeTerminalStatus>();
  let firings = 0;
  const initialInput = buildEntryNodeInput(execution);

  // Schedule queue: each entry is { nodeKey, branchKeyFromPredecessor }
  // We walk breadth-first; concurrency comes from awaiting independent
  // branches in parallel via Promise.all.
  type Frontier = Array<{ nodeKey: string; predecessor?: string; branchKey?: string | null; inputOverride?: unknown }>;
  let frontier: Frontier = [{ nodeKey: entryNode.nodeKey, inputOverride: initialInput }];

  while (frontier.length > 0) {
    if (firings >= MAX_NODE_FIRINGS) {
      const msg = `Graph workflow exceeded MAX_NODE_FIRINGS (${MAX_NODE_FIRINGS}); aborting (cycle detected?)`;
      await markExecutionFailed(executionId, msg);
      return { executionId, status: 'failed', nodesExecuted: firings, finalOutputs: {}, error: msg };
    }

    // Group by node so a join-style node receives all parents before firing.
    const byNode = new Map<string, Frontier>();
    for (const item of frontier) {
      const existing = byNode.get(item.nodeKey) ?? [];
      existing.push(item);
      byNode.set(item.nodeKey, existing);
    }

    const readyNodeKeys: string[] = [];
    const deferredNodeKeys: string[] = [];
    for (const [nodeKey] of byNode) {
      const node = nodesByKey.get(nodeKey);
      if (!node) {
        const msg = `Edge points to unknown node "${nodeKey}"`;
        await markExecutionFailed(executionId, msg);
        return { executionId, status: 'failed', nodesExecuted: firings, finalOutputs: {}, error: msg };
      }
      if (node.nodeType === 'join') {
        const required = (incomingEdgesByTo.get(nodeKey) ?? []).length;
        const config = (node.config ?? {}) as { strategy?: 'all' | 'any' };
        const strategy = config.strategy ?? 'all';
        const terminalParentCount = (incomingEdgesByTo.get(nodeKey) ?? []).filter(
          (e) => {
            const status = nodeStatuses.get(e.fromNodeKey);
            return status === 'completed' || status === 'skipped';
          },
        ).length;
        if (strategy === 'all' && terminalParentCount < required) {
          deferredNodeKeys.push(nodeKey);
          continue;
        }
      }
      readyNodeKeys.push(nodeKey);
    }

    // Execute all ready nodes in parallel.
    const fired = await Promise.all(
      readyNodeKeys.map(async (nodeKey) => {
        const node = nodesByKey.get(nodeKey)!;
        const arrivals = byNode.get(nodeKey)!;
        // Choose input: if multiple parents fed in, pick the most recent
        // completed predecessor's output. For deterministic merging, use
        // an object map { fromNodeKey: output } when more than one parent.
        let input: unknown;
        if (arrivals.length === 1) {
          const a = arrivals[0];
          input = a.predecessor ? nodeOutputs.get(a.predecessor) : a.inputOverride;
        } else {
          const merged: Record<string, unknown> = {};
          for (const a of arrivals) {
            if (a.predecessor && nodeStatuses.get(a.predecessor) === 'completed') {
              merged[a.predecessor] = nodeOutputs.get(a.predecessor);
            }
          }
          input = merged;
        }

        firings++;
        const result = await runNode(node, input, {
          execution,
          workflow,
          agentStepExecutionsByNodeKey,
        });
        nodeOutputs.set(nodeKey, result.output);
        nodeStatuses.set(nodeKey, result.status);

        await db
          .update(workflowExecutions)
          .set({ currentStep: firings })
          .where(eq(workflowExecutions.id, executionId));

        if (result.status === 'failed') {
          return { nodeKey, branchKeys: null as string[] | null, skippedTargets: [] as string[], failed: true, error: result.error };
        }

        // Determine which outgoing branches to follow.
        const outgoing = outgoingEdgesByFrom.get(nodeKey) ?? [];
        if (node.nodeType === 'conditional') {
          // Only follow edges whose branchKey matches the chosen branch.
          const chosen = (result.branchKey ?? '').toString();
          const chosenEdges = outgoing.filter((e) => e.branchKey != null && e.branchKey === chosen);
          return {
            nodeKey,
            branchKeys: chosenEdges.map((e) => e.toNodeKey),
            skippedTargets: outgoing.filter((e) => !chosenEdges.includes(e)).map((e) => e.toNodeKey),
            failed: false,
          };
        }
        // Default: follow every outgoing edge (parallel fan-out is implicit).
        return { nodeKey, branchKeys: outgoing.map((e) => e.toNodeKey), skippedTargets: [] as string[], failed: false };
      }),
    );

    // Check for failures.
    for (const f of fired) {
      if (f.failed) {
        await markExecutionFailed(executionId, f.error ?? `Node ${f.nodeKey} failed`);
        return {
          executionId,
          status: 'failed',
          nodesExecuted: firings,
          finalOutputs: Object.fromEntries(nodeOutputs),
          error: f.error,
        };
      }
    }

    // Build next frontier.
    const nextFrontier: Frontier = [];
    for (const f of fired) {
      if (!f.branchKeys) continue;
      for (const target of f.branchKeys) {
        nextFrontier.push({ nodeKey: target, predecessor: f.nodeKey });
      }
    }
    for (const f of fired) {
      if (f.skippedTargets.length === 0) continue;
      await markSkippedBranches({
        targets: f.skippedTargets,
        skippedFrom: f.nodeKey,
        execution,
        workflow,
        nodesByKey,
        outgoingEdgesByFrom,
        incomingEdgesByTo,
        nodeStatuses,
        nextFrontier,
      });
    }
    // Re-add deferred join nodes — they will reconsider once more parents complete.
    for (const nodeKey of deferredNodeKeys) {
      // The deferred join still needs its previous incoming edge entries.
      const arrivals = byNode.get(nodeKey)!;
      for (const a of arrivals) nextFrontier.push(a);
    }

    frontier = nextFrontier;
  }

  await markUnvisitedNodesSkipped({
    execution,
    workflow,
    nodes,
    nodeStatuses,
  });

  await db
    .update(workflowExecutions)
    .set({ status: 'completed', completedAt: new Date() })
    .where(eq(workflowExecutions.id, executionId));

  publishRealtimeEvent({
    type: 'execution.completed',
    executionId,
    workflowId: workflow.id,
    workspaceId: workflow.workspaceId ?? undefined,
    data: { status: 'completed', mode: 'graph', nodesExecuted: firings },
    timestamp: new Date().toISOString(),
  });

  return {
    executionId,
    status: 'completed',
    nodesExecuted: firings,
    finalOutputs: Object.fromEntries(nodeOutputs),
  };
}

// ─── Node dispatch ───────────────────────────────────────────────────

interface RunNodeContext {
  execution: typeof workflowExecutions.$inferSelect;
  workflow: typeof workflows.$inferSelect;
  agentStepExecutionsByNodeKey: Map<string, { step: StepRow; stepExec: StepExecutionRow }>;
}

interface RunNodeResult {
  status: 'completed' | 'failed' | 'skipped';
  output: unknown;
  branchKey?: string;
  error?: string;
}

async function runNode(node: NodeRow, input: unknown, ctx: RunNodeContext): Promise<RunNodeResult> {
  const startedAt = new Date();
  const [created] = await db
    .insert(nodeExecutions)
    .values({
      workflowExecutionId: ctx.execution.id,
      nodeKey: node.nodeKey,
      nodeType: node.nodeType,
      status: 'running',
      input: input as unknown,
      nodeSnapshot: { type: node.nodeType, name: node.name, config: node.config },
      stepExecutionId: ctx.agentStepExecutionsByNodeKey.get(node.nodeKey)?.stepExec.id ?? null,
      startedAt,
    })
    .returning();

  publishRealtimeEvent({
    type: 'node.started',
    executionId: ctx.execution.id,
    workflowId: ctx.workflow.id,
    workspaceId: ctx.workflow.workspaceId ?? undefined,
    data: {
      nodeExecutionId: created.id,
      stepExecutionId: created.stepExecutionId,
      nodeKey: node.nodeKey,
      nodeType: node.nodeType,
      name: node.name,
    },
    timestamp: new Date().toISOString(),
  });

  try {
    let result: RunNodeResult;
    switch (node.nodeType) {
      case 'parallel':
      case 'join':
        // Pass-through: input becomes output.
        result = { status: 'completed', output: input };
        break;
      case 'http_request':
        result = await runHttpRequestNode(node, input, ctx);
        break;
      case 'script':
        result = await runScriptNode(node, input, ctx);
        break;
      case 'conditional':
        result = await runConditionalNode(node, input, ctx);
        break;
      case 'agent_step':
        result = await runAgentStepNode(node, input, ctx, created.id);
        break;
      default: {
        const exhaustive: never = node.nodeType;
        result = { status: 'failed', output: null, error: `Unknown node type: ${String(exhaustive)}` };
      }
    }

    await db
      .update(nodeExecutions)
      .set({
        status: result.status,
        output: result.output as unknown,
        error: result.error ?? null,
        completedAt: new Date(),
      })
      .where(eq(nodeExecutions.id, created.id));

    publishRealtimeEvent({
      type: result.status === 'completed' ? 'node.completed' : 'node.failed',
      executionId: ctx.execution.id,
      workflowId: ctx.workflow.id,
      workspaceId: ctx.workflow.workspaceId ?? undefined,
      data: {
        nodeExecutionId: created.id,
        stepExecutionId: created.stepExecutionId,
        nodeKey: node.nodeKey,
        nodeType: node.nodeType,
        status: result.status,
        branchKey: result.branchKey,
        error: result.error,
        output: result.output,
      },
      timestamp: new Date().toISOString(),
    });

    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await db
      .update(nodeExecutions)
      .set({ status: 'failed', error: errorMsg, completedAt: new Date() })
      .where(eq(nodeExecutions.id, created.id));
    publishRealtimeEvent({
      type: 'node.failed',
      executionId: ctx.execution.id,
      workflowId: ctx.workflow.id,
      workspaceId: ctx.workflow.workspaceId ?? undefined,
      data: { nodeExecutionId: created.id, stepExecutionId: created.stepExecutionId, nodeKey: node.nodeKey, nodeType: node.nodeType, error: errorMsg },
      timestamp: new Date().toISOString(),
    });
    return { status: 'failed', output: null, error: errorMsg };
  }
}

// ─── Procedural-node runners ─────────────────────────────────────────

async function buildProceduralContext(
  node: NodeRow,
  ctx: RunNodeContext,
): Promise<ProceduralContext> {
  const wfVars = await resolveWorkflowVariablesForRender(ctx.workflow.id);
  const execVars = await listExecutionVariables(ctx.execution.id);
  // Properties available to procedural nodes are workflow-scoped properties +
  // workflow-scoped short-memory entries (read-only). Credentials are
  // intentionally NOT exposed to scripts/conditionals to avoid leaking
  // secrets into user-authored expressions.
  const properties: Record<string, unknown> = { ...wfVars.properties, ...wfVars.memories };
  return {
    workflowId: ctx.workflow.id,
    executionId: ctx.execution.id,
    nodeKey: node.nodeKey,
    properties,
    executionVariables: execVars,
  };
}

async function runHttpRequestNode(node: NodeRow, input: unknown, ctx: RunNodeContext): Promise<RunNodeResult> {
  const config = (node.config ?? {}) as Record<string, unknown>;
  // Render templated strings (url, headers values) with the standard Jinja
  // context so `{{ properties.X }}` and `{{ credentials.X }}` resolve.
  const wfVars = await resolveWorkflowVariablesForRender(ctx.workflow.id);
  const propMap = new Map(Object.entries({ ...wfVars.properties, ...wfVars.memories }).map(([k, v]) => [k, String(v ?? '')] as [string, string]));
  const credMap = new Map(Object.entries(wfVars.credentials));
  const tplCtx = buildTemplateContext({
    properties: propMap,
    credentials: credMap,
    envVariables: new Map(),
    precedentOutput: '',
    inputs: { input, vars: await listExecutionVariables(ctx.execution.id) },
  });
  const renderedConfig = JSON.parse(renderTemplate(JSON.stringify(config), tplCtx)) as unknown as Parameters<typeof executeHttpRequest>[0];
  const proceduralCtx = await buildProceduralContext(node, ctx);
  const out = await executeHttpRequest(renderedConfig, input, proceduralCtx);
  return { status: 'completed', output: out };
}

async function runScriptNode(node: NodeRow, input: unknown, ctx: RunNodeContext): Promise<RunNodeResult> {
  const config = (node.config ?? {}) as Parameters<typeof executeScript>[0];
  const proceduralCtx = await buildProceduralContext(node, ctx);
  const out = await executeScript(config, input, proceduralCtx);
  return { status: 'completed', output: out };
}

async function runConditionalNode(node: NodeRow, input: unknown, ctx: RunNodeContext): Promise<RunNodeResult> {
  const config = (node.config ?? {}) as Parameters<typeof evaluateConditional>[0];
  const proceduralCtx = await buildProceduralContext(node, ctx);
  const out = evaluateConditional(config, input, proceduralCtx);
  return { status: 'completed', output: out, branchKey: out.branchKey };
}

// ─── Agent-step node ─────────────────────────────────────────────────

interface AgentStepConfig {
  promptTemplate: string;
  agentId?: string;
  model?: string;
  reasoningEffort?: 'high' | 'medium' | 'low';
  workerRuntime?: 'static' | 'ephemeral';
  timeoutSeconds?: number;
}

/**
 * Run an agent_step node by delegating to the legacy `executeCopilotSession`
 * with a synthesized step record. This reuses session-locking, MCP tool
 * loading, model resolution, quota checks, etc., from the existing engine.
 */
async function runAgentStepNode(
  node: NodeRow,
  input: unknown,
  ctx: RunNodeContext,
  nodeExecutionId: string,
): Promise<RunNodeResult> {
  const config = (node.config ?? {}) as AgentStepConfig;
  const resolvedAgentId = config.agentId ?? ctx.workflow.defaultAgentId;
  if (!resolvedAgentId) {
    return { status: 'failed', output: null, error: `agent_step "${node.name}" has no agent and workflow has no defaultAgent` };
  }
  const agent = await db.query.agents.findFirst({ where: eq(agents.id, resolvedAgentId) });
  if (!agent) {
    return { status: 'failed', output: null, error: `agent_step "${node.name}" references missing agent ${resolvedAgentId}` };
  }

  // Load standard agent/user/workspace variable maps.
  const { credentials, properties, envVariables } = await resolveAgentTemplateContextMaps({
    agentId: agent.id,
    userId: ctx.workflow.userId,
    workspaceId: ctx.workflow.workspaceId,
  });
  // Overlay workflow-scoped variables on top.
  const wfVars = await resolveWorkflowVariablesForRender(ctx.workflow.id);
  for (const [k, v] of Object.entries(wfVars.properties)) properties.set(k, String(v ?? ''));
  for (const [k, v] of Object.entries(wfVars.memories)) properties.set(k, String(v ?? ''));
  for (const [k, v] of Object.entries(wfVars.credentials)) credentials.set(k, v);

  const execVars = await listExecutionVariables(ctx.execution.id);
  const triggerInputs = getTriggerInputs(ctx.execution);
  const precedentOutput = typeof input === 'string' ? input : JSON.stringify(input ?? null);
  const mapped = ctx.agentStepExecutionsByNodeKey.get(node.nodeKey);
  if (!mapped) {
    return { status: 'failed', output: null, error: `agent_step "${node.name}" has no matching workflow step execution` };
  }

  const graphStep = {
    ...mapped.step,
    name: node.name,
    promptTemplate: config.promptTemplate ?? mapped.step.promptTemplate,
    agentId: agent.id,
    model: config.model ?? mapped.step.model,
    reasoningEffort: config.reasoningEffort ?? mapped.step.reasoningEffort,
    workerRuntime: config.workerRuntime ?? mapped.step.workerRuntime,
    timeoutSeconds: config.timeoutSeconds ?? mapped.step.timeoutSeconds,
  } as StepRow;
  const agentSnapshot = {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    sourceType: agent.sourceType,
    gitRepoUrl: agent.gitRepoUrl,
    gitBranch: agent.gitBranch,
    agentFilePath: agent.agentFilePath,
    skillsPaths: agent.skillsPaths,
    skillsDirectory: agent.skillsDirectory,
    builtinToolsEnabled: agent.builtinToolsEnabled,
    mcpJsonTemplate: agent.mcpJsonTemplate,
    status: agent.status,
    version: agent.version,
  };

  await db
    .update(stepExecutions)
    .set({
      status: 'running',
      resolvedPrompt: graphStep.promptTemplate,
      agentVersion: agent.version,
      agentSnapshot,
      startedAt: new Date(),
    })
    .where(eq(stepExecutions.id, mapped.stepExec.id));

  try {
    const result = await executeCopilotSession({
      agent,
      step: graphStep,
      stepExecutionId: mapped.stepExec.id,
      resolvedPrompt: graphStep.promptTemplate,
      precedentOutput,
      credentials,
      properties,
      envVariables,
      workerRuntime: config.workerRuntime ?? ctx.workflow.workerRuntime ?? 'static',
      inputs: triggerInputs,
      templateExtra: {
        node_input: input,
        execution_vars: execVars,
        trigger: getTriggerTemplateMetadata(ctx.execution),
        node: { key: node.nodeKey, name: node.name, executionId: nodeExecutionId },
      },
      workflowId: ctx.workflow.id,
      workspaceId: ctx.workflow.workspaceId,
      executionId: ctx.execution.id,
      userId: ctx.workflow.userId,
      workflowDefaultModel: ctx.workflow.defaultModel,
      workflowDefaultReasoningEffort: ctx.workflow.defaultReasoningEffort,
      nodeExecutionId,
      nodeKey: node.nodeKey,
    });
    await db
      .update(stepExecutions)
      .set({
        status: 'completed',
        output: result.output,
        resolvedPrompt: result.resolvedPrompt,
        reasoningTrace: result.reasoningTrace,
        completedAt: new Date(),
      })
      .where(eq(stepExecutions.id, mapped.stepExec.id));
    return { status: 'completed', output: result.output };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await db
      .update(stepExecutions)
      .set({ status: 'failed', error: errorMsg, completedAt: new Date() })
      .where(eq(stepExecutions.id, mapped.stepExec.id));
    return { status: 'failed', output: null, error: errorMsg };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getTriggerInputs(execution: typeof workflowExecutions.$inferSelect): Record<string, unknown> {
  const metadata = asRecord(execution.triggerMetadata);
  const inputs = asRecord(metadata.inputs);
  if (Object.keys(inputs).length > 0) return inputs;
  return asRecord(metadata.payload);
}

function getTriggerTemplateMetadata(execution: typeof workflowExecutions.$inferSelect): Record<string, unknown> {
  const metadata = asRecord(execution.triggerMetadata);
  const trigger = { ...metadata };
  delete trigger.inputs;
  delete trigger.payload;
  return trigger;
}

function buildEntryNodeInput(execution: typeof workflowExecutions.$inferSelect): Record<string, unknown> {
  const metadata = asRecord(execution.triggerMetadata);
  return {
    trigger: getTriggerTemplateMetadata(execution),
    inputs: getTriggerInputs(execution),
    payload: metadata.payload ?? null,
    eventData: metadata.eventData ?? null,
  };
}

async function recordSkippedNode(params: {
  node: NodeRow;
  execution: typeof workflowExecutions.$inferSelect;
  workflow: typeof workflows.$inferSelect;
  skippedFrom?: string;
}): Promise<void> {
  await db
    .insert(nodeExecutions)
    .values({
      workflowExecutionId: params.execution.id,
      nodeKey: params.node.nodeKey,
      nodeType: params.node.nodeType,
      status: 'skipped',
      input: params.skippedFrom ? { skippedFrom: params.skippedFrom } : null,
      output: null,
      nodeSnapshot: { type: params.node.nodeType, name: params.node.name, config: params.node.config },
      completedAt: new Date(),
    });

  publishRealtimeEvent({
    type: 'node.skipped',
    executionId: params.execution.id,
    workflowId: params.workflow.id,
    workspaceId: params.workflow.workspaceId ?? undefined,
    data: { nodeKey: params.node.nodeKey, nodeType: params.node.nodeType, status: 'skipped', skippedFrom: params.skippedFrom },
    timestamp: new Date().toISOString(),
  });
}

async function markSkippedBranches(params: {
  targets: string[];
  skippedFrom: string;
  execution: typeof workflowExecutions.$inferSelect;
  workflow: typeof workflows.$inferSelect;
  nodesByKey: Map<string, NodeRow>;
  outgoingEdgesByFrom: Map<string, EdgeRow[]>;
  incomingEdgesByTo: Map<string, EdgeRow[]>;
  nodeStatuses: Map<string, NodeTerminalStatus>;
  nextFrontier: Array<{ nodeKey: string; predecessor?: string; branchKey?: string | null; inputOverride?: unknown }>;
}): Promise<void> {
  const queue = params.targets.map((nodeKey) => ({ nodeKey, skippedFrom: params.skippedFrom }));
  while (queue.length > 0) {
    const item = queue.shift()!;
    if (params.nodeStatuses.has(item.nodeKey)) continue;
    if (params.nextFrontier.some((frontierItem) => frontierItem.nodeKey === item.nodeKey)) continue;

    const node = params.nodesByKey.get(item.nodeKey);
    if (!node) continue;
    if (node.nodeType === 'join') {
      params.nextFrontier.push({ nodeKey: item.nodeKey, predecessor: item.skippedFrom });
      continue;
    }

    const incoming = params.incomingEdgesByTo.get(item.nodeKey) ?? [];
    const hasPendingParent = incoming.some((edge) => !params.nodeStatuses.has(edge.fromNodeKey));
    if (hasPendingParent) continue;

    params.nodeStatuses.set(item.nodeKey, 'skipped');
    await recordSkippedNode({ node, execution: params.execution, workflow: params.workflow, skippedFrom: item.skippedFrom });
    for (const edge of params.outgoingEdgesByFrom.get(item.nodeKey) ?? []) {
      queue.push({ nodeKey: edge.toNodeKey, skippedFrom: item.nodeKey });
    }
  }
}

async function markUnvisitedNodesSkipped(params: {
  execution: typeof workflowExecutions.$inferSelect;
  workflow: typeof workflows.$inferSelect;
  nodes: NodeRow[];
  nodeStatuses: Map<string, NodeTerminalStatus>;
}): Promise<void> {
  for (const node of params.nodes) {
    if (params.nodeStatuses.has(node.nodeKey)) continue;
    params.nodeStatuses.set(node.nodeKey, 'skipped');
    await recordSkippedNode({ node, execution: params.execution, workflow: params.workflow });
  }
}

async function markExecutionFailed(executionId: string, error: string): Promise<void> {
  await db
    .update(workflowExecutions)
    .set({ status: 'failed', error, completedAt: new Date() })
    .where(eq(workflowExecutions.id, executionId));
  const exec = await db.query.workflowExecutions.findFirst({
    where: eq(workflowExecutions.id, executionId),
  });
  publishRealtimeEvent({
    type: 'execution.failed',
    executionId,
    workflowId: exec?.workflowId ?? '',
    workspaceId: undefined,
    data: { status: 'failed', error, mode: 'graph' },
    timestamp: new Date().toISOString(),
  });
}

// Re-export low-level helpers so tests / API can introspect graphs.
export async function loadGraph(workflowId: string): Promise<{ nodes: NodeRow[]; edges: EdgeRow[] }> {
  const [nodes, edges] = await Promise.all([
    db.query.workflowNodes.findMany({ where: eq(workflowNodes.workflowId, workflowId) }),
    db.query.workflowEdges.findMany({ where: eq(workflowEdges.workflowId, workflowId) }),
  ]);
  return { nodes, edges };
}

export async function recordExecutionVariableSet(
  executionId: string,
  nodeKey: string,
  key: string,
  value: unknown,
): Promise<void> {
  await setExecutionVariable(executionId, key, value, nodeKey);
}

// Marker to hint the unused-import linter; agentVersions linkage is for the future.
void and;
