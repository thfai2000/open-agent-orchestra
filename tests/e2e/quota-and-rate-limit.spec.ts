/**
 * E2E · Quota settings + rate-limit edges (Cat 9 + Cat 10)
 *
 * - Cat 9: GET/PUT /api/quota/settings round-trip on the current user.
 *   Verifies decimal-string acceptance and the workspace-defaults shape.
 * - Cat 10: hammers /api/auth/login from a fixed IP to confirm the
 *   per-IP rate-limit kicks in at the documented threshold (10/min) and
 *   surfaces 429 with `X-RateLimit-*` headers + Retry-After.
 */

import { request as playwrightRequest } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import { resetSuperAdminPassword } from './helpers/cluster';
import { loginApi, disposeClient } from './helpers/api-auth';

const ADMIN_EMAIL = 'admin@oao.local';
const ADMIN_PASSWORD = 'AdminPass123!';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await resetSuperAdminPassword(ADMIN_PASSWORD);
});

// eslint-disable-next-line no-empty-pattern
test('quota: GET /settings returns userSettings + workspaceSettings shapes', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  try {
    const res = await admin.request.get('/api/quota/settings');
    expect(res.ok(), await res.text()).toBe(true);
    const body = (await res.json()) as {
      userSettings: { dailyCreditLimit: string | null; weeklyCreditLimit: string | null; monthlyCreditLimit: string | null };
      workspaceSettings: { dailyCreditLimit: string | null; weeklyCreditLimit: string | null; monthlyCreditLimit: string | null };
    };
    expect(body).toHaveProperty('userSettings');
    expect(body).toHaveProperty('workspaceSettings');
    expect(body.userSettings).toHaveProperty('dailyCreditLimit');
    expect(body.userSettings).toHaveProperty('weeklyCreditLimit');
    expect(body.userSettings).toHaveProperty('monthlyCreditLimit');
  } finally {
    await disposeClient(admin);
  }
});

// eslint-disable-next-line no-empty-pattern
test('quota: PUT /settings persists per-user limits and round-trips', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  try {
    const upd = await admin.request.put('/api/quota/settings', {
      data: { dailyCreditLimit: '12.50', weeklyCreditLimit: '75.00', monthlyCreditLimit: '300.00' },
    });
    expect(upd.ok(), await upd.text()).toBe(true);

    const after = await admin.request.get('/api/quota/settings');
    const body = (await after.json()) as { userSettings: { dailyCreditLimit: string; weeklyCreditLimit: string; monthlyCreditLimit: string } };
    expect(body.userSettings.dailyCreditLimit).toBe('12.50');
    expect(body.userSettings.weeklyCreditLimit).toBe('75.00');
    expect(body.userSettings.monthlyCreditLimit).toBe('300.00');

    // Clearing a limit (set to null) is allowed.
    const cleared = await admin.request.put('/api/quota/settings', {
      data: { dailyCreditLimit: null, weeklyCreditLimit: null, monthlyCreditLimit: null },
    });
    expect(cleared.ok(), await cleared.text()).toBe(true);
    const after2 = await admin.request.get('/api/quota/settings');
    const body2 = (await after2.json()) as { userSettings: { dailyCreditLimit: string | null } };
    expect(body2.userSettings.dailyCreditLimit).toBeNull();

    // Bad format → 4xx (Zod regex requires up to 2 decimals).
    const bad = await admin.request.put('/api/quota/settings', {
      data: { dailyCreditLimit: 'not-a-number' },
    });
    expect(bad.status()).toBeGreaterThanOrEqual(400);
    expect(bad.status()).toBeLessThan(500);
  } finally {
    await disposeClient(admin);
  }
});

// eslint-disable-next-line no-empty-pattern
test('rate-limit: /api/auth/* enforces 10/minute per IP and returns 429 with headers', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  // Use a deterministic, never-before-seen IP so we don't trip another test's window.
  const ip = `10.99.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  const ctx = await playwrightRequest.newContext({ baseURL, extraHTTPHeaders: { 'x-forwarded-for': ip } });
  try {
    let firstLimit: string | null = null;
    let saw429 = false;
    let retryAfter: string | null = null;
    let firstRemaining: string | null = null;

    // Burst — well above the 10/min ceiling.
    for (let i = 0; i < 14; i++) {
      const res = await ctx.post('/api/auth/login', {
        data: { identifier: 'no-such-user@example.invalid', password: 'irrelevant', provider: 'database' },
      });
      const limit = res.headers()['x-ratelimit-limit'];
      const remaining = res.headers()['x-ratelimit-remaining'];
      if (firstLimit === null && limit) firstLimit = limit;
      if (firstRemaining === null && remaining) firstRemaining = remaining;
      if (res.status() === 429) {
        saw429 = true;
        retryAfter = res.headers()['retry-after'] ?? null;
        break;
      }
    }
    expect(firstLimit, 'X-RateLimit-Limit header should be present on auth responses').toBe('10');
    expect(firstRemaining, 'X-RateLimit-Remaining header should be present on first response').not.toBeNull();
    expect(saw429, 'expected at least one 429 within a 14-request burst').toBe(true);
    expect(retryAfter, 'Retry-After header should accompany 429').not.toBeNull();
  } finally {
    await ctx.dispose();
  }
});
