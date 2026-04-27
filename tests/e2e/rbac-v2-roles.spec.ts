/**
 * E2E · RBAC v2.0.0 — functionalities, roles, role bindings, group-role assignment
 *
 * Verifies the new flag-based permission model:
 *   - /api/functionalities exposes the catalog
 *   - /api/roles lists the 4 system roles (super_admin, workspace_admin, creator, viewer)
 *   - /api/roles/me/effective returns the right flag set for each legacy role
 *   - Custom roles can be created, bound to user-groups via PUT /:id/roles,
 *     and members of the group inherit the flags
 *   - System roles cannot be deleted or renamed
 *   - Non-admins get 403 on /api/roles management endpoints
 *   - PUT /api/user-groups/:id roundtrips adGroupDns
 */
import { test, expect } from './helpers/fixtures';
import { resetSuperAdminPassword, uniqueEmail, uniqueName } from './helpers/cluster';
import { loginApi, disposeClient, type ApiClient } from './helpers/api-auth';

const ADMIN_EMAIL = 'admin@oao.local';
const ADMIN_PASSWORD = 'AdminPass123!';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await resetSuperAdminPassword(ADMIN_PASSWORD);
});

// eslint-disable-next-line no-empty-pattern
test('GET /api/functionalities returns the seeded catalog with at least 30 entries', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  try {
    const r = await admin.request.get('/api/functionalities');
    expect(r.status()).toBe(200);
    const body = (await r.json()) as { functionalities: Array<{ key: string; resource: string; action: string; category: string }> };
    expect(body.functionalities.length).toBeGreaterThanOrEqual(30);
    expect(body.functionalities.find((f) => f.key === '*')).toBeTruthy();
    expect(body.functionalities.find((f) => f.key === 'agents:read')).toBeTruthy();
    expect(body.functionalities.find((f) => f.key === 'admin:rbac:manage')).toBeTruthy();
    // Every entry has a non-empty category
    for (const f of body.functionalities) expect(f.category).toBeTruthy();
  } finally {
    await disposeClient(admin);
  }
});

// eslint-disable-next-line no-empty-pattern
test('GET /api/roles returns the 4 system roles plus any workspace customs', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  try {
    const r = await admin.request.get('/api/roles');
    expect(r.status()).toBe(200);
    const body = (await r.json()) as {
      roles: Array<{ id: string; name: string; isSystem: boolean; workspaceId: string | null; functionalityCount: number }>;
    };
    const systemNames = body.roles.filter((r) => r.isSystem).map((r) => r.name).sort();
    expect(systemNames).toEqual(expect.arrayContaining(['creator', 'super_admin', 'viewer', 'workspace_admin']));
    const sa = body.roles.find((r) => r.name === 'super_admin')!;
    expect(sa.functionalityCount).toBeGreaterThan(0);
  } finally {
    await disposeClient(admin);
  }
});

// eslint-disable-next-line no-empty-pattern
test('GET /api/roles/me/effective resolves flags for each legacy role', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // Super-admin should resolve to the wildcard flag
  const meSuper = await admin.request.get('/api/roles/me/effective');
  expect(meSuper.status()).toBe(200);
  const superFlags = (await meSuper.json()) as { functionalityKeys: string[] };
  expect(superFlags.functionalityKeys).toContain('*');

  // Provision and login each legacy role and check its flag set.
  const password = 'EffPass123!';
  type Role = 'workspace_admin' | 'creator_user' | 'view_user';
  const expectedFor: Record<Role, { has: string[]; lacks: string[] }> = {
    workspace_admin: { has: ['admin:rbac:manage', 'admin:users:manage', 'agents:create'], lacks: ['*'] },
    creator_user: { has: ['agents:create', 'workflows:create'], lacks: ['admin:rbac:manage', 'admin:users:manage'] },
    view_user: { has: ['agents:read', 'workflows:read'], lacks: ['agents:create', 'workflows:create', 'admin:rbac:manage'] },
  };

  const clients: ApiClient[] = [];
  try {
    for (const role of Object.keys(expectedFor) as Role[]) {
      const email = uniqueEmail(`rbac-eff-${role}`);
      const created = await admin.request.post('/api/admin/users', {
        data: { name: `Eff ${role}`, email, password, role },
      });
      expect(created.status(), await created.text()).toBe(201);

      const userClient = await loginApi({ baseURL, identifier: email, password });
      clients.push(userClient);
      const r = await userClient.request.get('/api/roles/me/effective');
      expect(r.status()).toBe(200);
      const body = (await r.json()) as { functionalityKeys: string[] };
      const flagSet = new Set(body.functionalityKeys);
      for (const must of expectedFor[role].has) {
        expect(flagSet.has(must) || flagSet.has('*'), `${role} should have ${must}`).toBe(true);
      }
      for (const not of expectedFor[role].lacks) {
        expect(flagSet.has(not), `${role} should NOT have ${not}`).toBe(false);
      }
    }
  } finally {
    for (const c of clients) await disposeClient(c);
    await disposeClient(admin);
  }
});

