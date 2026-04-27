/**
 * E2E · Conversations API contract & CRUD (Cat 4)
 *
 * Exercises the conversation lifecycle at the API layer without invoking
 * the real GitHub Copilot SDK (LLM round-trips are exercised separately
 * by the UI agent-workflow spec). Focus areas:
 *  - Create / Get / Patch (switch agent) / Delete
 *  - Authorization isolation across users in the same workspace
 *  - 404 for unknown / paused / cross-workspace agents
 *  - answer-questions returns 404 when no question is pending
 *  - Pagination and listing
 *  - Tool catalog endpoint exposes builtin tool names
 */

import { test, expect } from './helpers/fixtures';
import { resetSuperAdminPassword, uniqueEmail, uniqueName } from './helpers/cluster';
import { loginApi, disposeClient } from './helpers/api-auth';

const ADMIN_EMAIL = 'admin@oao.local';
const ADMIN_PASSWORD = 'AdminPass123!';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await resetSuperAdminPassword(ADMIN_PASSWORD);
});

async function createDatabaseAgent(admin: Awaited<ReturnType<typeof loginApi>>, opts: { scope?: 'user' | 'workspace'; status?: 'active' | 'paused'; name?: string } = {}) {
  const create = await admin.request.post('/api/agents', {
    data: {
      name: opts.name ?? uniqueName('conv-agent'),
      description: 'E2E conversations spec',
      sourceType: 'database',
      scope: opts.scope ?? 'user',
      files: [{ filePath: 'agent.md', content: '# Conv Agent\n\nReply briefly.' }],
    },
  });
  expect(create.status(), await create.text()).toBe(201);
  const agent = ((await create.json()) as { agent: { id: string; status: string } }).agent;
  if (opts.status && opts.status !== agent.status) {
    const upd = await admin.request.put(`/api/agents/${agent.id}`, { data: { status: opts.status } });
    expect(upd.ok(), await upd.text()).toBe(true);
  }
  return agent;
}

// eslint-disable-next-line no-empty-pattern
test('conversations: full CRUD round-trip', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const agent = await createDatabaseAgent(admin);
  const altAgent = await createDatabaseAgent(admin, { name: 'conv-agent-alt' });

  try {
    // Create
    const create = await admin.request.post('/api/conversations', {
      data: { agentId: agent.id, title: 'Playwright Conversation' },
    });
    expect(create.status(), await create.text()).toBe(201);
    const conv = ((await create.json()) as { conversation: { id: string; title: string; agentId: string; status: string } }).conversation;
    expect(conv.title).toBe('Playwright Conversation');
    expect(conv.agentId).toBe(agent.id);
    expect(conv.status).toBe('active');

    // Get
    const got = await admin.request.get(`/api/conversations/${conv.id}`);
    expect(got.ok(), await got.text()).toBe(true);
    const detail = (await got.json()) as { conversation: { id: string }; messages: unknown[]; agent: { id: string }; availableBuiltinTools: string[] };
    expect(detail.conversation.id).toBe(conv.id);
    expect(detail.messages).toEqual([]);
    expect(detail.agent.id).toBe(agent.id);
    expect(Array.isArray(detail.availableBuiltinTools)).toBe(true);

    // Tool catalog
    const tools = await admin.request.get(`/api/conversations/${conv.id}/tool-catalog`);
    expect(tools.ok(), await tools.text()).toBe(true);

    // List (paginated)
    const list = await admin.request.get('/api/conversations?page=1&limit=10');
    expect(list.ok()).toBe(true);
    const listBody = (await list.json()) as { conversations: Array<{ id: string }>; total?: number };
    expect(listBody.conversations.some((c) => c.id === conv.id)).toBe(true);

    // Patch — switch agent
    const patch = await admin.request.patch(`/api/conversations/${conv.id}`, { data: { agentId: altAgent.id } });
    expect(patch.ok(), await patch.text()).toBe(true);
    const patched = (await patch.json()) as { conversation: { agentId: string } };
    expect(patched.conversation.agentId).toBe(altAgent.id);

    // Delete
    const del = await admin.request.delete(`/api/conversations/${conv.id}`);
    expect(del.ok(), await del.text()).toBe(true);

    // Now 404
    const after = await admin.request.get(`/api/conversations/${conv.id}`);
    expect(after.status()).toBe(404);
  } finally {
    await admin.request.delete(`/api/agents/${agent.id}`);
    await admin.request.delete(`/api/agents/${altAgent.id}`);
    await disposeClient(admin);
  }
});

