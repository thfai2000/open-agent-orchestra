import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../database/index.js';
import { agentVariables, userVariables, workspaceVariables, agents } from '../database/schema.js';
import { authMiddleware, encrypt, uuidSchema } from '@oao/shared';

const variablesRouter = new Hono();
variablesRouter.use('/*', authMiddleware);

// GET / — list variables (agent-level, user-level, or workspace-level)
// ?agentId=... → agent variables | ?scope=user → user variables | ?scope=workspace → workspace variables
variablesRouter.get('/', async (c) => {
  const user = c.get('user');
  const agentId = c.req.query('agentId');
  const scope = c.req.query('scope');

  if (scope === 'workspace') {
    if (!user.workspaceId) return c.json({ variables: [], scope: 'workspace' });
    const vars = await db.query.workspaceVariables.findMany({
      where: eq(workspaceVariables.workspaceId, user.workspaceId),
      columns: {
        id: true,
        workspaceId: true,
        key: true,
        variableType: true,
        credentialSubType: true,
        injectAsEnvVariable: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return c.json({ variables: vars, scope: 'workspace' });
  }

  if (scope === 'user') {
    const vars = await db.query.userVariables.findMany({
      where: eq(userVariables.userId, user.userId),
      columns: {
        id: true,
        userId: true,
        key: true,
        variableType: true,
        credentialSubType: true,
        injectAsEnvVariable: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return c.json({ variables: vars, scope: 'user' });
  }

  if (!agentId) return c.json({ error: 'agentId or scope=user|workspace query parameter required' }, 400);

  const agent = await db.query.agents.findFirst({ where: eq(agents.id, agentId) });
  if (!agent || agent.workspaceId !== user.workspaceId) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const vars = await db.query.agentVariables.findMany({
    where: eq(agentVariables.agentId, agentId),
    columns: {
      id: true,
      agentId: true,
      key: true,
      variableType: true,
      credentialSubType: true,
      injectAsEnvVariable: true,
      description: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return c.json({ variables: vars, scope: 'agent' });
});

// GET /:id — fetch a single variable metadata record
variablesRouter.get('/:id', async (c) => {
  const id = uuidSchema.parse(c.req.param('id'));
  const user = c.get('user');
  const scope = c.req.query('scope');

  if (scope === 'workspace') {
    const variable = await db.query.workspaceVariables.findFirst({
      where: eq(workspaceVariables.id, id),
      columns: {
        id: true,
        workspaceId: true,
        key: true,
        variableType: true,
        credentialSubType: true,
        injectAsEnvVariable: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!variable || variable.workspaceId !== user.workspaceId) return c.json({ error: 'Variable not found' }, 404);
    return c.json({ variable: { ...variable, scope: 'workspace' } });
  }

  if (scope === 'user') {
    const variable = await db.query.userVariables.findFirst({
      where: eq(userVariables.id, id),
      columns: {
        id: true,
        userId: true,
        key: true,
        variableType: true,
        credentialSubType: true,
        injectAsEnvVariable: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!variable || variable.userId !== user.userId) return c.json({ error: 'Variable not found' }, 404);
    return c.json({ variable: { ...variable, scope: 'user' } });
  }

  if (scope === 'agent') {
    const variable = await db.query.agentVariables.findFirst({
      where: eq(agentVariables.id, id),
      columns: {
        id: true,
        agentId: true,
        key: true,
        variableType: true,
        credentialSubType: true,
        injectAsEnvVariable: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!variable) return c.json({ error: 'Variable not found' }, 404);
    const agent = await db.query.agents.findFirst({ where: eq(agents.id, variable.agentId) });
    if (!agent || agent.workspaceId !== user.workspaceId) return c.json({ error: 'Variable not found' }, 404);

    return c.json({ variable: { ...variable, scope: 'agent' } });
  }

  const userVariable = await db.query.userVariables.findFirst({
    where: eq(userVariables.id, id),
    columns: {
      id: true,
      userId: true,
      key: true,
      variableType: true,
      credentialSubType: true,
      injectAsEnvVariable: true,
      description: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (userVariable && userVariable.userId === user.userId) {
    return c.json({ variable: { ...userVariable, scope: 'user' } });
  }

  const workspaceVariable = await db.query.workspaceVariables.findFirst({
    where: eq(workspaceVariables.id, id),
    columns: {
      id: true,
      workspaceId: true,
      key: true,
      variableType: true,
      credentialSubType: true,
      injectAsEnvVariable: true,
      description: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (workspaceVariable && workspaceVariable.workspaceId === user.workspaceId) {
    return c.json({ variable: { ...workspaceVariable, scope: 'workspace' } });
  }

  const agentVariable = await db.query.agentVariables.findFirst({
    where: eq(agentVariables.id, id),
    columns: {
      id: true,
      agentId: true,
      key: true,
      variableType: true,
      credentialSubType: true,
      injectAsEnvVariable: true,
      description: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!agentVariable) return c.json({ error: 'Variable not found' }, 404);

  const agent = await db.query.agents.findFirst({ where: eq(agents.id, agentVariable.agentId) });
  if (!agent || agent.workspaceId !== user.workspaceId) return c.json({ error: 'Variable not found' }, 404);

  return c.json({ variable: { ...agentVariable, scope: 'agent' } });
});

// POST / — add variable (agent-level, user-level, or workspace-level)
const createVariableSchema = z.object({
  agentId: z.string().uuid().optional(),
  scope: z.enum(['agent', 'user', 'workspace']).default('agent'),
  key: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Z_][A-Z0-9_]*$/, 'Key must be uppercase with underscores'),
  value: z.string().min(1).max(50000),
  variableType: z.enum(['property', 'credential']).default('credential'),
  credentialSubType: z.enum(['secret_text', 'github_token', 'github_app', 'user_account', 'private_key', 'certificate']).default('secret_text'),
  injectAsEnvVariable: z.boolean().default(false),
  description: z.string().max(300).optional(),
});

variablesRouter.post('/', async (c) => {
  const user = c.get('user');
  if (user.role === 'view_user') return c.json({ error: 'View-only users cannot create variables' }, 403);
  const body = createVariableSchema.parse(await c.req.json());

  if (body.scope === 'workspace' || (!body.agentId && body.scope !== 'user')) {
    if (!user.workspaceId) return c.json({ error: 'No workspace context' }, 403);
    if (user.role !== 'workspace_admin' && user.role !== 'super_admin') {
      return c.json({ error: 'Workspace admin access required for workspace variables' }, 403);
    }

    const [variable] = await db
      .insert(workspaceVariables)
      .values({
        workspaceId: user.workspaceId,
        key: body.key,
        valueEncrypted: encrypt(body.value),
        variableType: body.variableType,
        credentialSubType: body.variableType === 'credential' ? body.credentialSubType : 'secret_text',
        injectAsEnvVariable: body.injectAsEnvVariable,
        description: body.description,
      })
      .onConflictDoUpdate({
        target: [workspaceVariables.workspaceId, workspaceVariables.key],
        set: {
          valueEncrypted: encrypt(body.value),
          variableType: body.variableType,
          credentialSubType: body.variableType === 'credential' ? body.credentialSubType : 'secret_text',
          injectAsEnvVariable: body.injectAsEnvVariable,
          description: body.description,
          updatedAt: new Date(),
        },
      })
      .returning({
        id: workspaceVariables.id,
        workspaceId: workspaceVariables.workspaceId,
        key: workspaceVariables.key,
        variableType: workspaceVariables.variableType,
        credentialSubType: workspaceVariables.credentialSubType,
        injectAsEnvVariable: workspaceVariables.injectAsEnvVariable,
        description: workspaceVariables.description,
        createdAt: workspaceVariables.createdAt,
      });

    return c.json({ variable, scope: 'workspace' }, 201);
  }

  if (body.agentId) {
    const agent = await db.query.agents.findFirst({ where: eq(agents.id, body.agentId) });
    if (!agent || agent.workspaceId !== user.workspaceId) {
      return c.json({ error: 'Agent not found' }, 404);
    }

    const [variable] = await db
      .insert(agentVariables)
      .values({
        agentId: body.agentId,
        key: body.key,
        valueEncrypted: encrypt(body.value),
        variableType: body.variableType,
        credentialSubType: body.variableType === 'credential' ? body.credentialSubType : 'secret_text',
        injectAsEnvVariable: body.injectAsEnvVariable,
        description: body.description,
      })
      .onConflictDoUpdate({
        target: [agentVariables.agentId, agentVariables.key],
        set: {
          valueEncrypted: encrypt(body.value),
          variableType: body.variableType,
          credentialSubType: body.variableType === 'credential' ? body.credentialSubType : 'secret_text',
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
        credentialSubType: agentVariables.credentialSubType,
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
        credentialSubType: body.variableType === 'credential' ? body.credentialSubType : 'secret_text',
        injectAsEnvVariable: body.injectAsEnvVariable,
        description: body.description,
      })
      .onConflictDoUpdate({
        target: [userVariables.userId, userVariables.key],
        set: {
          valueEncrypted: encrypt(body.value),
          variableType: body.variableType,
          credentialSubType: body.variableType === 'credential' ? body.credentialSubType : 'secret_text',
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
        credentialSubType: userVariables.credentialSubType,
        injectAsEnvVariable: userVariables.injectAsEnvVariable,
        description: userVariables.description,
        createdAt: userVariables.createdAt,
      });

    return c.json({ variable, scope: 'user' }, 201);
  }
});

// PUT /:id — update variable (agent, user, or workspace)
const updateVariableSchema = z.object({
  value: z.string().min(1).max(50000).optional(),
  variableType: z.enum(['property', 'credential']).optional(),
  credentialSubType: z.enum(['secret_text', 'github_token', 'github_app', 'user_account', 'private_key', 'certificate']).optional(),
  injectAsEnvVariable: z.boolean().optional(),
  description: z.string().max(300).optional(),
  scope: z.enum(['agent', 'user', 'workspace']).default('agent'),
});

variablesRouter.put('/:id', async (c) => {
  const id = uuidSchema.parse(c.req.param('id'));
  const user = c.get('user');
  if (user.role === 'view_user') return c.json({ error: 'View-only users cannot modify variables' }, 403);
  const body = updateVariableSchema.parse(await c.req.json());

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.value) updateData.valueEncrypted = encrypt(body.value);
  if (body.variableType !== undefined) updateData.variableType = body.variableType;
  if (body.credentialSubType !== undefined) updateData.credentialSubType = body.credentialSubType;
  if (body.injectAsEnvVariable !== undefined) updateData.injectAsEnvVariable = body.injectAsEnvVariable;
  if (body.description !== undefined) updateData.description = body.description;

  if (body.scope === 'workspace') {
    if (user.role !== 'workspace_admin' && user.role !== 'super_admin') {
      return c.json({ error: 'Workspace admin access required' }, 403);
    }
    // Verify the workspace variable belongs to the user's workspace
    const existing = await db.query.workspaceVariables.findFirst({ where: eq(workspaceVariables.id, id) });
    if (!existing || existing.workspaceId !== user.workspaceId) return c.json({ error: 'Variable not found' }, 404);
    const [updated] = await db
      .update(workspaceVariables)
      .set(updateData)
      .where(eq(workspaceVariables.id, id))
      .returning({
        id: workspaceVariables.id,
        key: workspaceVariables.key,
        variableType: workspaceVariables.variableType,
        injectAsEnvVariable: workspaceVariables.injectAsEnvVariable,
        description: workspaceVariables.description,
        updatedAt: workspaceVariables.updatedAt,
      });
    if (!updated) return c.json({ error: 'Variable not found' }, 404);
    return c.json({ variable: updated });
  }

  if (body.scope === 'user') {
    // Verify the user variable belongs to the requesting user
    const existing = await db.query.userVariables.findFirst({ where: eq(userVariables.id, id) });
    if (!existing || existing.userId !== user.userId) return c.json({ error: 'Variable not found' }, 404);
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

  // Verify agent variable belongs to an agent in user's workspace
  const existingAgentVar = await db.query.agentVariables.findFirst({ where: eq(agentVariables.id, id) });
  if (!existingAgentVar) return c.json({ error: 'Variable not found' }, 404);
  const agentForVar = await db.query.agents.findFirst({ where: eq(agents.id, existingAgentVar.agentId) });
  if (!agentForVar || agentForVar.workspaceId !== user.workspaceId) return c.json({ error: 'Variable not found' }, 404);

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

// DELETE /:id — remove variable (agent, user, or workspace) with ownership verification
variablesRouter.delete('/:id', async (c) => {
  const id = uuidSchema.parse(c.req.param('id'));
  const user = c.get('user');
  if (user.role === 'view_user') return c.json({ error: 'View-only users cannot delete variables' }, 403);
  const scope = c.req.query('scope');

  if (scope === 'workspace') {
    if (user.role !== 'workspace_admin' && user.role !== 'super_admin') {
      return c.json({ error: 'Workspace admin access required' }, 403);
    }
    // Verify workspace variable belongs to user's workspace
    const existing = await db.query.workspaceVariables.findFirst({ where: eq(workspaceVariables.id, id) });
    if (!existing || existing.workspaceId !== user.workspaceId) return c.json({ error: 'Variable not found' }, 404);
    await db.delete(workspaceVariables).where(eq(workspaceVariables.id, id));
  } else if (scope === 'user') {
    // Verify user variable belongs to the requesting user
    const existing = await db.query.userVariables.findFirst({ where: eq(userVariables.id, id) });
    if (!existing || existing.userId !== user.userId) return c.json({ error: 'Variable not found' }, 404);
    await db.delete(userVariables).where(eq(userVariables.id, id));
  } else {
    // Verify agent variable belongs to an agent in user's workspace
    const existing = await db.query.agentVariables.findFirst({ where: eq(agentVariables.id, id) });
    if (!existing) return c.json({ error: 'Variable not found' }, 404);
    const agent = await db.query.agents.findFirst({ where: eq(agents.id, existing.agentId) });
    if (!agent || agent.workspaceId !== user.workspaceId) return c.json({ error: 'Variable not found' }, 404);
    await db.delete(agentVariables).where(eq(agentVariables.id, id));
  }
  return c.json({ success: true });
});

export default variablesRouter;
