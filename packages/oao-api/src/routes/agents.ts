import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq, and, or, desc, sql } from 'drizzle-orm';
import { db } from '../database/index.js';
import { agents, agentFiles, mcpServerConfigs } from '../database/schema.js';
import { authMiddleware, encrypt } from '@oao/shared';
import {
  BUILTIN_TOOL_NAMES,
} from '../services/agent-tool-selection.js';
import { resolveAgentToolCatalog } from '../services/agent-tool-catalog.js';
import { emitEvent, EVENT_NAMES } from '../services/system-events.js';
import {
  buildDefaultPlatformMcpServerValues,
} from '../services/platform-mcp.js';
import {
  captureAgentHistoricalVersion,
  getAgentVersionView,
  listAgentVersionViews,
} from '../services/versioning.js';

/* ────────────────── shared schemas ────────────────── */

const ErrorResponse = z.object({ error: z.string() });

const IdParam = z.object({
  id: z.string().uuid().openapi({ description: 'Agent UUID' }),
});

const PaginationQuery = z.object({
  page: z.string().optional().openapi({ description: 'Page number (default: 1)' }),
  limit: z.string().optional().openapi({ description: 'Items per page (default: 50, max: 100)' }),
});

/* ────────────────── agent-specific schemas ────────────────── */

const ExplicitToolSelectionSchema = z.object({
  mode: z.literal('explicit'),
  names: z.array(z.string().min(1)).default([]),
});

const AgentToolSelectionSchema = z.union([
  z.array(z.string().min(1)),
  ExplicitToolSelectionSchema,
]);

const agentFileSchema = z.object({
  filePath: z.string().min(1).max(500),
  content: z.string(),
});

const CreateAgentBody = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  sourceType: z.enum(['github_repo', 'database']).default('github_repo'),
  gitRepoUrl: z.string().url().max(500).optional(),
  gitBranch: z.string().max(100).default('main'),
  agentFilePath: z.string().min(1).max(300).optional(),
  skillsPaths: z.array(z.string().max(300)).max(20).default([]),
  skillsDirectory: z.string().max(300).optional(),
  githubToken: z.string().max(500).optional(),
  githubTokenCredentialId: z.string().uuid().optional(),
  copilotTokenCredentialId: z.string().uuid().optional(),
  scope: z.enum(['user', 'workspace']).default('user'),
  builtinToolsEnabled: AgentToolSelectionSchema.default([...BUILTIN_TOOL_NAMES]),
  mcpJsonTemplate: z.string().max(50000).optional(),
  files: z.array(agentFileSchema).max(50).default([]),
}).refine(
  (data) => {
    if (data.sourceType === 'github_repo') {
      return !!data.gitRepoUrl && !!data.agentFilePath;
    }
    return true;
  },
  { message: 'gitRepoUrl and agentFilePath are required for github_repo source type' },
).refine(
  (data) => new Set(data.files.map((file) => file.filePath)).size === data.files.length,
  { message: 'Duplicate agent file paths are not allowed' },
);

const UpdateAgentBody = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  sourceType: z.enum(['github_repo', 'database']).optional(),
  gitRepoUrl: z.string().url().max(500).optional(),
  gitBranch: z.string().max(100).optional(),
  agentFilePath: z.string().min(1).max(300).optional(),
  skillsPaths: z.array(z.string().max(300)).max(20).optional(),
  skillsDirectory: z.string().max(300).nullable().optional(),
  githubToken: z.string().max(500).optional(),
  githubTokenCredentialId: z.string().uuid().nullable().optional(),
  copilotTokenCredentialId: z.string().uuid().nullable().optional(),
  status: z.enum(['active', 'paused']).optional(),
  builtinToolsEnabled: AgentToolSelectionSchema.optional(),
  mcpJsonTemplate: z.string().max(50000).nullable().optional(),
});

/* ────────────────── route definitions (single source of truth) ────────────────── */

const listAgentsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Agents'],
  summary: 'List agents',
  description: 'Agents visible to the current user: own user-scoped + workspace-scoped.',
  request: { query: PaginationQuery },
  responses: {
    200: {
      description: 'Paginated agent list',
      content: { 'application/json': { schema: z.object({
        agents: z.array(z.any()),
        total: z.number(),
        page: z.number(),
        limit: z.number(),
      }) } },
    },
  },
});

const createAgentRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Agents'],
  summary: 'Create agent',
  request: { body: { content: { 'application/json': { schema: CreateAgentBody } } } },
  responses: {
    201: { description: 'Agent created', content: { 'application/json': { schema: z.object({ agent: z.any() }) } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

const getAgentRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Agents'],
  summary: 'Get agent detail',
  request: { params: IdParam },
  responses: {
    200: { description: 'Agent detail', content: { 'application/json': { schema: z.object({ agent: z.any() }) } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

const inspectAgentToolCatalogRoute = createRoute({
  method: 'post',
  path: '/{id}/tool-catalog',
  tags: ['Agents'],
  summary: 'Inspect agent tool catalog',
  description: 'Resolve grouped built-in and MCP tools for the agent editor, including mcp.json.template overrides.',
  request: {
    params: IdParam,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            mcpJsonTemplate: z.string().max(50000).nullable().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Grouped tool catalog for the agent editor',
      content: {
        'application/json': {
          schema: z.object({
            selectionMode: z.enum(['legacy', 'explicit']),
            effectiveSelectedToolNames: z.array(z.string()),
            unresolvedSelectedToolNames: z.array(z.string()),
            groups: z.array(z.any()),
          }),
        },
      },
    },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

const previewAgentToolCatalogRoute = createRoute({
  method: 'post',
  path: '/tool-catalog',
  tags: ['Agents'],
  summary: 'Inspect new-agent tool catalog',
  description: 'Resolve grouped built-in and MCP tools for the create-agent page before the agent is saved.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            mcpJsonTemplate: z.string().max(50000).nullable().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Grouped tool catalog for the create-agent page',
      content: {
        'application/json': {
          schema: z.object({
            selectionMode: z.enum(['legacy', 'explicit']),
            defaultSelectedToolNames: z.array(z.string()),
            effectiveSelectedToolNames: z.array(z.string()),
            unresolvedSelectedToolNames: z.array(z.string()),
            groups: z.array(z.any()),
          }),
        },
      },
    },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

const updateAgentRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Agents'],
  summary: 'Update agent',
  description: 'Auto-increments version and creates a snapshot for audit trail.',
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: UpdateAgentBody } } },
  },
  responses: {
    200: { description: 'Agent updated', content: { 'application/json': { schema: z.object({ agent: z.any() }) } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

const deleteAgentRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Agents'],
  summary: 'Delete agent',
  request: { params: IdParam },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: z.object({ success: z.boolean() }) } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

const listVersionsRoute = createRoute({
  method: 'get',
  path: '/{id}/versions',
  tags: ['Agent Versions'],
  summary: 'List agent version history',
  request: { params: IdParam, query: PaginationQuery },
  responses: {
    200: {
      description: 'Paginated version list',
      content: { 'application/json': { schema: z.object({
        versions: z.array(z.any()),
        total: z.number(),
        page: z.number(),
        limit: z.number(),
      }) } },
    },
    404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

const getVersionRoute = createRoute({
  method: 'get',
  path: '/{id}/versions/{version}',
  tags: ['Agent Versions'],
  summary: 'Get agent version snapshot',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ description: 'Agent UUID' }),
      version: z.string().openapi({ description: 'Version number' }),
    }),
  },
  responses: {
    200: { description: 'Version snapshot', content: { 'application/json': { schema: z.object({ version: z.any() }) } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

/* ────────────────── router + handlers ────────────────── */

const agentsRouter = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json({ error: 'Validation failed', details: result.error.issues }, 400);
    }
  },
});
agentsRouter.use('/*', authMiddleware);

function canManageAgent(
  agent: typeof agents.$inferSelect,
  user: { userId: string; workspaceId?: string | null; role: string },
) {
  if (agent.workspaceId !== user.workspaceId) {
    return false;
  }

  if (user.role === 'view_user') {
    return false;
  }

  if (agent.scope === 'workspace') {
    return user.role === 'workspace_admin' || user.role === 'super_admin';
  }

  return agent.userId === user.userId || user.role === 'workspace_admin' || user.role === 'super_admin';
}

// GET / — list agents visible to user: user-scoped (own) + workspace-scoped
agentsRouter.openapi(listAgentsRoute, async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = (c as any).get('user');
  if (!user.workspaceId) return c.json({ agents: [], total: 0, page: 1, limit: 50 }, 200);

  const { page: pageStr, limit: limitStr } = c.req.valid('query');
  const page = Math.max(1, Number(pageStr || 1));
  const limit = Math.min(100, Math.max(1, Number(limitStr || 50)));
  const offset = (page - 1) * limit;

  const whereClause = and(
    eq(agents.workspaceId, user.workspaceId),
    or(
      eq(agents.scope, 'workspace'),
      eq(agents.userId, user.userId),
    ),
  );

  const [agentList, countResult] = await Promise.all([
    db.query.agents.findMany({
      where: whereClause,
      columns: { githubTokenEncrypted: false },
      orderBy: desc(agents.createdAt),
      limit,
      offset,
    }),
    db.select({ count: sql<number>`count(*)::int` }).from(agents).where(whereClause),
  ]);

  return c.json({ agents: agentList, total: countResult[0]?.count ?? 0, page, limit });
});

// POST / — create agent
agentsRouter.openapi(createAgentRoute, async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = (c as any).get('user');
  if (!user.workspaceId) return c.json({ error: 'No workspace context' }, 403);
  const workspaceId = user.workspaceId;
  if (user.role === 'view_user') return c.json({ error: 'View-only users cannot create agents' }, 403);

  const body = c.req.valid('json');

  // Only workspace_admin/super_admin can create workspace-scoped agents
  if (body.scope === 'workspace' && user.role !== 'workspace_admin' && user.role !== 'super_admin') {
    return c.json({ error: 'Only admins can create workspace-level agents' }, 403);
  }

  const agent = await db.transaction(async (tx) => {
    const [createdAgent] = await tx
      .insert(agents)
      .values({
        workspaceId,
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
        githubTokenCredentialId: body.githubTokenCredentialId ?? null,
        copilotTokenCredentialId: body.copilotTokenCredentialId ?? null,
        builtinToolsEnabled: body.builtinToolsEnabled,
        mcpJsonTemplate: body.mcpJsonTemplate ?? null,
      })
      .returning();

    if (body.sourceType === 'database' && body.files.length > 0) {
      await tx
        .insert(agentFiles)
        .values(body.files.map((file) => ({
          agentId: createdAgent.id,
          filePath: file.filePath,
          content: file.content,
        })));
    }

    await tx.insert(mcpServerConfigs).values(buildDefaultPlatformMcpServerValues(createdAgent.id));

    return createdAgent;
  });

  emitEvent({
    eventScope: body.scope === 'workspace' ? 'workspace' : 'user',
    scopeId: body.scope === 'workspace' ? workspaceId : user.userId,
    eventName: EVENT_NAMES.AGENT_CREATED,
    eventData: { agentId: agent.id, agentName: agent.name, scope: body.scope },
    actorId: user.userId,
  });

  return c.json(
    {
      agent: {
        ...agent,
        githubTokenEncrypted: undefined,
        hasInlineGitToken: Boolean(agent.githubTokenEncrypted),
      },
    },
    201,
  );
});

agentsRouter.openapi(previewAgentToolCatalogRoute, async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  if (!user.workspaceId) return c.json({ error: 'No workspace context' }, 403);

  const previewAgentId = `preview-${user.userId}`;
  const toolCatalog = await resolveAgentToolCatalog({
    agent: {
      id: previewAgentId,
      mcpJsonTemplate: null,
    },
    userId: user.userId,
    workspaceId: user.workspaceId,
    defaultSelectionValue: [...BUILTIN_TOOL_NAMES],
    mcpJsonTemplateOverride: body.mcpJsonTemplate,
    logContext: 'agent-tool-catalog-preview',
  });

  return c.json(toolCatalog, 200);
});

// GET /:id — agent detail
agentsRouter.openapi(getAgentRoute, async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = (c as any).get('user');
  const { id } = c.req.valid('param');

  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, id),
  });

  if (!agent) return c.json({ error: 'Agent not found' }, 404);
  if (agent.workspaceId !== user.workspaceId) return c.json({ error: 'Forbidden' }, 403);

  return c.json({
    agent: {
      ...agent,
      githubTokenEncrypted: undefined,
      hasInlineGitToken: Boolean(agent.githubTokenEncrypted),
    },
  }, 200);
});

