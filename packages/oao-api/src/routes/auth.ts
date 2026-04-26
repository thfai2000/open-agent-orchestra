import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { eq, and, desc, gt } from 'drizzle-orm';
import { db } from '../database/index.js';
import { users, workspaces, authProviders, passwordResetTokens } from '../database/schema.js';
import { createJwt, authMiddleware, emailSchema, passwordSchema } from '@oao/shared';
import { authenticateLdap } from '../services/ldap-auth.js';
import type { LdapConfig } from '../services/ldap-auth.js';
import { sendPasswordResetEmail } from '../services/mailer.js';

const auth = new Hono();

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().min(1).max(100),
  workspaceSlug: z.string().min(1).max(50).optional(), // optional — defaults to 'default'
});

auth.post('/register', async (c) => {
  const body = registerSchema.parse(await c.req.json());

  const existing = await db.query.users.findFirst({
    where: eq(users.email, body.email),
  });
  if (existing) {
    return c.json({ error: 'Email already registered' }, 409);
  }

  // Resolve workspace from slug (default to 'default')
  const slug = body.workspaceSlug || 'default';
  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.slug, slug),
  });
  if (!workspace) {
    return c.json({ error: 'Workspace not found' }, 404);
  }

  // Check if registration is allowed
  if ((workspace.allowRegistration ?? true) === false) {
    return c.json({ error: 'Registration is not allowed for this workspace' }, 403);
  }

  const passwordHash = await bcrypt.hash(body.password, 12);
  const [user] = await db
    .insert(users)
    .values({
      email: body.email,
      passwordHash,
      name: body.name,
      authProvider: 'database',
      workspaceId: workspace.id,
    })
    .returning({ id: users.id, email: users.email, name: users.name, role: users.role, authProvider: users.authProvider, workspaceId: users.workspaceId });

  const token = await createJwt({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    authProvider: user.authProvider,
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
  });
  return c.json({
    user: { ...user, workspaceSlug: workspace.slug },
    token,
  }, 201);
});

const loginSchema = z.object({
  email: z.string().trim().optional(),
  identifier: z.string().trim().optional(),
  password: z.string().min(1),
  provider: z.enum(['database', 'ldap']).optional(), // optional — auto-detect if not specified
}).superRefine((body, ctx) => {
  const identifier = body.identifier?.trim() || body.email?.trim();
  if (!identifier) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['identifier'],
      message: 'identifier is required',
    });
    return;
  }

  // Database auth is email-based. LDAP may use usernames or email depending on the provider config.
  if ((body.provider ?? 'database') === 'database') {
    const parsed = emailSchema.safeParse(identifier);
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: body.identifier?.trim() ? ['identifier'] : ['email'],
        message: 'Database login requires a valid email address',
      });
    }
  }
});

auth.post('/login', async (c) => {
  const body = loginSchema.parse(await c.req.json());
  const identifier = body.identifier?.trim() || body.email?.trim() || '';

  // Determine which provider to use
  const requestedProvider = body.provider ?? 'database';

  if (requestedProvider === 'ldap') {
    return handleLdapLogin(c, identifier, body.password);
  }

  // Database login (default)
  const user = await db.query.users.findFirst({
    where: eq(users.email, identifier),
  });
  if (!user) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  // LDAP users cannot log in with database provider
  if (user.authProvider === 'ldap') {
    return c.json({ error: 'This account uses LDAP authentication. Please select LDAP provider.' }, 400);
  }

  if (!user.passwordHash) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const valid = await bcrypt.compare(body.password, user.passwordHash);
  if (!valid) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  // Get workspace info
  let workspaceSlug: string | null = null;
  if (user.workspaceId) {
    const workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, user.workspaceId),
    });
    workspaceSlug = workspace?.slug ?? null;
  }

  const token = await createJwt({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    authProvider: user.authProvider,
    workspaceId: user.workspaceId,
    workspaceSlug,
  });
  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      authProvider: user.authProvider,
      workspaceId: user.workspaceId,
      workspaceSlug,
    },
    token,
  });
});