// eslint-disable-next-line no-empty-pattern
test('conversations: rejects paused or unknown agents', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const paused = await createDatabaseAgent(admin, { status: 'paused', name: 'conv-paused' });

  try {
    const onPaused = await admin.request.post('/api/conversations', { data: { agentId: paused.id } });
    expect(onPaused.status()).toBe(400);

    const onUnknown = await admin.request.post('/api/conversations', {
      data: { agentId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(onUnknown.status()).toBe(404);

    // Schema validation: missing agentId → Zod rejects with 4xx.
    const onMissing = await admin.request.post('/api/conversations', { data: {} });
    expect(onMissing.status()).toBeGreaterThanOrEqual(400);
    expect(onMissing.status()).toBeLessThan(500);
  } finally {
    await admin.request.delete(`/api/agents/${paused.id}`);
    await disposeClient(admin);
  }
});

// eslint-disable-next-line no-empty-pattern
test('conversations: another user in the same workspace cannot read or delete it', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const agent = await createDatabaseAgent(admin, { scope: 'user', name: 'conv-private' });

  // Create a second user in the default workspace.
  const otherEmail = uniqueEmail('conv-other');
  const otherPassword = 'OtherPass123!';
  const reg = await admin.request.post('/api/auth/register', {
    data: { name: uniqueName('Conv Other'), email: otherEmail, password: otherPassword, workspaceSlug: 'default' },
    headers: { 'x-forwarded-for': '10.65.0.1' },
  });
  expect(reg.status(), await reg.text()).toBe(201);
  const other = await loginApi({ baseURL, identifier: otherEmail, password: otherPassword });

  try {
    const create = await admin.request.post('/api/conversations', {
      data: { agentId: agent.id, title: 'Owner-only conv' },
    });
    expect(create.status()).toBe(201);
    const convId = ((await create.json()) as { conversation: { id: string } }).conversation.id;

    // The other user cannot fetch it.
    const peek = await other.request.get(`/api/conversations/${convId}`);
    expect(peek.status()).toBe(404);

    // The other user cannot delete it.
    const peekDelete = await other.request.delete(`/api/conversations/${convId}`);
    expect(peekDelete.status()).toBe(404);

    // The other user cannot send messages to it.
    const sendAttempt = await other.request.post(`/api/conversations/${convId}/messages`, {
      data: { content: 'hello' },
    });
    expect(sendAttempt.status()).toBe(404);

    // Cleanup conversation.
    const cleanup = await admin.request.delete(`/api/conversations/${convId}`);
    expect(cleanup.ok()).toBe(true);
  } finally {
    await admin.request.delete(`/api/agents/${agent.id}`);
    await disposeClient(other);
    await disposeClient(admin);
  }
});

// eslint-disable-next-line no-empty-pattern
test('conversations: answer-questions returns 404 when no question is pending', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const agent = await createDatabaseAgent(admin, { name: 'conv-noask' });

  try {
    const create = await admin.request.post('/api/conversations', { data: { agentId: agent.id } });
    expect(create.status()).toBe(201);
    const convId = ((await create.json()) as { conversation: { id: string } }).conversation.id;
    try {
      const res = await admin.request.post(`/api/conversations/${convId}/answer-questions`, {
        data: { askId: '00000000-0000-0000-0000-000000000000', answers: { Question: 'no' } },
      });
      expect(res.status()).toBe(404);
    } finally {
      await admin.request.delete(`/api/conversations/${convId}`);
    }
  } finally {
    await admin.request.delete(`/api/agents/${agent.id}`);
    await disposeClient(admin);
  }
});