agentsRouter.openapi(inspectAgentToolCatalogRoute, async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const agent = await db.query.agents.findFirst({ where: eq(agents.id, id) });
  if (!agent) return c.json({ error: 'Agent not found' }, 404);
  if (!canManageAgent(agent, user)) return c.json({ error: 'Forbidden' }, 403);
  if (!user.workspaceId) return c.json({ error: 'No workspace context' }, 403);

  const toolCatalog = await resolveAgentToolCatalog({
    agent: {
      id: agent.id,
      mcpJsonTemplate: agent.mcpJsonTemplate,
    },
    userId: user.userId,
    workspaceId: user.workspaceId,
    defaultSelectionValue: agent.builtinToolsEnabled,
    mcpJsonTemplateOverride: body.mcpJsonTemplate,
    logContext: 'agent-tool-catalog',
  });

  return c.json(toolCatalog, 200);
});

// PUT /:id — update agent
agentsRouter.openapi(updateAgentRoute, async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = (c as any).get('user');
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

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
  if (body.githubToken) {
    updateData.githubTokenEncrypted = encrypt(body.githubToken);
    // Clear credential reference when switching to inline token
    updateData.githubTokenCredentialId = null;
  }
  if (body.githubTokenCredentialId !== undefined) {
    updateData.githubTokenCredentialId = body.githubTokenCredentialId;
    // Explicit Git auth selection always replaces any legacy inline token.
    updateData.githubTokenEncrypted = null;
  }
  if (body.copilotTokenCredentialId !== undefined) {
    updateData.copilotTokenCredentialId = body.copilotTokenCredentialId;
  }
  if (body.status) updateData.status = body.status;
  if (body.builtinToolsEnabled !== undefined) updateData.builtinToolsEnabled = body.builtinToolsEnabled;
  if (body.mcpJsonTemplate !== undefined) updateData.mcpJsonTemplate = body.mcpJsonTemplate;

  // Auto-increment version on any update
  updateData.version = sql`${agents.version} + 1`;

  await captureAgentHistoricalVersion(existing, user.userId);

  const [updated] = await db.update(agents).set(updateData).where(eq(agents.id, id)).returning();

  emitEvent({
    eventScope: existing.scope === 'workspace' ? 'workspace' : 'user',
    scopeId: existing.scope === 'workspace' ? existing.workspaceId : existing.userId,
    eventName: body.status ? EVENT_NAMES.AGENT_STATUS_CHANGED : EVENT_NAMES.AGENT_UPDATED,
    eventData: { agentId: id, changes: Object.keys(body) },
    actorId: user.userId,
  });

  return c.json({
    agent: {
      ...updated,
      githubTokenEncrypted: undefined,
      hasInlineGitToken: Boolean(updated.githubTokenEncrypted),
    },
  }, 200);
});