/** Handle LDAP login flow */
async function handleLdapLogin(c: Context, email: string, password: string) {
  // Find enabled LDAP providers — try each by priority (highest first)
  const ldapProviders = await db.query.authProviders.findMany({
    where: and(
      eq(authProviders.providerType, 'ldap'),
      eq(authProviders.isEnabled, true),
    ),
    orderBy: [desc(authProviders.priority)],
  });

  if (ldapProviders.length === 0) {
    return c.json({ error: 'LDAP authentication is not configured' }, 400);
  }

  for (const provider of ldapProviders) {
    const config = provider.config as unknown as LdapConfig;
    if (!config.url || !config.bindDn || !config.searchBase || !config.searchFilter) {
      continue; // skip misconfigured providers
    }

    try {
      const ldapUser = await authenticateLdap(config, email, password);
      if (!ldapUser) continue; // try next provider

      // LDAP auth succeeded — find or create user in DB
      let user = await db.query.users.findFirst({
        where: eq(users.email, ldapUser.email),
      });

      const workspace = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, provider.workspaceId),
      });
      const workspaceSlug = workspace?.slug ?? 'default';

      if (!user) {
        // Auto-provision LDAP user
        const [newUser] = await db
          .insert(users)
          .values({
            email: ldapUser.email,
            passwordHash: null,
            name: ldapUser.name,
            authProvider: 'ldap',
            workspaceId: provider.workspaceId,
          })
          .returning({ id: users.id, email: users.email, name: users.name, role: users.role, authProvider: users.authProvider, workspaceId: users.workspaceId });
        user = { ...newUser, passwordHash: null, createdAt: new Date(), updatedAt: new Date() };
      } else if (user.authProvider !== 'ldap') {
        // User exists with different provider — update to LDAP
        await db.update(users).set({
          authProvider: 'ldap',
          name: ldapUser.name,
          updatedAt: new Date(),
        }).where(eq(users.id, user.id));
        user = { ...user, authProvider: 'ldap' as const, name: ldapUser.name };
      }

      const token = await createJwt({
        userId: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        authProvider: 'ldap',
        workspaceId: user.workspaceId,
        workspaceSlug,
      });

      return c.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          authProvider: 'ldap',
          workspaceId: user.workspaceId,
          workspaceSlug,
        },
        token,
      });
    } catch {
      // LDAP error — try next provider
      continue;
    }
  }

  return c.json({ error: 'Invalid credentials' }, 401);
}

// ── Get available auth providers for a workspace (public, no auth required) ──

auth.get('/providers', async (c) => {
  const slug = c.req.query('workspace') || 'default';

  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.slug, slug),
  });

  // Build provider list, deduplicated by providerType. One provider per type (UI selects by type).
  const seen = new Set<string>();
  const providers: Array<{ type: string; name: string }> = [];

  const displayName = (type: string, rawName?: string): string => {
    const fallback = type === 'ldap' ? 'Active Directory' : 'Built-in Database';
    if (!rawName || !rawName.trim()) return fallback;
    // Ignore generic seed names so users don't see "Database"
    const generic = new Set(['database', 'ldap']);
    if (generic.has(rawName.trim().toLowerCase())) return fallback;
    return rawName;
  };

  if (workspace) {
    const configured = await db.query.authProviders.findMany({
      where: and(
        eq(authProviders.workspaceId, workspace.id),
        eq(authProviders.isEnabled, true),
      ),
      orderBy: [desc(authProviders.priority)],
    });

    for (const p of configured) {
      if (seen.has(p.providerType)) continue;
      seen.add(p.providerType);
      providers.push({ type: p.providerType, name: displayName(p.providerType, p.name) });
    }
  }

  // Ensure database fallback is always available (for login with local users)
  if (!seen.has('database')) {
    providers.unshift({ type: 'database', name: 'Built-in Database' });
  }

  return c.json({
    providers,
    allowRegistration: workspace?.allowRegistration ?? true,
    allowPasswordReset: workspace?.allowPasswordReset ?? true,
  });
});

