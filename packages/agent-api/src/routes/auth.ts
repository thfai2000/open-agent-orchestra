import { Hono } from 'hono';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../database/index.js';
import { users } from '../database/schema.js';
import { createJwt, authMiddleware, emailSchema, passwordSchema } from '@ai-trader/shared';

const auth = new Hono();

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().min(1).max(100),
});

auth.post('/register', async (c) => {
  const body = registerSchema.parse(await c.req.json());

  const existing = await db.query.users.findFirst({
    where: eq(users.email, body.email),
  });
  if (existing) {
    return c.json({ error: 'Email already registered' }, 409);
  }

  const passwordHash = await bcrypt.hash(body.password, 12);
  const [user] = await db
    .insert(users)
    .values({ email: body.email, passwordHash, name: body.name })
    .returning({ id: users.id, email: users.email, name: users.name, role: users.role });

  const token = await createJwt({ userId: user.id, email: user.email, name: user.name, role: user.role });
  return c.json({ user, token }, 201);
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});

auth.post('/login', async (c) => {
  const body = loginSchema.parse(await c.req.json());

  const user = await db.query.users.findFirst({
    where: eq(users.email, body.email),
  });
  if (!user) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const valid = await bcrypt.compare(body.password, user.passwordHash);
  if (!valid) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const token = await createJwt({ userId: user.id, email: user.email, name: user.name, role: user.role });
  return c.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    token,
  });
});

auth.get('/me', authMiddleware, async (c) => {
  const { userId } = c.get('user');
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) return c.json({ error: 'User not found' }, 404);

  return c.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
});

export default auth;
