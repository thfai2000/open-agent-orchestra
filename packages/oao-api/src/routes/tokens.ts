import { Hono } from 'hono';
import { z } from 'zod';
import { randomBytes, createHash } from 'crypto';
import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../database/index.js';
import { personalAccessTokens, users, workspaces } from '../database/schema.js';
import { authMiddleware, createLogger } from '@oao/shared';

const logger = createLogger('tokens');

const tokens = new Hono();

// ─── Available scopes ────────────────────────────────────────────────

const AVAILABLE_SCOPES = [
  'webhook:trigger',    // Trigger webhook-type workflow triggers
  'api:read',           // Read-only API access (GET endpoints)
  'api:write',          // Write API access (POST/PUT/DELETE)
  'api:agents',         // Manage agents
  'api:workflows',      // Manage workflows
  'api:executions',     // View/manage executions
  'api:variables',      // Read/write variables
  'api:triggers',       // Manage triggers
  'api:admin',          // Admin operations
] as const;

type PatScope = (typeof AVAILABLE_SCOPES)[number];

// ─── Helpers ─────────────────────────────────────────────────────────

function generateToken(): string {
  // Format: oao_<40 random hex chars>  → 44 chars total
  return `oao_${randomBytes(20).toString('hex')}`;
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// ─── Schemas ─────────────────────────────────────────────────────────

const createTokenSchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(AVAILABLE_SCOPES as unknown as [string, ...string[]])).min(1),
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(), // null = no expiry
  expiresAt: z.string().datetime().nullable().optional(), // ISO datetime — takes precedence over expiresInDays
});

// ─── GET /scopes — list available scopes ─────────────────────────────

tokens.get('/scopes', authMiddleware, (c) => {
  return c.json({
    scopes: AVAILABLE_SCOPES.map((s) => ({
      name: s,
      description: scopeDescription(s),
    })),
  });
});

function scopeDescription(scope: string): string {
  const map: Record<string, string> = {
    'webhook:trigger': 'Trigger webhook-type workflow triggers',
    'api:read': 'Read-only API access (list/get endpoints)',
    'api:write': 'Write API access (create/update/delete)',
    'api:agents': 'Manage agents',
    'api:workflows': 'Manage workflows',
    'api:executions': 'View and manage workflow executions',
    'api:variables': 'Read and write variables',
    'api:triggers': 'Manage triggers',
    'api:admin': 'Admin operations',
  };
  return map[scope] ?? scope;
}

// ─── POST / — create a new PAT ──────────────────────────────────────

tokens.post('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = createTokenSchema.parse(await c.req.json());

  // Resolve workspace
  if (!user.workspaceId) {
    return c.json({ error: 'User not in a workspace' }, 400);
  }

  const rawToken = generateToken();
  const hash = hashToken(rawToken);
  const prefix = rawToken.slice(0, 8); // "oao_xxxx"

  const expiresAt = body.expiresAt
    ? new Date(body.expiresAt)
    : body.expiresInDays
      ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

  const [pat] = await db
    .insert(personalAccessTokens)
    .values({
      userId: user.userId,
      workspaceId: user.workspaceId,
      name: body.name,
      tokenHash: hash,
      tokenPrefix: prefix,
      scopes: body.scopes,
      expiresAt,
    })
    .returning({
      id: personalAccessTokens.id,
      name: personalAccessTokens.name,
      tokenPrefix: personalAccessTokens.tokenPrefix,
      scopes: personalAccessTokens.scopes,
      expiresAt: personalAccessTokens.expiresAt,
      createdAt: personalAccessTokens.createdAt,
    });

  // Return the raw token ONLY on creation — it is never stored or retrievable again
  return c.json({
    token: rawToken,
    pat: { ...pat, scopes: pat.scopes as string[] },
  }, 201);
});

// ─── GET / — list user's PATs ────────────────────────────────────────

tokens.get('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const page = Math.max(1, Number(c.req.query('page') || 1));
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 50)));
  const offset = (page - 1) * limit;

  const whereClause = eq(personalAccessTokens.userId, user.userId);

  const [pats, countResult] = await Promise.all([
    db
      .select({
        id: personalAccessTokens.id,
        name: personalAccessTokens.name,
        tokenPrefix: personalAccessTokens.tokenPrefix,
        scopes: personalAccessTokens.scopes,
        expiresAt: personalAccessTokens.expiresAt,
        lastUsedAt: personalAccessTokens.lastUsedAt,
        isRevoked: personalAccessTokens.isRevoked,
        createdAt: personalAccessTokens.createdAt,
      })
      .from(personalAccessTokens)
      .where(whereClause)
      .orderBy(desc(personalAccessTokens.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(personalAccessTokens).where(whereClause),
  ]);

  return c.json({ tokens: pats.map((p) => ({ ...p, scopes: p.scopes as string[] })), total: countResult[0]?.count ?? 0, page, limit });
});

// ─── DELETE /:id — revoke a PAT ─────────────────────────────────────

tokens.delete('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Token ID required' }, 400);

  const [updated] = await db
    .update(personalAccessTokens)
    .set({ isRevoked: true })
    .where(
      and(
        eq(personalAccessTokens.id, id),
        eq(personalAccessTokens.userId, user.userId),
      ),
    )
    .returning({ id: personalAccessTokens.id });

  if (!updated) {
    return c.json({ error: 'Token not found' }, 404);
  }

  return c.json({ message: 'Token revoked' });
});

export default tokens;

// ─── Exported helpers for auth middleware ─────────────────────────────

/**
 * Look up a PAT by its raw token string and return the associated user info.
 * Returns null if the token is invalid, expired, or revoked.
 */
export async function validatePat(rawToken: string) {
  const hash = hashToken(rawToken);

  const pat = await db.query.personalAccessTokens.findFirst({
    where: eq(personalAccessTokens.tokenHash, hash),
  });

  if (!pat || pat.isRevoked) return null;
  if (pat.expiresAt && pat.expiresAt < new Date()) return null;

  // Update last-used timestamp (fire-and-forget)
  db.update(personalAccessTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(personalAccessTokens.id, pat.id))
    .then(() => {})
    .catch((err) => logger.warn({ error: err, patId: pat.id }, 'Failed to update PAT lastUsedAt'));

  // Fetch user & workspace info
  const user = await db.query.users.findFirst({
    where: eq(users.id, pat.userId),
  });
  if (!user) return null;

  const workspace = pat.workspaceId
    ? await db.query.workspaces.findFirst({ where: eq(workspaces.id, pat.workspaceId) })
    : null;

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    authProvider: user.authProvider ?? 'database',
    workspaceId: pat.workspaceId,
    workspaceSlug: workspace?.slug ?? null,
    scopes: pat.scopes as PatScope[],
    tokenId: pat.id,
  };
}