auth.get('/me', authMiddleware, async (c) => {
  const { userId } = c.get('user');
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) return c.json({ error: 'User not found' }, 404);

  let workspaceSlug: string | null = null;
  if (user.workspaceId) {
    const workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, user.workspaceId),
    });
    workspaceSlug = workspace?.slug ?? null;
  }

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      authProvider: user.authProvider,
      workspaceId: user.workspaceId,
      workspaceSlug,
    },
  });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

auth.put('/change-password', authMiddleware, async (c) => {
  const { userId } = c.get('user');
  const body = changePasswordSchema.parse(await c.req.json());

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) return c.json({ error: 'User not found' }, 404);

  // LDAP users cannot change password via OAO
  if (user.authProvider === 'ldap') {
    return c.json({ error: 'Password changes are managed by your LDAP directory' }, 400);
  }

  if (!user.passwordHash) {
    return c.json({ error: 'No password set for this account' }, 400);
  }

  const valid = await bcrypt.compare(body.currentPassword, user.passwordHash);
  if (!valid) {
    return c.json({ error: 'Current password is incorrect' }, 401);
  }

  const newHash = await bcrypt.hash(body.newPassword, 12);
  await db.update(users).set({ passwordHash: newHash, updatedAt: new Date() }).where(eq(users.id, userId));

  return c.json({ message: 'Password changed successfully' });
});

// ── Forgot password (database auth only) ─────────────────────────────

auth.post('/forgot-password', async (c) => {
  const body = z.object({ email: emailSchema, workspace: z.string().min(1).max(50).optional() }).parse(await c.req.json());
  const slug = body.workspace || 'default';

  const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, slug) });
  if (workspace && (workspace.allowPasswordReset ?? true) === false) {
    return c.json({ error: 'Password reset is not allowed for this workspace' }, 403);
  }

  // Always return 200 to avoid user enumeration
  const user = await db.query.users.findFirst({ where: eq(users.email, body.email) });
  if (!user || user.authProvider !== 'database' || !user.workspaceId) {
    return c.json({ message: 'If that email exists, a reset link has been sent.' });
  }

  if (!workspace || user.workspaceId !== workspace.id) {
    return c.json({ message: 'If that email exists, a reset link has been sent.' });
  }

  // Invalidate old tokens
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));

  const token = randomBytes(48).toString('hex'); // 96-char hex token
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await db.insert(passwordResetTokens).values({ userId: user.id, token, expiresAt });

  await sendPasswordResetEmail({ to: user.email, name: user.name, token, workspaceSlug: slug });

  return c.json({ message: 'If that email exists, a reset link has been sent.' });
});

// ── Reset password (using token) ──────────────────────────────────────

auth.post('/reset-password', async (c) => {
  const body = z.object({ token: z.string().min(1), password: passwordSchema }).parse(await c.req.json());

  const record = await db.query.passwordResetTokens.findFirst({
    where: and(eq(passwordResetTokens.token, body.token), gt(passwordResetTokens.expiresAt, new Date())),
  });

  if (!record || record.usedAt) {
    return c.json({ error: 'Invalid or expired reset token' }, 400);
  }

  const user = await db.query.users.findFirst({ where: eq(users.id, record.userId) });
  if (!user) {
    return c.json({ error: 'Invalid or expired reset token' }, 400);
  }

  if (user.workspaceId) {
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, user.workspaceId) });
    if (workspace && (workspace.allowPasswordReset ?? true) === false) {
      return c.json({ error: 'Password reset is not allowed for this workspace' }, 403);
    }
  }

  const newHash = await bcrypt.hash(body.password, 12);
  await db.update(users).set({ passwordHash: newHash, updatedAt: new Date() }).where(eq(users.id, record.userId));
  await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, record.id));

  return c.json({ message: 'Password has been reset successfully.' });
});

export default auth;
