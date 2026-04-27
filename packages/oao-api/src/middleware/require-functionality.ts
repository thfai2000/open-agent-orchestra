/**
 * RBAC v2.0.0 — `requireFunctionality` middleware
 *
 * Hono middleware that gates a route on a single functionality key. Uses
 * the in-memory cache in `services/rbac.ts`. Must be mounted AFTER
 * `authMiddleware` because it reads `c.get('user').userId`.
 *
 * Side-effect: stores the resolved flag set on `c.set('effectiveFlags', ...)`
 * so subsequent handlers in the same request can call `setHasFunctionality`
 * without re-querying.
 */

import type { Context, Next } from 'hono';
import { resolveEffectiveFunctionalities } from '../services/rbac.js';

declare module 'hono' {
  interface ContextVariableMap {
    effectiveFlags?: ReadonlySet<string>;
  }
}

const SUPER = '*';

export function requireFunctionality(key: string) {
  return async (c: Context, next: Next) => {
    const user = c.get('user');
    if (!user || !user.userId) {
      return c.json({ error: 'Authentication required' }, 401);
    }
    let flags = c.get('effectiveFlags');
    if (!flags) {
      flags = await resolveEffectiveFunctionalities(user.userId);
      c.set('effectiveFlags', flags);
    }
    if (!flags.has(SUPER) && !flags.has(key)) {
      return c.json({ error: 'Forbidden', missingFunctionality: key }, 403);
    }
    await next();
  };
}

/**
 * Variant that accepts ANY of the listed flags (logical OR). Useful for
 * read-or-manage gates such as "can list users if they can read users
 * OR manage them".
 */
export function requireAnyFunctionality(keys: string[]) {
  return async (c: Context, next: Next) => {
    const user = c.get('user');
    if (!user || !user.userId) {
      return c.json({ error: 'Authentication required' }, 401);
    }
    let flags = c.get('effectiveFlags');
    if (!flags) {
      flags = await resolveEffectiveFunctionalities(user.userId);
      c.set('effectiveFlags', flags);
    }
    if (flags.has(SUPER)) {
      await next();
      return;
    }
    const hit = keys.some((k) => flags!.has(k));
    if (!hit) {
      return c.json({ error: 'Forbidden', missingAnyOf: keys }, 403);
    }
    await next();
  };
}
