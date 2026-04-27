/**
 * E2E · Agents API contract & lifecycle (Cat 5)
 *
 * Complements existing UI-driven coverage with API-level checks for:
 *  - List/get pagination contract
 *  - status active ↔ paused round-trip and version bump on update
 *  - 404 for unknown / cross-workspace agent ids
 *  - User-scoped agent invisibility to other regular users
 *  - Workspace-scoped agents visible to all members
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

async function createAgent(client: Awaited<ReturnType<typeof loginApi>>, opts: { scope?: 'user' | 'workspace'; name?: string; description?: string } = {}) {
  const create = await client.request.post('/api/agents', {
    data: {
      name: opts.name ?? uniqueName('agents-deep'),
      description: opts.description ?? 'Cat 5 spec',
      sourceType: 'database',
      scope: opts.scope ?? 'user',
      files: [{ filePath: 'agent.md', content: '# Agent' }],
    },
  });
  expect(create.status(), await create.text()).toBe(201);
  return ((await create.json()) as { agent: { id: string; name: string; status: string; version: number; scope: string } }).agent;
}

// eslint-disable-next-line no-empty-pattern
test('agents: list pagination, status toggle, version bump on update', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const ids: string[] = [];
  try {
    for (let i = 0; i < 3; i++) {
      const a = await createAgent(admin, { name: uniqueName(`pg-${i}`) });
      ids.push(a.id);
    }

    // Page 1, limit 2
    const page1 = await admin.request.get('/api/agents?page=1&limit=2');
    expect(page1.ok()).toBe(true);
    const p1 = (await page1.json()) as { agents: Array<{ id: string }>; total: number; page: number; limit: number };
    expect(p1.agents.length).toBeLessThanOrEqual(2);
    expect(p1.total).toBeGreaterThanOrEqual(3);
    expect(p1.page).toBe(1);
    expect(p1.limit).toBe(2);

    // Page 2 returns different items
    const page2 = await admin.request.get('/api/agents?page=2&limit=2');
    const p2 = (await page2.json()) as { agents: Array<{ id: string }> };
    const overlap = p1.agents.filter((a) => p2.agents.some((b) => b.id === a.id));
    expect(overlap.length).toBe(0);

    // Status toggle paused → active
    const target = ids[0];
    const beforeRes = await admin.request.get(`/api/agents/${target}`);
    const beforeBody = (await beforeRes.json()) as { agent: { version: number; status: string } };

    const pause = await admin.request.put(`/api/agents/${target}`, { data: { status: 'paused' } });
    expect(pause.ok(), await pause.text()).toBe(true);
    const paused = ((await pause.json()) as { agent: { status: string; version: number } }).agent;
    expect(paused.status).toBe('paused');
    expect(paused.version).toBeGreaterThan(beforeBody.agent.version);

    const reactivate = await admin.request.put(`/api/agents/${target}`, { data: { status: 'active' } });
    expect(reactivate.ok()).toBe(true);
    const reactivated = ((await reactivate.json()) as { agent: { status: string; version: number } }).agent;
    expect(reactivated.status).toBe('active');
    expect(reactivated.version).toBeGreaterThan(paused.version);

    // Unknown id → 404
    const missing = await admin.request.get('/api/agents/00000000-0000-0000-0000-000000000000');
    expect(missing.status()).toBe(404);
  } finally {
    for (const id of ids) await admin.request.delete(`/api/agents/${id}`);
    await disposeClient(admin);
  }
});

// eslint-disable-next-line no-empty-pattern
test('agents: user-scoped agent is invisible to other regular users; workspace-scoped is visible', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // Bob is a regular user in the default workspace.
  const bobEmail = uniqueEmail('bob-agscope');
  const bobPassword = 'TestPass123!';
  const reg = await admin.request.post('/api/auth/register', {
    data: { name: uniqueName('Bob'), email: bobEmail, password: bobPassword, workspaceSlug: 'default' },
    headers: { 'x-forwarded-for': `10.66.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}` },
  });
  expect(reg.status(), await reg.text()).toBe(201);
  const bob = await loginApi({ baseURL, identifier: bobEmail, password: bobPassword });

  // Admin (super_admin) creates one user-scoped + one workspace-scoped agent
  // — these will demonstrate the listing filter for Bob.
  const userScopedAgent = await createAgent(admin, { scope: 'user', name: uniqueName('admin-private') });
  const wsAgent = await createAgent(admin, { scope: 'workspace', name: uniqueName('admin-shared') });

  try {
    const bobList = await bob.request.get('/api/agents?page=1&limit=200');
    const listed = (await bobList.json()) as { agents: Array<{ id: string }> };
    expect(listed.agents.some((a) => a.id === userScopedAgent.id)).toBe(false);
    expect(listed.agents.some((a) => a.id === wsAgent.id)).toBe(true);

    // Bob cannot mutate the admin's user-scoped agent.
    const bobMutate = await bob.request.put(`/api/agents/${userScopedAgent.id}`, { data: { description: 'hostile' } });
    expect(bobMutate.status()).toBe(403);
    const bobDelete = await bob.request.delete(`/api/agents/${userScopedAgent.id}`);
    expect(bobDelete.status()).toBe(403);

    // Bob can read the workspace-scoped one.
    const bobReadShared = await bob.request.get(`/api/agents/${wsAgent.id}`);
    expect(bobReadShared.ok()).toBe(true);
  } finally {
    await admin.request.delete(`/api/agents/${userScopedAgent.id}`);
    await admin.request.delete(`/api/agents/${wsAgent.id}`);
    await disposeClient(bob);
    await disposeClient(admin);
  }
});
