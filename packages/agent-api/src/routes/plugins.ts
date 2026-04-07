import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../database/index.js';
import { plugins, agentPlugins, agents } from '../database/schema.js';
import { authMiddleware, encrypt, uuidSchema } from '@ai-trader/shared';
import { syncPluginManifest } from '../services/plugin-loader.js';

const pluginsRouter = new Hono();
pluginsRouter.use('/*', authMiddleware);

// GET / — list plugins (admin sees all, users see only allowed)
pluginsRouter.get('/', async (c) => {
  const user = c.get('user');
  const admin = user.role === 'admin';

  const allPlugins = await db.query.plugins.findMany({
    columns: { githubTokenEncrypted: false },
  });

  const result = admin ? allPlugins : allPlugins.filter((p) => p.isAllowed);
  return c.json({ plugins: result });
});

// POST / — register plugin (admin only)
const createPluginSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  gitRepoUrl: z.string().url().max(500),
  gitBranch: z.string().max(100).default('main'),
  githubToken: z.string().max(500).optional(),
  isAllowed: z.boolean().default(false),
});

pluginsRouter.post('/', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') return c.json({ error: 'Admin access required' }, 403);

  const body = createPluginSchema.parse(await c.req.json());

  const [plugin] = await db
    .insert(plugins)
    .values({
      name: body.name,
      description: body.description,
      gitRepoUrl: body.gitRepoUrl,
      gitBranch: body.gitBranch,
      githubTokenEncrypted: body.githubToken ? encrypt(body.githubToken) : null,
      isAllowed: body.isAllowed,
      createdBy: user.userId,
    })
    .returning();

  // Try to sync manifest in background (best-effort)
  try {
    await syncPluginManifest(plugin.id);
  } catch {
    // Will retry on next sync call
  }

  return c.json({ plugin: { ...plugin, githubTokenEncrypted: undefined } }, 201);
});

// GET /:id — plugin detail
pluginsRouter.get('/:id', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));

  const plugin = await db.query.plugins.findFirst({
    where: eq(plugins.id, id),
    columns: { githubTokenEncrypted: false },
  });

  if (!plugin) return c.json({ error: 'Plugin not found' }, 404);

  const admin = user.role === 'admin';
  if (!admin && !plugin.isAllowed) return c.json({ error: 'Plugin not found' }, 404);

  return c.json({ plugin });
});

// PUT /:id — update plugin (admin only)
const updatePluginSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  gitRepoUrl: z.string().url().max(500).optional(),
  gitBranch: z.string().max(100).optional(),
  githubToken: z.string().max(500).optional(),
  isAllowed: z.boolean().optional(),
});

pluginsRouter.put('/:id', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') return c.json({ error: 'Admin access required' }, 403);

  const id = uuidSchema.parse(c.req.param('id'));
  const body = updatePluginSchema.parse(await c.req.json());

  const existing = await db.query.plugins.findFirst({ where: eq(plugins.id, id) });
  if (!existing) return c.json({ error: 'Plugin not found' }, 404);

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.gitRepoUrl !== undefined) updateData.gitRepoUrl = body.gitRepoUrl;
  if (body.gitBranch !== undefined) updateData.gitBranch = body.gitBranch;
  if (body.githubToken) updateData.githubTokenEncrypted = encrypt(body.githubToken);
  if (body.isAllowed !== undefined) updateData.isAllowed = body.isAllowed;

  const [updated] = await db
    .update(plugins)
    .set(updateData)
    .where(eq(plugins.id, id))
    .returning();

  return c.json({ plugin: { ...updated, githubTokenEncrypted: undefined } });
});

// DELETE /:id — remove plugin (admin only)
pluginsRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') return c.json({ error: 'Admin access required' }, 403);

  const id = uuidSchema.parse(c.req.param('id'));
  const existing = await db.query.plugins.findFirst({ where: eq(plugins.id, id) });
  if (!existing) return c.json({ error: 'Plugin not found' }, 404);

  await db.delete(plugins).where(eq(plugins.id, id));
  return c.json({ success: true });
});

// POST /:id/sync — re-clone and refresh manifest cache (admin only)
pluginsRouter.post('/:id/sync', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') return c.json({ error: 'Admin access required' }, 403);

  const id = uuidSchema.parse(c.req.param('id'));
  const existing = await db.query.plugins.findFirst({ where: eq(plugins.id, id) });
  if (!existing) return c.json({ error: 'Plugin not found' }, 404);

  const manifest = await syncPluginManifest(id);
  return c.json({ success: true, manifest });
});

// ═══════════════════════════════════════════════════════════════════════
// Agent Plugin Toggles — nested under /api/plugins/agent/:agentId
// ═══════════════════════════════════════════════════════════════════════

// GET /agent/:agentId — list plugins with enabled status for an agent
pluginsRouter.get('/agent/:agentId', async (c) => {
  const user = c.get('user');
  const agentId = uuidSchema.parse(c.req.param('agentId'));

  // Verify agent ownership
  const agent = await db.query.agents.findFirst({
    where: and(eq(agents.id, agentId), eq(agents.userId, user.userId)),
  });
  if (!agent) return c.json({ error: 'Agent not found' }, 404);

  // Get all allowed plugins
  const allPlugins = await db.query.plugins.findMany({
    where: eq(plugins.isAllowed, true),
    columns: { githubTokenEncrypted: false },
  });

  // Get agent's plugin toggles
  const agentPluginList = await db.query.agentPlugins.findMany({
    where: eq(agentPlugins.agentId, agentId),
  });
  const enabledMap = new Map(agentPluginList.map((ap) => [ap.pluginId, ap.isEnabled]));

  const result = allPlugins.map((p) => ({
    ...p,
    isEnabled: enabledMap.get(p.id) ?? false,
    agentPluginId: agentPluginList.find((ap) => ap.pluginId === p.id)?.id ?? null,
  }));

  return c.json({ plugins: result });
});

// PUT /agent/:agentId/:pluginId — enable/disable plugin for agent
pluginsRouter.put('/agent/:agentId/:pluginId', async (c) => {
  const user = c.get('user');
  const agentId = uuidSchema.parse(c.req.param('agentId'));
  const pluginId = uuidSchema.parse(c.req.param('pluginId'));

  // Verify agent ownership
  const agent = await db.query.agents.findFirst({
    where: and(eq(agents.id, agentId), eq(agents.userId, user.userId)),
  });
  if (!agent) return c.json({ error: 'Agent not found' }, 404);

  // Verify plugin exists and is allowed
  const plugin = await db.query.plugins.findFirst({ where: eq(plugins.id, pluginId) });
  if (!plugin || !plugin.isAllowed) return c.json({ error: 'Plugin not found or not allowed' }, 404);

  const body = z.object({ isEnabled: z.boolean() }).parse(await c.req.json());

  // Upsert agent_plugins record
  const existing = await db.query.agentPlugins.findFirst({
    where: and(eq(agentPlugins.agentId, agentId), eq(agentPlugins.pluginId, pluginId)),
  });

  if (existing) {
    await db
      .update(agentPlugins)
      .set({ isEnabled: body.isEnabled })
      .where(eq(agentPlugins.id, existing.id));
  } else {
    await db.insert(agentPlugins).values({
      agentId,
      pluginId,
      isEnabled: body.isEnabled,
    });
  }

  return c.json({ success: true, isEnabled: body.isEnabled });
});

export default pluginsRouter;
