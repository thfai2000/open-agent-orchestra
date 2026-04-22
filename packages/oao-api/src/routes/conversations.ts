import { Hono } from 'hono';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { authMiddleware, paginationSchema, uuidSchema } from '@oao/shared';
import { db } from '../database/index.js';
import { agents, conversations, conversationMessages } from '../database/schema.js';
import { onRealtimeEvent, type RealtimeEvent } from '../services/realtime-bus.js';
import { sendConversationMessage } from '../services/conversation-service.js';

const conversationsRouter = new Hono();
conversationsRouter.use('/*', authMiddleware);

const listConversationsSchema = paginationSchema.extend({
  agentId: z.string().uuid().optional(),
});

const createConversationSchema = z.object({
  agentId: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
});

const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(20000),
});

function userCanUseAgent(agent: typeof agents.$inferSelect, user: { userId: string; role: string; workspaceId?: string | null }) {
  if (agent.workspaceId !== user.workspaceId) return false;
  if (agent.scope === 'workspace') return true;
  if (agent.userId === user.userId) return true;
  return user.role === 'workspace_admin' || user.role === 'super_admin';
}

async function loadConversationForUser(conversationId: string, user: { userId: string; workspaceId?: string | null }) {
  const conversation = await db.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
  });

  if (!conversation) return null;
  if (conversation.workspaceId !== user.workspaceId) return null;
  if (conversation.userId !== user.userId) return null;
  return conversation;
}

conversationsRouter.get('/', async (c) => {
  const user = c.get('user');
  if (!user.workspaceId) return c.json({ conversations: [], total: 0, page: 1, limit: 20 });

  const query = listConversationsSchema.parse(c.req.query());
  const conditions = [
    eq(conversations.workspaceId, user.workspaceId),
    eq(conversations.userId, user.userId),
  ];

  if (query.agentId) {
    conditions.push(eq(conversations.agentId, query.agentId));
  }

  const where = and(...conditions);

  const [rows, countResult] = await Promise.all([
    db
      .select({
        id: conversations.id,
        workspaceId: conversations.workspaceId,
        userId: conversations.userId,
        agentId: conversations.agentId,
        agentNameSnapshot: conversations.agentNameSnapshot,
        title: conversations.title,
        status: conversations.status,
        lastMessageAt: conversations.lastMessageAt,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        messageCount: sql<number>`count(${conversationMessages.id})::int`,
      })
      .from(conversations)
      .leftJoin(conversationMessages, eq(conversationMessages.conversationId, conversations.id))
      .where(where)
      .groupBy(
        conversations.id,
        conversations.workspaceId,
        conversations.userId,
        conversations.agentId,
        conversations.agentNameSnapshot,
        conversations.title,
        conversations.status,
        conversations.lastMessageAt,
        conversations.createdAt,
        conversations.updatedAt,
      )
      .orderBy(desc(conversations.lastMessageAt), desc(conversations.updatedAt))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversations)
      .where(where),
  ]);

  return c.json({
    conversations: rows,
    total: countResult[0]?.count ?? 0,
    page: query.page,
    limit: query.limit,
  });
});

conversationsRouter.post('/', async (c) => {
  const user = c.get('user');
  if (!user.workspaceId) return c.json({ error: 'No workspace selected' }, 400);

  const body = createConversationSchema.parse(await c.req.json());
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, body.agentId),
  });

  if (!agent || !userCanUseAgent(agent, user)) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  if (agent.status !== 'active') {
    return c.json({ error: `Agent ${agent.name} is not active.` }, 400);
  }

  const now = new Date();
  const title = body.title?.trim() || `${agent.name} Conversation ${now.toISOString().slice(0, 10)}`;
  const [conversation] = await db
    .insert(conversations)
    .values({
      workspaceId: user.workspaceId,
      userId: user.userId,
      agentId: agent.id,
      agentNameSnapshot: agent.name,
      title,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return c.json({ conversation }, 201);
});

conversationsRouter.get('/:id', async (c) => {
  const user = c.get('user');
  const conversationId = uuidSchema.parse(c.req.param('id'));

  const conversation = await loadConversationForUser(conversationId, user);
  if (!conversation) return c.json({ error: 'Conversation not found' }, 404);

  const [messages, agent] = await Promise.all([
    db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversationId))
      .orderBy(asc(conversationMessages.createdAt)),
    conversation.agentId
      ? db.query.agents.findFirst({ where: eq(agents.id, conversation.agentId) })
      : Promise.resolve(null),
  ]);

  return c.json({
    conversation,
    messages,
    agent: agent
      ? {
          id: agent.id,
          name: agent.name,
          status: agent.status,
          scope: agent.scope,
        }
      : null,
  });
});

conversationsRouter.post('/:id/messages', async (c) => {
  const user = c.get('user');
  if (!user.workspaceId) return c.json({ error: 'No workspace selected' }, 400);

  const conversationId = uuidSchema.parse(c.req.param('id'));
  const body = sendMessageSchema.parse(await c.req.json());

  const conversation = await loadConversationForUser(conversationId, user);
  if (!conversation) return c.json({ error: 'Conversation not found' }, 404);
  if (conversation.status !== 'active') return c.json({ error: 'Conversation is archived' }, 400);

  try {
    const result = await sendConversationMessage({
      conversation,
      content: body.content,
      userId: user.userId,
      workspaceId: user.workspaceId,
    });

    return c.json(result, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send conversation message.';
    const status = message.includes('busy') ? 409 : 400;
    return c.json({ error: message }, status);
  }
});

conversationsRouter.get('/:id/stream', async (c) => {
  const user = c.get('user');
  const conversationId = uuidSchema.parse(c.req.param('id'));

  const conversation = await loadConversationForUser(conversationId, user);
  if (!conversation) return c.json({ error: 'Conversation not found' }, 404);

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // stream closed
        }
      };

      send('connected', { conversationId });

      const unsubscribe = onRealtimeEvent((event: RealtimeEvent) => {
        if (event.conversationId !== conversationId) return;
        send(event.type, event);
      });

      c.req.raw.signal.addEventListener('abort', () => {
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

export default conversationsRouter;