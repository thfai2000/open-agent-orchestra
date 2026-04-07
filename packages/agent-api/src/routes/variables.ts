import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../database/index.js';
import { agentVariables, userVariables, agents } from '../database/schema.js';
import { authMiddleware, encrypt, uuidSchema } from '@ai-trader/shared';

const variablesRouter = new Hono();
variablesRouter.use('/*', authMiddleware);

// GET / — list variables (agent-level or user-level)
// ?agentId=... → agent variables | ?scope=user → user variables
variablesRouter.get('/', async (c) => {
  const user = c.get('user');
  const agentId = c.req.query('agentId');
  const scope = c.req.query('scope');

  if (scope === 'user') {
    const vars = await db.query.userVariables.findMany({
      where: eq(userVariables.userId, user.userId),
      columns: {
        id: true,
        userId: true,
        key: true,
        variableType: true,
        injectAsEnvVariable: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return c.json({ variables: vars, scope: 'user' });
  }

  if (!agentId) return c.json({ error: 'agentId or scope=user query parameter required' }, 400);

  const agent = await db.query.agents.findFirst({ where: eq(agents.id, agentId) });
  if (!agent || agent.userId !== user.userId) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const vars = await db.query.agentVariables.findMany({
    where: eq(agentVariables.agentId, agentId),
    columns: {
      id: true,
      agentId: true,
      key: true,
      variableType: true,
      injectAsEnvVariable: true,
      description: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return c.json({ variables: vars, scope: 'agent' });
});

// POST / — add variable (agent-level or user-level)
const createVariableSchema = z.object({
  agentId: z.string().uuid().optional(),
  key: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Z_][A-Z0-9_]*$/, 'Key must be uppercase with underscores'),
  value: z.string().min(1).max(5000),
  variableType: z.enum(['property', 'credential']).default('credential'),
  injectAsEnvVariable: z.boolean().default(false),
  description: z.string().max(300).optional(),
});

variablesRouter.post('/', async (c) => {
  const user = c.get('user');
  const body = createVariableSchema.parse(await c.req.json());

  if (body.agentId) {
    const agent = await db.query.agents.findFirst({ where: eq(agents.id, body.agentId) });
    if (!agent || agent.userId !== user.userId) {
      return c.json({ error: 'Agent not found' }, 404);
    }

    const [variable] = await db
      .insert(agentVariables)
      .values({
        agentId: body.agentId,
        key: body.key,
        valueEncrypted: encrypt(body.value),
        variableType: body.variableType,
        injectAsEnvVariable: body.injectAsEnvVariable,
        description: body.description,
      })
      .onConflictDoUpdate({
        target: [agentVariables.agentId, agentVariables.key],
        set: {
          valueEncrypted: encrypt(body.value),
          variableType: body.variableType,
          injectAsEnvVariable: body.injectAsEnvVariable,
          description: body.description,
          updatedAt: new Date(),
        },
      })
      .returning({
        id: agentVariables.id,
        agentId: agentVariables.agentId,
        key: agentVariables.key,
        variableType: agentVariables.variableType,
        injectAsEnvVariable: agentVariables.injectAsEnvVariable,
        description: agentVariables.description,
        createdAt: agentVariables.createdAt,
      });

    return c.json({ variable, scope: 'agent' }, 201);
  } else {
    const [variable] = await db
      .insert(userVariables)
      .values({
        userId: user.userId,
        key: body.key,
        valueEncrypted: encrypt(body.value),
        variableType: body.variableType,
        injectAsEnvVariable: body.injectAsEnvVariable,
        description: body.description,
      })
      .onConflictDoUpdate({
        target: [userVariables.userId, userVariables.key],
        set: {
          valueEncrypted: encrypt(body.value),
          variableType: body.variableType,
          injectAsEnvVariable: body.injectAsEnvVariable,
          description: body.description,
          updatedAt: new Date(),
        },
      })
      .returning({
        id: userVariables.id,
        userId: userVariables.userId,
        key: userVariables.key,
        variableType: userVariables.variableType,
        injectAsEnvVariable: userVariables.injectAsEnvVariable,
        description: userVariables.description,
        createdAt: userVariables.createdAt,
      });

    return c.json({ variable, scope: 'user' }, 201);
  }
});

// PUT /:id — update variable (agent or user)
const updateVariableSchema = z.object({
  value: z.string().min(1).max(5000).optional(),
  variableType: z.enum(['property', 'credential']).optional(),
  injectAsEnvVariable: z.boolean().optional(),
  description: z.string().max(300).optional(),
  scope: z.enum(['agent', 'user']).default('agent'),
});

variablesRouter.put('/:id', async (c) => {
  const id = uuidSchema.parse(c.req.param('id'));
  const body = updateVariableSchema.parse(await c.req.json());

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.value) updateData.valueEncrypted = encrypt(body.value);
  if (body.variableType !== undefined) updateData.variableType = body.variableType;
  if (body.injectAsEnvVariable !== undefined) updateData.injectAsEnvVariable = body.injectAsEnvVariable;
  if (body.description !== undefined) updateData.description = body.description;

  if (body.scope === 'user') {
    const [updated] = await db
      .update(userVariables)
      .set(updateData)
      .where(eq(userVariables.id, id))
      .returning({
        id: userVariables.id,
        key: userVariables.key,
        variableType: userVariables.variableType,
        injectAsEnvVariable: userVariables.injectAsEnvVariable,
        description: userVariables.description,
        updatedAt: userVariables.updatedAt,
      });
    if (!updated) return c.json({ error: 'Variable not found' }, 404);
    return c.json({ variable: updated });
  }

  const [updated] = await db
    .update(agentVariables)
    .set(updateData)
    .where(eq(agentVariables.id, id))
    .returning({
      id: agentVariables.id,
      key: agentVariables.key,
      variableType: agentVariables.variableType,
      injectAsEnvVariable: agentVariables.injectAsEnvVariable,
      description: agentVariables.description,
      updatedAt: agentVariables.updatedAt,
    });

  if (!updated) return c.json({ error: 'Variable not found' }, 404);
  return c.json({ variable: updated });
});

// DELETE /:id — remove variable (agent or user)
variablesRouter.delete('/:id', async (c) => {
  const id = uuidSchema.parse(c.req.param('id'));
  const scope = c.req.query('scope');

  if (scope === 'user') {
    await db.delete(userVariables).where(eq(userVariables.id, id));
  } else {
    await db.delete(agentVariables).where(eq(agentVariables.id, id));
  }
  return c.json({ success: true });
});

export default variablesRouter;
