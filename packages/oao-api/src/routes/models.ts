import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { authMiddleware, uuidSchema } from '@oao/shared';
import { db } from '../database/index.js';
import { models } from '../database/schema.js';
import { listUserActiveModels } from '../services/user-models.js';

const modelsRouter = new Hono();
modelsRouter.use('/*', authMiddleware);

// GET /api/models — list ACTIVE models for the current user (used by chat UI)
modelsRouter.get('/', async (c) => {
  const user = c.get('user');
  const activeModels = await listUserActiveModels(user.userId);
  return c.json({ models: activeModels });
});

// ── Create / Update / Delete ─────────────────────────────────────────────
const createModelSchema = z.object({
  name: z.string().min(1).max(100),
  provider: z.string().min(1).max(50).default('github'),
  providerType: z.enum(['github', 'custom']).default('github'),
  customProviderType: z.enum(['openai', 'azure', 'anthropic']).nullable().optional(),
  customBaseUrl: z.string().url().max(1000).nullable().optional(),
  customAuthType: z.enum(['none', 'api_key', 'bearer_token']).default('none'),
  customWireApi: z.enum(['completions', 'responses']).nullable().optional(),
  customAzureApiVersion: z.string().max(50).nullable().optional(),
  description: z.string().max(500).optional(),
  creditCost: z.string().regex(/^\d+(\.\d{1,2})?$/).default('1.00'),
  isActive: z.boolean().default(true),
  supportedReasoningEfforts: z.array(z.enum(['minimal', 'low', 'medium', 'high', 'xhigh'])).optional(),
}).superRefine((body, ctx) => {
  if (body.providerType !== 'custom') return;
  if (!body.customProviderType) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['customProviderType'], message: 'Custom provider type is required.' });
  }
  if (!body.customBaseUrl) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['customBaseUrl'], message: 'Custom provider base URL is required.' });
  }
  if (body.customProviderType === 'azure' && !body.customAzureApiVersion) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['customAzureApiVersion'], message: 'Azure API version is required for Azure providers.' });
  }
});

modelsRouter.post('/', async (c) => {
  const user = c.get('user');
  const body = createModelSchema.parse(await c.req.json());

  const [model] = await db
    .insert(models)
    .values({
      userId: user.userId,
      name: body.name,
      provider: body.provider,
      providerType: body.providerType,
      customProviderType: body.providerType === 'custom' ? body.customProviderType ?? null : null,
      customBaseUrl: body.providerType === 'custom' ? body.customBaseUrl ?? null : null,
      customAuthType: body.providerType === 'custom' ? body.customAuthType : 'none',
      customWireApi: body.providerType === 'custom' ? body.customWireApi ?? null : null,
      customAzureApiVersion: body.providerType === 'custom' ? body.customAzureApiVersion ?? null : null,
      description: body.description,
      creditCost: body.creditCost,
      isActive: body.isActive,
      catalogSource: 'custom',
      supportedReasoningEfforts: body.supportedReasoningEfforts ?? ['low', 'medium', 'high'],
    })
    .returning();

  return c.json({ model }, 201);
});

const updateModelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  provider: z.string().min(1).max(50).optional(),
  providerType: z.enum(['github', 'custom']).optional(),
  customProviderType: z.enum(['openai', 'azure', 'anthropic']).nullable().optional(),
  customBaseUrl: z.string().url().max(1000).nullable().optional(),
  customAuthType: z.enum(['none', 'api_key', 'bearer_token']).optional(),
  customWireApi: z.enum(['completions', 'responses']).nullable().optional(),
  customAzureApiVersion: z.string().max(50).nullable().optional(),
  description: z.string().max(500).optional(),
  creditCost: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  isActive: z.boolean().optional(),
  supportedReasoningEfforts: z.array(z.enum(['minimal', 'low', 'medium', 'high', 'xhigh'])).optional(),
}).superRefine((body, ctx) => {
  if (body.providerType !== 'custom') return;
  if (body.customProviderType === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['customProviderType'], message: 'Custom provider type is required when switching to a custom provider.' });
  }
  if (body.customBaseUrl === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['customBaseUrl'], message: 'Custom provider base URL is required when switching to a custom provider.' });
  }
});

// GET /api/models/:id — get single model owned by user
modelsRouter.get('/:id', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));
  const existing = await db.query.models.findFirst({ where: eq(models.id, id) });
  if (!existing) return c.json({ error: 'Model not found' }, 404);
  if (existing.userId !== user.userId) return c.json({ error: 'Model does not belong to current user' }, 403);
  return c.json({ model: existing });
});

modelsRouter.put('/:id', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));
  const body = updateModelSchema.parse(await c.req.json());

  const existing = await db.query.models.findFirst({ where: eq(models.id, id) });
  if (!existing) return c.json({ error: 'Model not found' }, 404);
  if (existing.userId !== user.userId) return c.json({ error: 'Model does not belong to current user' }, 403);

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.provider !== undefined) updateData.provider = body.provider;
  if (body.providerType !== undefined) updateData.providerType = body.providerType;
  if (body.customProviderType !== undefined) updateData.customProviderType = body.customProviderType;
  if (body.customBaseUrl !== undefined) updateData.customBaseUrl = body.customBaseUrl;
  if (body.customAuthType !== undefined) updateData.customAuthType = body.customAuthType;
  if (body.customWireApi !== undefined) updateData.customWireApi = body.customWireApi;
  if (body.customAzureApiVersion !== undefined) updateData.customAzureApiVersion = body.customAzureApiVersion;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.creditCost !== undefined) updateData.creditCost = body.creditCost;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;
  if (body.supportedReasoningEfforts !== undefined) updateData.supportedReasoningEfforts = body.supportedReasoningEfforts;

  const effectiveProviderType = (body.providerType ?? existing.providerType) as 'github' | 'custom';
  const effectiveCustomProviderType = effectiveProviderType === 'custom'
    ? (body.customProviderType ?? existing.customProviderType)
    : null;
  const effectiveCustomBaseUrl = effectiveProviderType === 'custom'
    ? (body.customBaseUrl ?? existing.customBaseUrl)
    : null;
  const effectiveCustomAzureApiVersion = effectiveProviderType === 'custom'
    ? (body.customAzureApiVersion ?? existing.customAzureApiVersion)
    : null;

  if (effectiveProviderType === 'custom') {
    if (!effectiveCustomProviderType) return c.json({ error: 'Custom provider type is required.' }, 400);
    if (!effectiveCustomBaseUrl) return c.json({ error: 'Custom provider base URL is required.' }, 400);
    if (effectiveCustomProviderType === 'azure' && !effectiveCustomAzureApiVersion) {
      return c.json({ error: 'Azure API version is required for Azure providers.' }, 400);
    }
  }

  if (effectiveProviderType !== 'custom') {
    updateData.customProviderType = null;
    updateData.customBaseUrl = null;
    updateData.customAuthType = 'none';
    updateData.customWireApi = null;
    updateData.customAzureApiVersion = null;
  }

  const [updated] = await db.update(models).set(updateData).where(eq(models.id, id)).returning();
  return c.json({ model: updated });
});

modelsRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = uuidSchema.parse(c.req.param('id'));

  const existing = await db.query.models.findFirst({ where: eq(models.id, id) });
  if (!existing) return c.json({ error: 'Model not found' }, 404);
  if (existing.userId !== user.userId) return c.json({ error: 'Model does not belong to current user' }, 403);

  await db.delete(models).where(eq(models.id, id));
  return c.json({ success: true });
});

export default modelsRouter;

