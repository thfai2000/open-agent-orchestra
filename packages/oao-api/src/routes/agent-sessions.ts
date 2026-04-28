/**
 * Generic answer endpoint for the unified `ask_questions` flow.
 *
 * Both conversations and workflow steps can pause on `ask_questions`. The
 * frontend posts to a single endpoint and the backend resolves the registry
 * entry using `${contextType}:${contextId}` as the lookup key.
 *
 * Auth scoping:
 *  - For `conversation`: the conversation must belong to the user (or workspace owner).
 *  - For `workflow_step`: the step's parent workflowExecution must belong to the user's workspace.
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { authMiddleware } from '@oao/shared';
import { db } from '../database/index.js';
import { conversations, stepExecutions, workflowExecutions, workflows, nodeExecutions } from '../database/schema.js';
import { hasPendingQuestion, resolveQuestion } from '../services/question-registry.js';

const router = new Hono();
router.use('/*', authMiddleware);

const answerSchema = z.object({
  contextType: z.enum(['conversation', 'workflow_step']),
  contextId: z.string().uuid(),
  askId: z.string().min(1),
  answers: z.record(z.string(), z.union([
    z.string(),
    z.array(z.string()),
    z.object({ value: z.union([z.string(), z.array(z.string())]), other: z.string().optional() }),
  ])),
});

router.post('/answer', async (c) => {
  const user = c.get('user');
  if (!user.workspaceId) return c.json({ error: 'No workspace selected' }, 400);

  const body = answerSchema.parse(await c.req.json());

  // Authorize based on context type.
  if (body.contextType === 'conversation') {
    const conv = await db.query.conversations.findFirst({
      where: eq(conversations.id, body.contextId),
      columns: { id: true, workspaceId: true, userId: true },
    });
    if (!conv) return c.json({ error: 'Conversation not found' }, 404);
    if (conv.workspaceId !== user.workspaceId) return c.json({ error: 'Forbidden' }, 403);
  } else {
    const step = await db.query.stepExecutions.findFirst({
      where: eq(stepExecutions.id, body.contextId),
      columns: { id: true, workflowExecutionId: true },
    });
    const node = step
      ? null
      : await db.query.nodeExecutions.findFirst({
          where: eq(nodeExecutions.id, body.contextId),
          columns: { id: true, workflowExecutionId: true },
        });
    if (!step && !node) return c.json({ error: 'Step execution not found' }, 404);
    const exec = await db.query.workflowExecutions.findFirst({
      where: eq(workflowExecutions.id, (step ?? node)!.workflowExecutionId),
      columns: { id: true, workflowId: true },
    });
    if (!exec) return c.json({ error: 'Execution not found' }, 404);
    const wf = await db.query.workflows.findFirst({
      where: eq(workflows.id, exec.workflowId),
      columns: { id: true, workspaceId: true },
    });
    if (!wf || wf.workspaceId !== user.workspaceId) return c.json({ error: 'Forbidden' }, 403);
  }

  const registryKey = body.contextType === 'conversation'
    ? body.contextId
    : `step:${body.contextId}`;

  if (!hasPendingQuestion(registryKey, body.askId)) {
    return c.json({ error: 'No pending question matches that askId. It may have already been answered or timed out.' }, 404);
  }

  const ok = resolveQuestion(registryKey, body.askId, body.answers);
  if (!ok) return c.json({ error: 'Pending question disappeared before the answer could be applied.' }, 409);
  return c.json({ ok: true });
});

export default router;