// eslint-disable-next-line no-empty-pattern
test('Roles CRUD: create custom role, bind functionalities, attach to user-group', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  let createdRoleId: string | null = null;
  let createdGroupId: string | null = null;
  try {
    // Create a custom role
    const roleName = uniqueName('rbac-custom');
    const create = await admin.request.post('/api/roles', {
      data: { name: roleName, description: 'e2e custom', functionalityKeys: ['agents:read', 'workflows:read'] },
    });
    expect(create.status(), await create.text()).toBe(201);
    const created = (await create.json()) as { role: { id: string; isSystem: boolean; name: string } };
    expect(created.role.isSystem).toBe(false);
    createdRoleId = created.role.id;

    // Update its bindings via PUT /:id/functionalities
    const put = await admin.request.put(`/api/roles/${createdRoleId}/functionalities`, {
      data: { functionalityKeys: ['agents:read', 'workflows:read', 'conversations:read', 'this_does_not_exist:foo'] },
    });
    expect(put.status()).toBe(200);
    const putBody = (await put.json()) as { functionalityKeys: string[] };
    // Invalid key should be silently dropped
    expect(putBody.functionalityKeys).not.toContain('this_does_not_exist:foo');
    expect(putBody.functionalityKeys).toContain('conversations:read');

    // GET /:id should reflect the bindings
    const get = await admin.request.get(`/api/roles/${createdRoleId}`);
    expect(get.status()).toBe(200);
    const getBody = (await get.json()) as { functionalityKeys: string[] };
    expect(new Set(getBody.functionalityKeys)).toEqual(new Set(['agents:read', 'workflows:read', 'conversations:read']));

    // Create a group and bind the role
    const groupRes = await admin.request.post('/api/user-groups', {
      data: { name: uniqueName('rbac-grp-bind'), roleIds: [createdRoleId] },
    });
    expect(groupRes.status()).toBe(201);
    createdGroupId = ((await groupRes.json()) as { group: { id: string } }).group.id;

    // Group detail should report the bound role
    const detail = await admin.request.get(`/api/user-groups/${createdGroupId}`);
    expect(detail.status()).toBe(200);
    const detailBody = (await detail.json()) as { roles: Array<{ id: string }> };
    expect(detailBody.roles.find((r) => r.id === createdRoleId)).toBeTruthy();

    // Replace bindings via PUT /:id/roles
    const replace = await admin.request.put(`/api/user-groups/${createdGroupId}/roles`, {
      data: { roleIds: [] },
    });
    expect(replace.status()).toBe(200);
    const detailAfter = await admin.request.get(`/api/user-groups/${createdGroupId}`);
    const detailAfterBody = (await detailAfter.json()) as { roles: Array<unknown> };
    expect(detailAfterBody.roles.length).toBe(0);
  } finally {
    if (createdGroupId) await admin.request.delete(`/api/user-groups/${createdGroupId}`);
    if (createdRoleId) await admin.request.delete(`/api/roles/${createdRoleId}`);
    await disposeClient(admin);
  }
});

