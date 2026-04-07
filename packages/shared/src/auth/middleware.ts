import type { Context, Next } from 'hono';
import { verifyJwt } from './jwt.js';
import type { AuthUser } from './types.js';

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const token = authHeader.slice(7);
  try {
    const payload = await verifyJwt(token);
    c.set('user', {
      userId: payload.userId,
      email: payload.email,
      name: payload.name,
      role: payload.role,
    });
    await next();
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
}
