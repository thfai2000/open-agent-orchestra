/**
 * Routes for graph workflows: node + edge CRUD, workflow-scoped variable
 * CRUD, execution-scoped variable inspection, and short-memory inspection.
 *
 * Mounted at /api/workflow-graph in server.ts.
 *
 * Authorization: workflows are workspace-scoped. We require the caller's
 * workspaceId to match the workflow's workspaceId (or the workflow scope is
 * 'workspace' and the caller has access). Mirrors the policy in routes/workflows.ts.
 */

import { Hono } from 'hono';
import { eq, and, sql } from 'drizzle-orm';
import { z } from 'zod';
import { authMiddleware, createLogger } from '@oao/shared';
import { db } from '../database/index.js';
import {
  workflows,
  workflowSteps,
  workflowNodes,
  workflowEdges,
  nodeExecutions,
  workflowExecutions,
  agentShortMemories,
  triggers,
} from '../database/schema.js';
import { serializeTriggers } from '../services/trigger-serialization.js';
import { captureWorkflowHistoricalVersion } from '../services/versioning.js';
import { buildGraphFromSequentialSteps, deriveWorkflowStepsFromGraph } from '../services/workflow-graph-sync.js';
import {
  setWorkflowVariable,
  listWorkflowVariables,
  deleteWorkflowVariable,
  listExecutionVariables,
  rememberShortMemory,
  recallShortMemory,
  listShortMemories,
  forgetShortMemory,
} from '../services/workflow-scoped-variables.js';

const logger = createLogger('workflow-graph-routes');

interface AuthedUser {
  userId: string;
  workspaceId: string | null;
  role: string;
}

const workflowGraphRouter = new Hono<{ Variables: { user: AuthedUser } }>();
workflowGraphRouter.use('/*', authMiddleware);

const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/;

async function loadWorkflowOrThrow(workflowId: string, user: AuthedUser) {
  const workflow = await db.query.workflows.findFirst({
    where: eq(workflows.id, workflowId),
  });
  if (!workflow) return null;
  if (user.role !== 'super_admin' && workflow.workspaceId !== user.workspaceId) return null;
  return workflow;
}

function canModifyWorkflow(workflow: typeof workflows.$inferSelect, user: AuthedUser): boolean {
  if (user.role === 'super_admin') return true;
  if (workflow.scope === 'workspace') return user.role === 'workspace_admin';
  return workflow.userId === user.userId || user.role === 'workspace_admin';
}

// ─── Graph CRUD ──────────────────────────────────────────────────────

const NodeInputSchema = z.object({
  nodeKey: z.string().regex(KEY_PATTERN),
  nodeType: z.enum(['start', 'end', 'agent_step', 'http_request', 'script', 'conditional', 'parallel', 'join']),
  name: z.string().min(1).max(200),
  config: z.record(z.unknown()).optional(),
  positionX: z.number().int().optional(),
  positionY: z.number().int().optional(),
});

const EdgeInputSchema = z.object({
  fromNodeKey: z.string().regex(KEY_PATTERN),
  toNodeKey: z.string().regex(KEY_PATTERN),
  branchKey: z.string().max(100).nullable().optional(),
  label: z.string().max(200).nullable().optional(),
});

const GraphReplaceSchema = z.object({
  nodes: z.array(NodeInputSchema),
  edges: z.array(EdgeInputSchema),
});

workflowGraphRouter.get('/:workflowId/graph', async (c) => {
  const user = c.get('user') as AuthedUser;
  const wf = await loadWorkflowOrThrow(c.req.param('workflowId'), user);
  if (!wf) return c.json({ error: 'Workflow not found' }, 404);
  const [savedNodes, savedEdges, steps, workflowTriggers] = await Promise.all([
    db.query.workflowNodes.findMany({ where: eq(workflowNodes.workflowId, wf.id) }),
    db.query.workflowEdges.findMany({ where: eq(workflowEdges.workflowId, wf.id) }),
    db.query.workflowSteps.findMany({ where: eq(workflowSteps.workflowId, wf.id), orderBy: workflowSteps.stepOrder }),
    db.query.triggers.findMany({ where: eq(triggers.workflowId, wf.id) }),
  ]);
  const isSyntheticFromSteps = savedNodes.length === 0 && steps.length > 0;
  const graph = isSyntheticFromSteps
    ? buildGraphFromSequentialSteps(steps)
    : { nodes: savedNodes, edges: savedEdges };
  return c.json({
    executionMode: wf.executionMode,
    nodes: graph.nodes,
    edges: graph.edges,
    steps,
    triggers: serializeTriggers(workflowTriggers),
    isSyntheticFromSteps,
  });
});

