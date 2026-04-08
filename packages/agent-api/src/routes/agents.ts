import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, or } from 'drizzle-orm';
import { db } from '../database/index.js';
import { agents } from '../database/schema.js';
import { authMiddleware, encrypt, uuidSchema } from '@ai-trader/shared';
import { emitEvent, EVENT_NAMES } from '../services/system-events.js';

const agentsRouter = new Hono();
agentsRouter.use('/*', authMiddleware);

// GET / — list agents visible to user: user-scoped (own) + workspace-scoped
agentsRouter.get('/', async (c) => {
  const user = c.get('user');
  if (!user.workspaceId) return c.json({ agents: [] });

  const agentList = await db.query.agents.findMany({
    where: and(
      eq(agents.workspaceId, user.workspaceId),
      or(
        eq(agents.scope, 'workspace'),
        eq(agents.userId, user.userId),
      ),
    ),
    columns: {
      githubTokenEncrypted: false,
    },
  });
  return c.json({ agents: agentList });
});

// POST / — create agent
const BUILTIN_TOOL_NAMES = [
  'schedule_next_workflow_execution', 'manage_webhook_trigger', 'record_decision',
  'memory_store', 'memory_retrieve',
  'edit_workflow', 'read_variables', 'edit_variables',
] as const;

const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  sourceType: z.enum(['github_repo', 'database']).default('github_repo'),
  gitRepoUrl: z.string().url().max(500).optional(),
  gitBranch: z.string().max(100).default('main'),
  agentFilePath: z.string().min(1).max(300).optional(),
  skillsPaths: z.array(z.string().max(300)).max(20).default([]),
  skillsDirectory: z.string().max(300).optional(),
  githubToken: z.string().max(500).optional(),
  scope: z.enum(['user', 'workspace']).default('user'),
  builtinToolsEnabled: z.array(z.enum(BUILTIN_TOOL_NAMES)).default([...BUILTIN_TOOL_NAMES]),
}).refine(
  (data) => {
    if (data.sourceType === 'github_repo') {
      return !!data.gitRepoUrl && !!data.agentFilePath;
    }
    return true;
  },
  { message: 'gitRepoUrl and agentFilePath are required for github_repo source type' },
);

agentsRouter.post('/', async (c) => {
  const user = c.get('user');
  if (!user.workspaceId) return c.json({ error: 'No workspace context' }, 403);
  if (user.role === 'view_user') return c.json({ error: 'View-only users cannot create agents' }, 403);

  const body = createAgentSchema.parse(await c.req.json());

  // Only workspace_admin/super_admin can create workspace-scoped agents
  if (body.scope === 'workspace' && user.role !== 'workspace_admin' && user.role !== 'super_admin') {
    return c.json({ error: 'Only admins can create workspace-level agents' }, 403);
  }

  const [agent] = await db
    .insert(agents)
    .values({
      workspaceId: user.workspaceId,
      userId: user.userId,
      scope: body.scope,
      name: body.name,
      description: body.description,
      sourceType: body.sourceType,
      gitRepoUrl: body.gitRepoUrl ?? null,
      gitBranch: body.gitBranch,
      agentFilePath: body.agentFilePath ?? null,
      skillsPaths: body.skillsPaths,
      skillsDirectory: body.skillsDirectory ?? null,
      githubTokenEncrypted: body.githubToken ? encrypt(body.githubToken) : null,
      builtinToolsEnabled: body.builtinToolsEnabled,
    })
    .returning();

  emitEvent({
    eventScope: body.scope === 'workspace' ? 'workspace' : 'user',
    scopeId: body.scope === 'workspace' ? user.workspaceId : user.userId,
    eventName: EVENT_NAMES.AGENT_CREATED,
    eventData: { agentId: agent.id, agentName: agent.name, scope: body.scope },
    actorId: user.userId,
  });

  return c.json(
    {
      agent: {
        ...agent,
        githubTokenEncrypted: undefined,
      },
    },
    201,
  );
});

// GET /:id — agent detail
agentsRouter.get('/:id', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));

  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, id),
    columns: { githubTokenEncrypted: false },
  });

  if (!agent) return c.json({ error: 'Agent not found' }, 404);
  if (agent.workspaceId !== user.workspaceId) return c.json({ error: 'Forbidden' }, 403);

  return c.json({ agent });
});

