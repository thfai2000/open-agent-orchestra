import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../database/index.js';
import { authProviders } from '../database/schema.js';
import { authMiddleware, encrypt } from '@oao/shared';
import type { Context } from 'hono';

const authProvidersRouter = new Hono();

// All routes require admin role
authProvidersRouter.use('*', authMiddleware);

function requireAdmin(c: Context): boolean {
  const user = c.get('user');
  return user.role === 'super_admin' || user.role === 'workspace_admin';
}

// ── List auth providers for current workspace ──

authProvidersRouter.get('/', async (c) => {
  const user = c.get('user');
  if (!requireAdmin(c)) return c.json({ error: 'Forbidden' }, 403);

  const providers = await db.query.authProviders.findMany({
    where: eq(authProviders.workspaceId, user.workspaceId!),
  });

  // Redact sensitive config fields
  const safeProviders = providers.map((p) => ({
    ...p,
    config: redactConfig(p.config as Record<string, unknown>),
  }));

  return c.json({ providers: safeProviders });
});

// ── Create auth provider ──

const createSchema = z.object({
  providerType: z.enum(['database', 'ldap']),
  name: z.string().min(1).max(100),
  isEnabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(100).optional(),
  config: z.object({
    url: z.string().url().optional(),
    bindDn: z.string().optional(),
    bindCredential: z.string().optional(), // raw password — will be encrypted
    searchBase: z.string().optional(),
    searchFilter: z.string().optional(),
    usernameAttribute: z.string().optional(),
    emailAttribute: z.string().optional(),
    nameAttribute: z.string().optional(),
    startTls: z.boolean().optional(),
    tlsRejectUnauthorized: z.boolean().optional(),
  }).passthrough(),
});

authProvidersRouter.post('/', async (c) => {
  const user = c.get('user');
  if (!requireAdmin(c)) return c.json({ error: 'Forbidden' }, 403);

  const body = createSchema.parse(await c.req.json());
  const config = prepareConfig(body.config);

  const [provider] = await db
    .insert(authProviders)
    .values({
      workspaceId: user.workspaceId!,
      providerType: body.providerType,
      name: body.name,
      isEnabled: body.isEnabled ?? true,
      priority: body.priority ?? 0,
      config,
    })
    .returning();

  return c.json({ provider: { ...provider, config: redactConfig(config) } }, 201);
});

// ── Get single auth provider ──

authProvidersRouter.get('/:id', async (c) => {
  const user = c.get('user');
  if (!requireAdmin(c)) return c.json({ error: 'Forbidden' }, 403);

  const provider = await db.query.authProviders.findFirst({
    where: and(
      eq(authProviders.id, c.req.param('id')),
      eq(authProviders.workspaceId, user.workspaceId!),
    ),
  });

  if (!provider) return c.json({ error: 'Provider not found' }, 404);
  return c.json({ provider: { ...provider, config: redactConfig(provider.config as Record<string, unknown>) } });
});

// ── Update auth provider ──

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isEnabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(100).optional(),
  config: z.object({
    url: z.string().url().optional(),
    bindDn: z.string().optional(),
    bindCredential: z.string().optional(),
    searchBase: z.string().optional(),
    searchFilter: z.string().optional(),
    usernameAttribute: z.string().optional(),
    emailAttribute: z.string().optional(),
    nameAttribute: z.string().optional(),
    startTls: z.boolean().optional(),
    tlsRejectUnauthorized: z.boolean().optional(),
  }).passthrough().optional(),
});

authProvidersRouter.put('/:id', async (c) => {
  const user = c.get('user');
  if (!requireAdmin(c)) return c.json({ error: 'Forbidden' }, 403);

  const id = c.req.param('id');
  const body = updateSchema.parse(await c.req.json());

  const existing = await db.query.authProviders.findFirst({
    where: and(
      eq(authProviders.id, id),
      eq(authProviders.workspaceId, user.workspaceId!),
    ),
  });
  if (!existing) return c.json({ error: 'Provider not found' }, 404);

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.isEnabled !== undefined) updates.isEnabled = body.isEnabled;
  if (body.priority !== undefined) updates.priority = body.priority;

  if (body.config) {
    // Merge with existing config, only updating provided fields
    const existingConfig = (existing.config ?? {}) as Record<string, unknown>;
    const newConfig = prepareConfig(body.config);
    updates.config = { ...existingConfig, ...newConfig };
  }

  const [updated] = await db
    .update(authProviders)
    .set(updates)
    .where(and(
      eq(authProviders.id, id),
      eq(authProviders.workspaceId, user.workspaceId!),
    ))
    .returning();

  return c.json({ provider: { ...updated, config: redactConfig(updated.config as Record<string, unknown>) } });
});