workflowGraphRouter.put('/:workflowId/graph', async (c) => {
  const user = c.get('user') as AuthedUser;
  const wf = await loadWorkflowOrThrow(c.req.param('workflowId'), user);
  if (!wf) return c.json({ error: 'Workflow not found' }, 404);
  if (!canModifyWorkflow(wf, user)) return c.json({ error: 'Forbidden' }, 403);
  const body = await c.req.json();
  const parsed = GraphReplaceSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid graph payload', details: parsed.error.flatten() }, 400);

  // Validate references between nodes/edges.
  const keys = new Set(parsed.data.nodes.map((n) => n.nodeKey));
  for (const e of parsed.data.edges) {
    if (!keys.has(e.fromNodeKey) || !keys.has(e.toNodeKey)) {
      return c.json({ error: `Edge ${e.fromNodeKey}→${e.toNodeKey} references unknown node` }, 400);
    }
  }
  const startCount = parsed.data.nodes.filter((n) => n.nodeType === 'start').length;
  if (startCount !== 1) return c.json({ error: `Graph must contain exactly 1 'start' node (found ${startCount})` }, 400);

  let replacementSteps;
  try {
    replacementSteps = deriveWorkflowStepsFromGraph(parsed.data.nodes, parsed.data.edges);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 400);
  }

  await captureWorkflowHistoricalVersion(wf, user.userId);

  // Replace nodes + edges atomically.
  await db.transaction(async (tx) => {
    await tx.delete(workflowEdges).where(eq(workflowEdges.workflowId, wf.id));
    await tx.delete(workflowNodes).where(eq(workflowNodes.workflowId, wf.id));
    if (parsed.data.nodes.length > 0) {
      await tx.insert(workflowNodes).values(
        parsed.data.nodes.map((n) => ({
          workflowId: wf.id,
          nodeKey: n.nodeKey,
          nodeType: n.nodeType,
          name: n.name,
          config: n.config ?? {},
          positionX: n.positionX ?? 0,
          positionY: n.positionY ?? 0,
        })),
      );
    }
    if (parsed.data.edges.length > 0) {
      await tx.insert(workflowEdges).values(
        parsed.data.edges.map((e) => ({
          workflowId: wf.id,
          fromNodeKey: e.fromNodeKey,
          toNodeKey: e.toNodeKey,
          branchKey: e.branchKey ?? null,
          label: e.label ?? null,
        })),
      );
    }
    await tx.delete(workflowSteps).where(eq(workflowSteps.workflowId, wf.id));
    if (replacementSteps.length > 0) {
      await tx.insert(workflowSteps).values(
        replacementSteps.map((step) => ({
          workflowId: wf.id,
          name: step.name,
          promptTemplate: step.promptTemplate,
          stepOrder: step.stepOrder,
          agentId: step.agentId,
          model: step.model,
          reasoningEffort: step.reasoningEffort,
          workerRuntime: step.workerRuntime,
          timeoutSeconds: step.timeoutSeconds,
        })),
      );
    }
    // Auto-flip executionMode → 'graph' on first save.
    await tx
      .update(workflows)
      .set({ executionMode: 'graph', version: sql`${workflows.version} + 1`, updatedAt: new Date() })
      .where(eq(workflows.id, wf.id));
  });
  logger.info({ workflowId: wf.id, nodes: parsed.data.nodes.length, edges: parsed.data.edges.length, syncedSteps: replacementSteps.length }, 'Graph replaced');
  return c.json({ ok: true, executionMode: 'graph', nodes: parsed.data.nodes.length, edges: parsed.data.edges.length, syncedSteps: replacementSteps.length });
});

// ─── Workflow-scoped variables ───────────────────────────────────────

const VariableInputSchema = z.object({
  key: z.string().regex(KEY_PATTERN),
  value: z.unknown(),
  type: z.enum(['property', 'credential', 'short_memory']).optional(),
  description: z.string().max(300).optional(),
});

workflowGraphRouter.get('/:workflowId/variables', async (c) => {
  const user = c.get('user') as AuthedUser;
  const wf = await loadWorkflowOrThrow(c.req.param('workflowId'), user);
  if (!wf) return c.json({ error: 'Workflow not found' }, 404);
  const list = await listWorkflowVariables(wf.id);
  return c.json({ variables: list });
});