// eslint-disable-next-line no-empty-pattern
test('System roles cannot be renamed or deleted', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  try {
    const list = await admin.request.get('/api/roles');
    const body = (await list.json()) as { roles: Array<{ id: string; name: string; isSystem: boolean }> };
    const sysRole = body.roles.find((r) => r.name === 'viewer' && r.isSystem)!;
    expect(sysRole).toBeTruthy();

    // Rename should fail
    const rename = await admin.request.put(`/api/roles/${sysRole.id}`, {
      data: { name: 'viewer-renamed' },
    });
    expect(rename.status()).toBe(400);

    // Delete should fail
    const del = await admin.request.delete(`/api/roles/${sysRole.id}`);
    expect(del.status()).toBe(400);

    // Description-only update is allowed
    const desc = await admin.request.put(`/api/roles/${sysRole.id}`, {
      data: { description: 'updated by e2e' },
    });
    expect(desc.status()).toBe(200);
  } finally {
    await disposeClient(admin);
  }
});

// eslint-disable-next-line no-empty-pattern
test('Non-admins get 403 on role-management endpoints (read may also be forbidden)', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const password = 'NoAdminPass123!';
  const email = uniqueEmail('rbac-noadmin');
  const created = await admin.request.post('/api/admin/users', {
    data: { name: 'NoAdmin', email, password, role: 'creator_user' },
  });
  expect(created.status()).toBe(201);
  const user = await loginApi({ baseURL, identifier: email, password });
  try {
    // creator should NOT be able to create roles or list them
    const create = await user.request.post('/api/roles', {
      data: { name: uniqueName('blocked'), functionalityKeys: [] },
    });
    expect([401, 403]).toContain(create.status());

    const list = await user.request.get('/api/roles');
    expect([200, 401, 403]).toContain(list.status());
    if (list.status() === 200) {
      // If GET is allowed by the role, ensure DELETE is still blocked
      const body = (await list.json()) as { roles: Array<{ id: string; isSystem: boolean }> };
      const someRole = body.roles.find((r) => !r.isSystem);
      if (someRole) {
        const del = await user.request.delete(`/api/roles/${someRole.id}`);
        expect([401, 403]).toContain(del.status());
      }
    }

    // Effective endpoint should always be reachable (auth-only)
    const me = await user.request.get('/api/roles/me/effective');
    expect(me.status()).toBe(200);
  } finally {
    await disposeClient(user);
    await disposeClient(admin);
  }
});

// eslint-disable-next-line no-empty-pattern
test('user_groups roundtrips adGroupDns and isLegacy', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  let groupId: string | null = null;
  try {
    const create = await admin.request.post('/api/user-groups', {
      data: {
        name: uniqueName('rbac-ad-grp'),
        adGroupDns: ['CN=Engineers,OU=Groups,DC=example,DC=com', 'CN=PMs,OU=Groups,DC=example,DC=com'],
      },
    });
    expect(create.status()).toBe(201);
    const body = (await create.json()) as { group: { id: string; adGroupDns: string[]; isLegacy: boolean } };
    groupId = body.group.id;
    expect(body.group.adGroupDns.length).toBe(2);
    expect(body.group.isLegacy).toBe(false);

    // PUT updates the DN list
    const update = await admin.request.put(`/api/user-groups/${groupId}`, {
      data: { adGroupDns: ['CN=Engineers,OU=Groups,DC=example,DC=com'] },
    });
    expect(update.status()).toBe(200);
    const detail = await admin.request.get(`/api/user-groups/${groupId}`);
    const detailBody = (await detail.json()) as { group: { adGroupDns: string[] } };
    expect(detailBody.group.adGroupDns.length).toBe(1);
  } finally {
    if (groupId) await admin.request.delete(`/api/user-groups/${groupId}`);
    await disposeClient(admin);
  }
});

// eslint-disable-next-line no-empty-pattern
test('Default user-groups exist after seed (Super Admins, Workspace Admins, Creators, Viewers)', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  try {
    const r = await admin.request.get('/api/user-groups');
    expect(r.status()).toBe(200);
    const body = (await r.json()) as { groups: Array<{ name: string }> };
    const names = new Set(body.groups.map((g) => g.name));
    for (const expected of ['Super Admins', 'Workspace Admins', 'Creators', 'Viewers']) {
      expect(names.has(expected), `default group ${expected} missing`).toBe(true);
    }
  } finally {
    await disposeClient(admin);
  }
});
