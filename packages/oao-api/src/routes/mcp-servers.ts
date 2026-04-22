import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../database/index.js';
import { mcpServerConfigs, agents } from '../database/schema.js';
import { authMiddleware, uuidSchema } from '@oao/shared';
import {
  ensureDefaultPlatformMcpServerConfig,
  PLATFORM_MCP_SERVER_TYPE,
} from '../services/platform-mcp.js';

const mcpServersRouter = new Hono();
mcpServersRouter.use('/*', authMiddleware);

function canManageAgentMcpServers(
  agent: typeof agents.$inferSelect,
  user: { userId: string; workspaceId?: string | null; role: string },
) {
  if (agent.workspaceId !== user.workspaceId) {
    return false;
  }

  if (agent.scope === 'workspace') {
    return user.role === 'workspace_admin' || user.role === 'super_admin';
  }

  return agent.userId === user.userId || user.role === 'workspace_admin' || user.role === 'super_admin';
}

// GET / — list MCP server configs for an agent
mcpServersRouter.get('/', async (c) => {
  const user = c.get('user');
  const agentId = c.req.query('agentId');
  if (!agentId || !uuidSchema.safeParse(agentId).success) {
    return c.json({ error: 'Valid agentId query parameter is required' }, 400);
  }

  const agent = await db.query.agents.findFirst({ where: eq(agents.id, agentId) });
  if (!agent || !canManageAgentMcpServers(agent, user)) return c.json({ error: 'Agent not found' }, 404);

  await ensureDefaultPlatformMcpServerConfig(agentId);

  const configs = await db.query.mcpServerConfigs.findMany({
    where: eq(mcpServerConfigs.agentId, agentId),
  });
  return c.json({ mcpServers: configs });
});

// POST / — add MCP server config to an agent
const createMcpServerSchema = z.object({
  agentId: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  command: z.string().min(1).max(200),
  args: z.array(z.string()).default([]),
  envMapping: z.record(z.string()).default({}),
  isEnabled: z.boolean().default(true),
  writeTools: z.array(z.string()).default([]),
});

mcpServersRouter.post('/', async (c) => {
  const user = c.get('user');
  if (user.role === 'view_user') return c.json({ error: 'View-only users cannot create MCP server configs' }, 403);
  const body = await c.req.json();
  const parsed = createMcpServerSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const agent = await db.query.agents.findFirst({ where: eq(agents.id, parsed.data.agentId) });
  if (!agent || !canManageAgentMcpServers(agent, user)) return c.json({ error: 'Agent not found' }, 404);

  const [config] = await db
    .insert(mcpServerConfigs)
    .values({
      agentId: parsed.data.agentId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      command: parsed.data.command,
      args: parsed.data.args,
      envMapping: parsed.data.envMapping,
      isEnabled: parsed.data.isEnabled,
      writeTools: parsed.data.writeTools,
    })
    .returning();

  return c.json({ mcpServer: config }, 201);
});

// PUT /:id — update MCP server config
const updateMcpServerSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  command: z.string().min(1).max(200).optional(),
  args: z.array(z.string()).optional(),
  envMapping: z.record(z.string()).optional(),
  isEnabled: z.boolean().optional(),
  writeTools: z.array(z.string()).optional(),
});

mcpServersRouter.put('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  if (!uuidSchema.safeParse(id).success) return c.json({ error: 'Invalid ID' }, 400);
  if (user.role === 'view_user') return c.json({ error: 'View-only users cannot update MCP server configs' }, 403);

  const body = await c.req.json();
  const parsed = updateMcpServerSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  // Find config and verify ownership
  const existing = await db.query.mcpServerConfigs.findFirst({
    where: eq(mcpServerConfigs.id, id),
  });
  if (!existing) return c.json({ error: 'MCP server config not found' }, 404);

  const agent = await db.query.agents.findFirst({ where: eq(agents.id, existing.agentId) });
  if (!agent || !canManageAgentMcpServers(agent, user)) return c.json({ error: 'Agent not found' }, 404);

  if (existing.serverType === PLATFORM_MCP_SERVER_TYPE) {
    if (
      parsed.data.name !== undefined ||
      parsed.data.description !== undefined ||
      parsed.data.command !== undefined ||
      parsed.data.args !== undefined ||
      parsed.data.envMapping !== undefined ||
      parsed.data.writeTools !== undefined
    ) {
      return c.json({ error: 'The default OAO Platform MCP server is system-managed. Only enable or disable it.' }, 400);
    }
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.command !== undefined) updates.command = parsed.data.command;
  if (parsed.data.args !== undefined) updates.args = parsed.data.args;
  if (parsed.data.envMapping !== undefined) updates.envMapping = parsed.data.envMapping;
  if (parsed.data.isEnabled !== undefined) updates.isEnabled = parsed.data.isEnabled;
  if (parsed.data.writeTools !== undefined) updates.writeTools = parsed.data.writeTools;

  const [updated] = await db
    .update(mcpServerConfigs)
    .set(updates)
    .where(eq(mcpServerConfigs.id, id))
    .returning();

  return c.json({ mcpServer: updated });
});

// DELETE /:id — remove MCP server config
mcpServersRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  if (!uuidSchema.safeParse(id).success) return c.json({ error: 'Invalid ID' }, 400);
  if (user.role === 'view_user') return c.json({ error: 'View-only users cannot delete MCP server configs' }, 403);

  // Find config and verify ownership
  const existing = await db.query.mcpServerConfigs.findFirst({
    where: eq(mcpServerConfigs.id, id),
  });
  if (!existing) return c.json({ error: 'MCP server config not found' }, 404);

  if (existing.serverType === PLATFORM_MCP_SERVER_TYPE) {
    return c.json({ error: 'The default OAO Platform MCP server cannot be deleted. Disable it instead.' }, 400);
  }

  const agent = await db.query.agents.findFirst({ where: eq(agents.id, existing.agentId) });
  if (!agent || !canManageAgentMcpServers(agent, user)) return c.json({ error: 'Agent not found' }, 404);

  await db.delete(mcpServerConfigs).where(eq(mcpServerConfigs.id, id));
  return c.json({ deleted: true });
});

export default mcpServersRouter;
