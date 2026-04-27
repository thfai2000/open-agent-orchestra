/**
 * E2E · Variables CRUD across all 3 scopes (Cat 6)
 *
 * Verifies create/list/get/update/delete for `agent`, `user`, and `workspace`
 * scopes plus the security guarantee that variable values are never exposed
 * back through GET endpoints (only metadata + an opaque version is returned).
 * Also exercises a couple of credential subtypes to ensure they round-trip.
 */

import { test, expect } from './helpers/fixtures';
import { resetSuperAdminPassword, uniqueName } from './helpers/cluster';
import { loginApi, disposeClient } from './helpers/api-auth';

const ADMIN_EMAIL = 'admin@oao.local';
const ADMIN_PASSWORD = 'AdminPass123!';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await resetSuperAdminPassword(ADMIN_PASSWORD);
});

async function createDatabaseAgent(admin: Awaited<ReturnType<typeof loginApi>>, label: string) {
  const create = await admin.request.post('/api/agents', {
    data: {
      name: uniqueName(label),
      description: 'Variables spec agent',
      sourceType: 'database',
      scope: 'user',
      files: [{ filePath: 'agent.md', content: '# Vars Agent' }],
    },
  });
  expect(create.status(), await create.text()).toBe(201);
  return ((await create.json()) as { agent: { id: string } }).agent.id;
}

function uniqueKey(prefix: string) {
  return `${prefix.toUpperCase().replace(/-/g, '_')}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

// eslint-disable-next-line no-empty-pattern
test('variables: workspace scope CRUD with credential subtypes', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const key = uniqueKey('WS_VAR');
  try {
    // Create workspace credential of subtype github_token.
    const create = await admin.request.post('/api/variables', {
      data: {
        scope: 'workspace',
        key,
        value: 'ghp_super_secret_value_123',
        variableType: 'credential',
        credentialSubType: 'github_token',
        description: 'Workspace test token',
      },
    });
    expect(create.status(), await create.text()).toBe(201);
    const created = (await create.json()) as { variable: { id: string; key: string; credentialSubType: string; version: number }; scope: string };
    expect(created.scope).toBe('workspace');
    expect(created.variable.key).toBe(key);
    expect(created.variable.credentialSubType).toBe('github_token');
    expect(created.variable.version).toBeGreaterThanOrEqual(1);
    const id = created.variable.id;

    // List should include it (no value).
    const list = await admin.request.get('/api/variables?scope=workspace');
    expect(list.ok()).toBe(true);
    const listBody = (await list.json()) as { variables: Array<Record<string, unknown>> };
    const found = listBody.variables.find((v) => v.id === id) as Record<string, unknown> | undefined;
    expect(found).toBeTruthy();
    expect('valueEncrypted' in found!).toBe(false);
    expect('value' in found!).toBe(false);

    // GET single returns metadata, no value.
    const get = await admin.request.get(`/api/variables/${id}?scope=workspace`);
    expect(get.ok()).toBe(true);
    const single = ((await get.json()) as { variable: Record<string, unknown> }).variable;
    expect('value' in single).toBe(false);
    expect('valueEncrypted' in single).toBe(false);

    // Update bumps version.
    const upd = await admin.request.put(`/api/variables/${id}`, {
      data: { scope: 'workspace', value: 'ghp_rotated_secret_456', description: 'rotated' },
    });
    expect(upd.ok(), await upd.text()).toBe(true);
    const updated = ((await upd.json()) as { variable: { version: number; description: string } }).variable;
    expect(updated.version).toBeGreaterThan(created.variable.version);
    expect(updated.description).toBe('rotated');

    // Delete.
    const del = await admin.request.delete(`/api/variables/${id}?scope=workspace`);
    expect(del.ok(), await del.text()).toBe(true);

    // Subsequent GET → 404.
    const after = await admin.request.get(`/api/variables/${id}?scope=workspace`);
    expect(after.status()).toBe(404);
  } finally {
    await disposeClient(admin);
  }
});

// eslint-disable-next-line no-empty-pattern
test('variables: user scope CRUD with secret_text', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const key = uniqueKey('USER_VAR');
  try {
    const create = await admin.request.post('/api/variables', {
      data: { scope: 'user', key, value: 'plain-text-secret', variableType: 'credential', credentialSubType: 'secret_text' },
    });
    expect(create.status(), await create.text()).toBe(201);
    const id = ((await create.json()) as { variable: { id: string } }).variable.id;

    const list = await admin.request.get('/api/variables?scope=user');
    expect(list.ok()).toBe(true);
    const listBody = (await list.json()) as { variables: Array<{ id: string }>; scope: string };
    expect(listBody.scope).toBe('user');
    expect(listBody.variables.some((v) => v.id === id)).toBe(true);

    const upd = await admin.request.put(`/api/variables/${id}`, {
      data: { scope: 'user', value: 'updated-secret', description: 'rev2' },
    });
    expect(upd.ok(), await upd.text()).toBe(true);

    const del = await admin.request.delete(`/api/variables/${id}?scope=user`);
    expect(del.ok()).toBe(true);
  } finally {
    await disposeClient(admin);
  }
});

// eslint-disable-next-line no-empty-pattern
test('variables: agent scope CRUD scoped to a specific agent', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const agentId = await createDatabaseAgent(admin, 'vars-agent');
  const key = uniqueKey('AGENT_VAR');

  try {
    const create = await admin.request.post('/api/variables', {
      data: {
        agentId,
        scope: 'agent',
        key,
        value: 'agent-secret',
        variableType: 'property',
        injectAsEnvVariable: true,
      },
    });
    expect(create.status(), await create.text()).toBe(201);
    const id = ((await create.json()) as { variable: { id: string; injectAsEnvVariable: boolean } }).variable.id;

    const list = await admin.request.get(`/api/variables?agentId=${agentId}`);
    expect(list.ok(), await list.text()).toBe(true);
    const body = (await list.json()) as { variables: Array<{ id: string; injectAsEnvVariable: boolean }>; scope: string };
    expect(body.scope).toBe('agent');
    const variable = body.variables.find((v) => v.id === id);
    expect(variable).toBeTruthy();
    expect(variable!.injectAsEnvVariable).toBe(true);

    const get = await admin.request.get(`/api/variables/${id}?scope=agent`);
    expect(get.ok()).toBe(true);

    const upd = await admin.request.put(`/api/variables/${id}`, {
      data: { scope: 'agent', value: 'agent-secret-2' },
    });
    expect(upd.ok(), await upd.text()).toBe(true);

    const del = await admin.request.delete(`/api/variables/${id}?scope=agent`);
    expect(del.ok()).toBe(true);
  } finally {
    await admin.request.delete(`/api/agents/${agentId}`);
    await disposeClient(admin);
  }
});

// eslint-disable-next-line no-empty-pattern
test('variables: rejects invalid keys and missing scope context', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  try {
    // Lowercase key fails Zod regex.
    const bad = await admin.request.post('/api/variables', {
      data: { scope: 'user', key: 'lowercase-key', value: 'x' },
    });
    expect(bad.status()).toBeGreaterThanOrEqual(400);
    expect(bad.status()).toBeLessThan(500);

    // Missing agentId for agent scope (default) is rejected on GET as well.
    const list = await admin.request.get('/api/variables');
    expect(list.status()).toBe(400);
  } finally {
    await disposeClient(admin);
  }
});