// PUT /:id — update agent
const updateAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  sourceType: z.enum(['github_repo', 'database']).optional(),
  gitRepoUrl: z.string().url().max(500).optional(),
  gitBranch: z.string().max(100).optional(),
  agentFilePath: z.string().min(1).max(300).optional(),
  skillsPaths: z.array(z.string().max(300)).max(20).optional(),
  skillsDirectory: z.string().max(300).nullable().optional(),
  githubToken: z.string().max(500).optional(),
  status: z.enum(['active', 'paused']).optional(),
  builtinToolsEnabled: z.array(z.enum(BUILTIN_TOOL_NAMES)).optional(),
});

agentsRouter.put('/:id', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));
  const body = updateAgentSchema.parse(await c.req.json());

  const existing = await db.query.agents.findFirst({ where: eq(agents.id, id) });
  if (!existing) return c.json({ error: 'Agent not found' }, 404);
  if (existing.workspaceId !== user.workspaceId) return c.json({ error: 'Forbidden' }, 403);
  if (user.role === 'view_user') return c.json({ error: 'View-only users cannot modify agents' }, 403);

  // Workspace-scoped agents can only be modified by admins
  if (existing.scope === 'workspace' && user.role !== 'workspace_admin' && user.role !== 'super_admin') {
    return c.json({ error: 'Only admins can modify workspace-level agents' }, 403);
  }
  // User-scoped agents can only be modified by the owner (or admins)
  if (existing.scope === 'user' && existing.userId !== user.userId && user.role !== 'workspace_admin' && user.role !== 'super_admin') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.sourceType) updateData.sourceType = body.sourceType;
  if (body.gitRepoUrl) updateData.gitRepoUrl = body.gitRepoUrl;
  if (body.gitBranch) updateData.gitBranch = body.gitBranch;
  if (body.agentFilePath) updateData.agentFilePath = body.agentFilePath;
  if (body.skillsPaths) updateData.skillsPaths = body.skillsPaths;
  if (body.skillsDirectory !== undefined) updateData.skillsDirectory = body.skillsDirectory;
  if (body.githubToken) updateData.githubTokenEncrypted = encrypt(body.githubToken);
  if (body.status) updateData.status = body.status;
  if (body.builtinToolsEnabled) updateData.builtinToolsEnabled = body.builtinToolsEnabled;

  const [updated] = await db.update(agents).set(updateData).where(eq(agents.id, id)).returning();

  emitEvent({
    eventScope: existing.scope === 'workspace' ? 'workspace' : 'user',
    scopeId: existing.scope === 'workspace' ? existing.workspaceId : existing.userId,
    eventName: body.status ? EVENT_NAMES.AGENT_STATUS_CHANGED : EVENT_NAMES.AGENT_UPDATED,
    eventData: { agentId: id, changes: Object.keys(body) },
    actorId: user.userId,
  });

  return c.json({
    agent: { ...updated, githubTokenEncrypted: undefined },
  });
});

// DELETE /:id — delete agent
agentsRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));

  const existing = await db.query.agents.findFirst({ where: eq(agents.id, id) });
  if (!existing) return c.json({ error: 'Agent not found' }, 404);
  if (existing.workspaceId !== user.workspaceId) return c.json({ error: 'Forbidden' }, 403);
  if (user.role === 'view_user') return c.json({ error: 'View-only users cannot delete agents' }, 403);

  // Workspace-scoped agents can only be deleted by admins
  if (existing.scope === 'workspace' && user.role !== 'workspace_admin' && user.role !== 'super_admin') {
    return c.json({ error: 'Only admins can delete workspace-level agents' }, 403);
  }
  // User-scoped agents can only be deleted by the owner (or admins)
  if (existing.scope === 'user' && existing.userId !== user.userId && user.role !== 'workspace_admin' && user.role !== 'super_admin') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  await db.delete(agents).where(eq(agents.id, id));

  emitEvent({
    eventScope: existing.scope === 'workspace' ? 'workspace' : 'user',
    scopeId: existing.scope === 'workspace' ? existing.workspaceId : existing.userId,
    eventName: EVENT_NAMES.AGENT_DELETED,
    eventData: { agentId: id, agentName: existing.name },
    actorId: user.userId,
  });

  return c.json({ success: true });
});

export default agentsRouter;
