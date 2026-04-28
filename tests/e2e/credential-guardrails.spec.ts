/**
 * E2E · Workspace Settings + Credential Guardrails (v3.1)
 *
 * Covers:
 *  - GET/PUT /api/admin/settings round-trip for the v3.1 workspace fields:
 *      · ephemeralKeepAliveMs
 *      · staticCleanupIntervalMs
 *      · disallowCredentialAccessViaTools
 *  - Bounds validation rejects out-of-range lifecycle values.
 *  - Defense-in-depth: even when the workspace flag is FORCED OFF, the public
 *    /api/variables endpoints never expose credential plaintext.
 *  - The flag is restored to its default (true) after the spec, so subsequent
 *    specs continue to enforce the guardrail.
 */

import { test, expect } from './helpers/fixtures';
import { resetSuperAdminPassword } from './helpers/cluster';
import { loginApi, disposeClient } from './helpers/api-auth';

const ADMIN_EMAIL = 'admin@oao.local';
const ADMIN_PASSWORD = 'AdminPass123!';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await resetSuperAdminPassword(ADMIN_PASSWORD);
});

interface WorkspaceSettings {
  allowRegistration: boolean;
  allowPasswordReset: boolean;
  ephemeralKeepAliveMs: number;
  staticCleanupIntervalMs: number;
  disallowCredentialAccessViaTools: boolean;
}

// eslint-disable-next-line no-empty-pattern
test('workspace settings: GET returns the v3.1 fields with safe defaults', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  try {
    const res = await admin.request.get('/api/admin/settings');
    expect(res.ok(), await res.text()).toBe(true);
    const body = (await res.json()) as WorkspaceSettings;

    expect(typeof body.allowRegistration).toBe('boolean');
    expect(typeof body.allowPasswordReset).toBe('boolean');
    expect(body.ephemeralKeepAliveMs).toBeGreaterThanOrEqual(60_000);
    expect(body.ephemeralKeepAliveMs).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
    expect(body.staticCleanupIntervalMs).toBeGreaterThanOrEqual(60_000);
    expect(body.staticCleanupIntervalMs).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000);
    // Default is ON — credentials are blocked from agent tools.
    expect(body.disallowCredentialAccessViaTools).toBe(true);
  } finally {
    await disposeClient(admin);
  }
});

// eslint-disable-next-line no-empty-pattern
test('workspace settings: PUT round-trips and rejects out-of-range values', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  try {
    // Capture current state so we can restore.
    const before = (await (await admin.request.get('/api/admin/settings')).json()) as WorkspaceSettings;

    // Below the lower bound — must reject.
    const tooSmall = await admin.request.put('/api/admin/settings', {
      data: { ephemeralKeepAliveMs: 1000 }, // < 60_000
    });
    expect(tooSmall.status()).toBe(400);

    // Above the upper bound — must reject.
    const tooBig = await admin.request.put('/api/admin/settings', {
      data: { staticCleanupIntervalMs: 365 * 24 * 60 * 60 * 1000 }, // > 30d
    });
    expect(tooBig.status()).toBe(400);

    // Valid update.
    const ok = await admin.request.put('/api/admin/settings', {
      data: {
        ephemeralKeepAliveMs: 30 * 60 * 1000, // 30 min
        staticCleanupIntervalMs: 6 * 60 * 60 * 1000, // 6h
      },
    });
    expect(ok.ok(), await ok.text()).toBe(true);

    const after = (await (await admin.request.get('/api/admin/settings')).json()) as WorkspaceSettings;
    expect(after.ephemeralKeepAliveMs).toBe(30 * 60 * 1000);
    expect(after.staticCleanupIntervalMs).toBe(6 * 60 * 60 * 1000);

    // Restore.
    const restore = await admin.request.put('/api/admin/settings', {
      data: {
        ephemeralKeepAliveMs: before.ephemeralKeepAliveMs,
        staticCleanupIntervalMs: before.staticCleanupIntervalMs,
      },
    });
    expect(restore.ok()).toBe(true);
  } finally {
    await disposeClient(admin);
  }
});

// eslint-disable-next-line no-empty-pattern
test('credential guardrail: variables endpoints never leak credential plaintext, regardless of flag', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const SECRET_VALUE = 'guardrail_e2e_secret_' + Math.random().toString(36).slice(2, 10);
  const key = `GUARD_E2E_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  let varId: string | null = null;
  let originalFlag = true;

  try {
    // Capture original flag, then force it OFF for the most aggressive test.
    const before = (await (await admin.request.get('/api/admin/settings')).json()) as WorkspaceSettings;
    originalFlag = before.disallowCredentialAccessViaTools;

    const flip = await admin.request.put('/api/admin/settings', {
      data: { disallowCredentialAccessViaTools: false },
    });
    expect(flip.ok()).toBe(true);

    // Create a workspace credential.
    const create = await admin.request.post('/api/variables', {
      data: {
        scope: 'workspace',
        key,
        value: SECRET_VALUE,
        variableType: 'credential',
        credentialSubType: 'secret_text',
        description: 'E2E guardrail test',
      },
    });
    expect(create.status(), await create.text()).toBe(201);
    const created = (await create.json()) as { variable: { id: string } };
    varId = created.variable.id;

    // List and Get must not contain the plaintext value, ever.
    const list = await admin.request.get('/api/variables?scope=workspace');
    expect(list.ok()).toBe(true);
    expect(await list.text()).not.toContain(SECRET_VALUE);

    const single = await admin.request.get(`/api/variables/${varId}?scope=workspace`);
    expect(single.ok()).toBe(true);
    expect(await single.text()).not.toContain(SECRET_VALUE);

    // Re-enable the guardrail (the user-required default) and verify it sticks.
    const enable = await admin.request.put('/api/admin/settings', {
      data: { disallowCredentialAccessViaTools: true },
    });
    expect(enable.ok()).toBe(true);
    const after = (await (await admin.request.get('/api/admin/settings')).json()) as WorkspaceSettings;
    expect(after.disallowCredentialAccessViaTools).toBe(true);
  } finally {
    if (varId) {
      await admin.request.delete(`/api/variables/${varId}?scope=workspace`).catch(() => {});
    }
    // Restore the guardrail to whatever it was before the spec ran.
    await admin.request.put('/api/admin/settings', {
      data: { disallowCredentialAccessViaTools: originalFlag },
    }).catch(() => {});
    await disposeClient(admin);
  }
});

// eslint-disable-next-line no-empty-pattern
test('legacy /api/admin/security continues to work after merge into /admin/settings', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  try {
    const res = await admin.request.get('/api/admin/security');
    expect(res.ok(), await res.text()).toBe(true);
    const body = (await res.json()) as { allowRegistration: boolean; allowPasswordReset: boolean };
    expect(typeof body.allowRegistration).toBe('boolean');
    expect(typeof body.allowPasswordReset).toBe('boolean');
  } finally {
    await disposeClient(admin);
  }
});
