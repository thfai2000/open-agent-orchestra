import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../database/index.js';
import { agentFiles, agents } from '../database/schema.js';
import { authMiddleware, uuidSchema } from '@oao/shared';
import { captureAgentHistoricalVersion } from '../services/versioning.js';

const agentFilesRouter = new Hono();
agentFilesRouter.use('/*', authMiddleware);

// GET /:agentId — list files for an agent
agentFilesRouter.get('/:agentId', async (c) => {
  const user = c.get('user');
  const agentId = uuidSchema.parse(c.req.param('agentId'));

  const agent = await db.query.agents.findFirst({ where: eq(agents.id, agentId) });
  if (!agent) return c.json({ error: 'Agent not found' }, 404);
  if (agent.workspaceId !== user.workspaceId) return c.json({ error: 'Forbidden' }, 403);

  const files = await db.query.agentFiles.findMany({
    where: eq(agentFiles.agentId, agentId),
    orderBy: agentFiles.filePath,
  });

  return c.json({ files });
});

// POST /:agentId — create a file
const createFileSchema = z.object({
  filePath: z.string().min(1).max(500)
    .refine((p) => !p.includes('..'), 'Path traversal not allowed')
    .refine((p) => !p.startsWith('/'), 'Absolute paths not allowed'),
  content: z.string(),
});

agentFilesRouter.post('/:agentId', async (c) => {
  const user = c.get('user');
  const agentId = uuidSchema.parse(c.req.param('agentId'));
  if (user.role === 'view_user') return c.json({ error: 'View-only users cannot create files' }, 403);

  const agent = await db.query.agents.findFirst({ where: eq(agents.id, agentId) });
  if (!agent) return c.json({ error: 'Agent not found' }, 404);
  if (agent.workspaceId !== user.workspaceId) return c.json({ error: 'Forbidden' }, 403);
  if (agent.sourceType !== 'database') return c.json({ error: 'Agent files can only be managed for database source agents' }, 400);

  const body = createFileSchema.parse(await c.req.json());

  // Check for duplicate file path
  const existing = await db.query.agentFiles.findFirst({
    where: and(eq(agentFiles.agentId, agentId), eq(agentFiles.filePath, body.filePath)),
  });
  if (existing) return c.json({ error: 'File already exists at this path' }, 409);

  await captureAgentHistoricalVersion(agent, user.userId);

  const [file] = await db
    .insert(agentFiles)
    .values({
      agentId,
      filePath: body.filePath,
      content: body.content,
    })
    .returning();

  await db
    .update(agents)
    .set({ version: sql`${agents.version} + 1`, updatedAt: new Date() })
    .where(eq(agents.id, agent.id));

  return c.json({ file }, 201);
});

// PUT /:agentId/:fileId — update a file
const updateFileSchema = z.object({
  filePath: z.string().min(1).max(500)
    .refine((p) => !p.includes('..'), 'Path traversal not allowed')
    .refine((p) => !p.startsWith('/'), 'Absolute paths not allowed')
    .optional(),
  content: z.string().optional(),
});

agentFilesRouter.put('/:agentId/:fileId', async (c) => {
  const user = c.get('user');
  const agentId = uuidSchema.parse(c.req.param('agentId'));
  const fileId = uuidSchema.parse(c.req.param('fileId'));
  if (user.role === 'view_user') return c.json({ error: 'View-only users cannot modify files' }, 403);

  const agent = await db.query.agents.findFirst({ where: eq(agents.id, agentId) });
  if (!agent) return c.json({ error: 'Agent not found' }, 404);
  if (agent.workspaceId !== user.workspaceId) return c.json({ error: 'Forbidden' }, 403);

  const file = await db.query.agentFiles.findFirst({
    where: and(eq(agentFiles.id, fileId), eq(agentFiles.agentId, agentId)),
  });
  if (!file) return c.json({ error: 'File not found' }, 404);

  const body = updateFileSchema.parse(await c.req.json());
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.filePath) updateData.filePath = body.filePath;
  if (body.content !== undefined) updateData.content = body.content;

  await captureAgentHistoricalVersion(agent, user.userId);

  const [updated] = await db
    .update(agentFiles)
    .set(updateData)
    .where(eq(agentFiles.id, fileId))
    .returning();

  await db
    .update(agents)
    .set({ version: sql`${agents.version} + 1`, updatedAt: new Date() })
    .where(eq(agents.id, agent.id));

  return c.json({ file: updated });
});

// DELETE /:agentId/:fileId — delete a file
agentFilesRouter.delete('/:agentId/:fileId', async (c) => {
  const user = c.get('user');
  const agentId = uuidSchema.parse(c.req.param('agentId'));
  const fileId = uuidSchema.parse(c.req.param('fileId'));
  if (user.role === 'view_user') return c.json({ error: 'View-only users cannot delete files' }, 403);

  const agent = await db.query.agents.findFirst({ where: eq(agents.id, agentId) });
  if (!agent) return c.json({ error: 'Agent not found' }, 404);
  if (agent.workspaceId !== user.workspaceId) return c.json({ error: 'Forbidden' }, 403);

  const file = await db.query.agentFiles.findFirst({
    where: and(eq(agentFiles.id, fileId), eq(agentFiles.agentId, agentId)),
  });
  if (!file) return c.json({ error: 'File not found' }, 404);

  await captureAgentHistoricalVersion(agent, user.userId);

  await db.delete(agentFiles).where(eq(agentFiles.id, fileId));

  await db
    .update(agents)
    .set({ version: sql`${agents.version} + 1`, updatedAt: new Date() })
    .where(eq(agents.id, agent.id));

  return c.json({ success: true });
});

export default agentFilesRouter;