// DELETE /:id — delete agent
agentsRouter.openapi(deleteAgentRoute, async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = (c as any).get('user');
  const { id } = c.req.valid('param');

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

  return c.json({ success: true }, 200);
});

// GET /:id/versions — list agent version history
agentsRouter.openapi(listVersionsRoute, async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = (c as any).get('user');
  const { id } = c.req.valid('param');
  const { page: pageStr, limit: limitStr } = c.req.valid('query');

  const agent = await db.query.agents.findFirst({ where: eq(agents.id, id) });
  if (!agent) return c.json({ error: 'Agent not found' }, 404);
  if (agent.workspaceId !== user.workspaceId) return c.json({ error: 'Forbidden' }, 404);

  const page = Math.max(1, Number(pageStr || 1));
  const limit = Math.min(100, Math.max(1, Number(limitStr || 50)));
  const versions = await listAgentVersionViews(agent);
  const offset = (page - 1) * limit;

  return c.json({
    versions: versions.slice(offset, offset + limit),
    total: versions.length,
    page,
    limit,
  }, 200);
});

// GET /:id/versions/:version — get specific agent version snapshot
agentsRouter.openapi(getVersionRoute, async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = (c as any).get('user');
  const { id, version: versionStr } = c.req.valid('param');
  const versionNum = Number(versionStr);

  if (!Number.isInteger(versionNum) || versionNum < 1) {
    return c.json({ error: 'Invalid version number' }, 404);
  }

  const agent = await db.query.agents.findFirst({ where: eq(agents.id, id) });
  if (!agent) return c.json({ error: 'Agent not found' }, 404);
  if (agent.workspaceId !== user.workspaceId) return c.json({ error: 'Forbidden' }, 404);

  const versionRecord = await getAgentVersionView(agent, versionNum);

  if (!versionRecord) return c.json({ error: 'Version not found' }, 404);

  return c.json({ version: versionRecord }, 200);
});

export default agentsRouter;