workflowGraphRouter.put('/:workflowId/variables', async (c) => {
  const user = c.get('user') as AuthedUser;
  const wf = await loadWorkflowOrThrow(c.req.param('workflowId'), user);
  if (!wf) return c.json({ error: 'Workflow not found' }, 404);
  const body = await c.req.json();
  const parsed = VariableInputSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid variable', details: parsed.error.flatten() }, 400);
  await setWorkflowVariable({
    workflowId: wf.id,
    key: parsed.data.key,
    value: parsed.data.value,
    type: parsed.data.type ?? 'property',
    description: parsed.data.description,
  });
  return c.json({ ok: true });
});

workflowGraphRouter.delete('/:workflowId/variables/:key', async (c) => {
  const user = c.get('user') as AuthedUser;
  const wf = await loadWorkflowOrThrow(c.req.param('workflowId'), user);
  if (!wf) return c.json({ error: 'Workflow not found' }, 404);
  const deleted = await deleteWorkflowVariable(wf.id, c.req.param('key'));
  return c.json({ deleted });
});

// ─── Execution-scoped variable inspection ────────────────────────────

workflowGraphRouter.get('/executions/:executionId/variables', async (c) => {
  const user = c.get('user') as AuthedUser;
  const exec = await db.query.workflowExecutions.findFirst({
    where: eq(workflowExecutions.id, c.req.param('executionId')),
  });
  if (!exec) return c.json({ error: 'Execution not found' }, 404);
  const wf = await loadWorkflowOrThrow(exec.workflowId, user);
  if (!wf) return c.json({ error: 'Forbidden' }, 403);
  const variables = await listExecutionVariables(exec.id);
  return c.json({ variables });
});

workflowGraphRouter.get('/executions/:executionId/nodes', async (c) => {
  const user = c.get('user') as AuthedUser;
  const exec = await db.query.workflowExecutions.findFirst({
    where: eq(workflowExecutions.id, c.req.param('executionId')),
  });
  if (!exec) return c.json({ error: 'Execution not found' }, 404);
  const wf = await loadWorkflowOrThrow(exec.workflowId, user);
  if (!wf) return c.json({ error: 'Forbidden' }, 403);
  const rows = await db.query.nodeExecutions.findMany({
    where: eq(nodeExecutions.workflowExecutionId, exec.id),
  });
  return c.json({ nodeExecutions: rows });
});

// ─── Agent short-memory ──────────────────────────────────────────────

const ShortMemoryInputSchema = z.object({
  key: z.string().regex(KEY_PATTERN),
  value: z.unknown(),
  ttlSeconds: z.number().int().positive().max(60 * 60 * 24 * 30).optional(),
});

workflowGraphRouter.get('/agents/:agentId/short-memories', async (c) => {
  const user = c.get('user') as AuthedUser;
  const agentId = c.req.param('agentId');
  // Only allow inspecting memories that belong to caller's workspace.
  const [first] = await db
    .select({ workspaceId: agentShortMemories.workspaceId })
    .from(agentShortMemories)
    .where(eq(agentShortMemories.agentId, agentId))
    .limit(1);
  if (first && user.role !== 'super_admin' && first.workspaceId !== user.workspaceId) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const entries = await listShortMemories(agentId);
  return c.json({ entries });
});

workflowGraphRouter.put('/agents/:agentId/short-memories', async (c) => {
  const user = c.get('user') as AuthedUser;
  const agentId = c.req.param('agentId');
  const body = await c.req.json();
  const parsed = ShortMemoryInputSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid memory entry', details: parsed.error.flatten() }, 400);
  if (!user.workspaceId) return c.json({ error: 'No workspace context' }, 400);
  await rememberShortMemory(agentId, user.workspaceId, parsed.data.key, parsed.data.value, parsed.data.ttlSeconds);
  return c.json({ ok: true });
});

workflowGraphRouter.get('/agents/:agentId/short-memories/:key', async (c) => {
  const value = await recallShortMemory(c.req.param('agentId'), c.req.param('key'));
  return c.json({ key: c.req.param('key'), value: value ?? null, found: value !== undefined });
});

workflowGraphRouter.delete('/agents/:agentId/short-memories/:key', async (c) => {
  const deleted = await forgetShortMemory(c.req.param('agentId'), c.req.param('key'));
  return c.json({ deleted });
});

// Marker for unused imports in some build configs.
void and;

export default workflowGraphRouter;