// ── Delete auth provider ──

authProvidersRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  if (!requireAdmin(c)) return c.json({ error: 'Forbidden' }, 403);

  const result = await db
    .delete(authProviders)
    .where(and(
      eq(authProviders.id, c.req.param('id')),
      eq(authProviders.workspaceId, user.workspaceId!),
    ))
    .returning({ id: authProviders.id });

  if (result.length === 0) return c.json({ error: 'Provider not found' }, 404);
  return c.json({ message: 'Provider deleted' });
});

// ── Test LDAP connection (dry-run without user bind) ──

const testSchema = z.object({
  providerId: z.string().uuid(),
});

authProvidersRouter.post('/test-connection', async (c) => {
  const user = c.get('user');
  if (!requireAdmin(c)) return c.json({ error: 'Forbidden' }, 403);

  const body = testSchema.parse(await c.req.json());

  const provider = await db.query.authProviders.findFirst({
    where: and(
      eq(authProviders.id, body.providerId),
      eq(authProviders.workspaceId, user.workspaceId!),
    ),
  });
  if (!provider) return c.json({ error: 'Provider not found' }, 404);
  if (provider.providerType !== 'ldap') return c.json({ error: 'Test connection is only supported for LDAP providers' }, 400);

  const config = (provider.config ?? {}) as Record<string, unknown>;
  const url = config.url as string | undefined;
  const bindDn = config.bindDn as string | undefined;
  const searchBase = config.searchBase as string | undefined;

  if (!url || !bindDn || !searchBase) {
    return c.json({ success: false, message: 'LDAP config incomplete: url, bindDn, and searchBase are required' }, 400);
  }

  // Decrypt bind credential if stored encrypted
  let bindCredential = '';
  if (config.bindCredentialEncrypted && typeof config.bindCredentialEncrypted === 'string' && config.bindCredentialEncrypted !== '***') {
    const { decrypt } = await import('@oao/shared');
    bindCredential = decrypt(config.bindCredentialEncrypted);
  }

  if (!bindCredential) {
    return c.json({ success: false, message: 'No bind credential stored for this provider. Edit the provider and set a bind password first.' }, 400);
  }

  try {
    const ldapts = await import('ldapts');
    const client = new ldapts.Client({
      url,
      tlsOptions: config.tlsRejectUnauthorized === false ? { rejectUnauthorized: false } : undefined,
      strictDN: false,
    });

    if (config.startTls) {
      await client.startTLS(config.tlsRejectUnauthorized === false ? { rejectUnauthorized: false } : {});
    }

    await client.bind(bindDn, bindCredential);

    // Quick search to verify access
    const { searchEntries } = await client.search(searchBase, {
      scope: 'sub',
      filter: '(objectClass=*)',
      sizeLimit: 1,
    });

    await client.unbind();
    return c.json({ success: true, message: `Connected successfully. Found ${searchEntries.length} entries in search base.` });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection failed';
    return c.json({ success: false, message }, 400);
  }
});

/** Encrypt sensitive config fields before storage */
function prepareConfig(config: Record<string, unknown>): Record<string, unknown> {
  const prepared = { ...config };
  if (typeof prepared.bindCredential === 'string' && prepared.bindCredential) {
    prepared.bindCredentialEncrypted = encrypt(prepared.bindCredential);
    delete prepared.bindCredential;
  }
  return prepared;
}

/** Redact sensitive fields from config for API responses */
function redactConfig(config: Record<string, unknown>): Record<string, unknown> {
  const safe = { ...config };
  if (safe.bindCredentialEncrypted) {
    safe.bindCredentialEncrypted = '***';
  }
  delete safe.bindCredential;
  return safe;
}

export default authProvidersRouter;
