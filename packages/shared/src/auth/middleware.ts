import type { Context, Next } from 'hono';
import { verifyJwt } from './jwt.js';
import type { AuthUser } from './types.js';

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
    /** Set when auth was via PAT — contains token ID and granted scopes */
    patInfo?: { tokenId: string; scopes: string[] };
  }
}

/**
 * Callback to validate a Personal Access Token.
 * Returns user info + scopes if valid, null otherwise.
 */
export type PatValidator = (rawToken: string) => Promise<
  | (AuthUser & { scopes: string[]; tokenId: string })
  | null
>;

/** Module-level PAT validator set via registerPatValidator */
let _patValidator: PatValidator | null = null;

/**
 * Register a PAT validator at startup (called once from oao-api).
 * This allows the shared auth middleware to validate PATs without
 * depending on the oao-api database directly.
 */
export function registerPatValidator(validator: PatValidator): void {
  _patValidator = validator;
}

export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  const authHeader = c.req.header('Authorization');
  // Support token via query param for SSE (EventSource doesn't support custom headers)
  const queryToken = c.req.query('token');

  let token: string | undefined;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (queryToken) {
    token = queryToken;
  }

  if (!token) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  // ── PAT path: tokens starting with "oao_" ──
  if (token.startsWith('oao_')) {
    if (!_patValidator) {
      return c.json({ error: 'Token authentication not configured' }, 501);
    }
    const result = await _patValidator(token);
    if (!result) {
      return c.json({ error: 'Invalid, expired, or revoked token' }, 401);
    }
    c.set('user', {
      userId: result.userId,
      email: result.email,
      name: result.name,
      role: result.role,
      authProvider: result.authProvider ?? 'database',
      workspaceId: result.workspaceId,
      workspaceSlug: result.workspaceSlug,
    });
    c.set('patInfo', { tokenId: result.tokenId, scopes: result.scopes });
    await next();
    return;
  }

  // ── JWT path (default) ──
  try {
    const payload = await verifyJwt(token);
    c.set('user', {
      userId: payload.userId,
      email: payload.email,
      name: payload.name,
      role: payload.role,
      authProvider: payload.authProvider ?? 'database',
      workspaceId: payload.workspaceId ?? null,
      workspaceSlug: payload.workspaceSlug ?? null,
    });
    await next();
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
}
