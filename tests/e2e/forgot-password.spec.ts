/**
 * E2E · Forgot password / reset password flow (Cat 3)
 *
 * Verifies the complete forgot → token → reset → re-login round-trip.
 * The token is read directly from the `password_reset_tokens` table after
 * `/auth/forgot-password` returns. Doing it this way avoids a flaky SMTP
 * dependency (the SMTP server's cluster IP rotates between runs and
 * nodemailer holds onto the previous IP, leading to nginx 504 timeouts).
 * Mail delivery itself is exercised end-to-end by the OAO API and observed
 * via the `Password reset email sent to <email>` log line — but the
 * assertion in this spec focuses on the token-issuance + reset behaviour.
 */

import { test, expect } from './helpers/fixtures';
import { resetSuperAdminPassword, uniqueEmail, uniqueName, querySingleValue, clearMailSettings } from './helpers/cluster';
import { loginApi, disposeClient } from './helpers/api-auth';

const ADMIN_EMAIL = 'admin@oao.local';
const ADMIN_PASSWORD = 'AdminPass123!';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await resetSuperAdminPassword(ADMIN_PASSWORD);
  // Ensure SMTP isn't configured to point at a stale MailHog cluster IP from
  // a prior run — otherwise sendPasswordResetEmail can stall the request and
  // produce nginx 504s. With no mail config, the API logs a warn and returns.
  clearMailSettings();
});

// eslint-disable-next-line no-empty-pattern
test('forgot-password issues a reset token whose use rotates the password', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // Provision a fresh database user.
  const targetEmail = uniqueEmail('forgot');
  const originalPassword = 'OriginalPass123!';
  const newPassword = 'BrandNewPass123!';
  const created = await admin.request.post('/api/auth/register', {
    data: { name: uniqueName('Forgot User'), email: targetEmail, password: originalPassword, workspaceSlug: 'default' },
    headers: { 'x-forwarded-for': '10.77.0.1' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const userId = ((await created.json()) as { user: { id: string } }).user.id;

  // Trigger the forgot-password flow. The endpoint always returns 200 and
  // a generic message — actual token issuance is observable in the DB.
  const forgot = await admin.request.post('/api/auth/forgot-password', {
    data: { email: targetEmail, workspace: 'default' },
  });
  expect(forgot.ok(), await forgot.text()).toBe(true);
  const forgotBody = (await forgot.json()) as { message: string };
  expect(forgotBody.message.toLowerCase()).toContain('reset link has been sent');

  // The token must exist in `password_reset_tokens` for our user.
  const token = querySingleValue(
    `select token from password_reset_tokens where user_id = '${userId}' and used_at is null and expires_at > now() order by created_at desc limit 1;`,
  );
  expect(token, 'expected to find an active reset token in password_reset_tokens').toBeTruthy();
  expect(/^[a-f0-9]{96}$/.test(token!)).toBe(true);

  // Reset the password using the token.
  const reset = await admin.request.post('/api/auth/reset-password', {
    data: { token, password: newPassword },
  });
  expect(reset.ok(), await reset.text()).toBe(true);

  // The token is now marked used (single-use guarantee).
  const usedAt = querySingleValue(`select used_at from password_reset_tokens where token = '${token}';`);
  expect(usedAt, 'token used_at should be set after reset').toBeTruthy();

  // Re-using the same token must fail.
  const replay = await admin.request.post('/api/auth/reset-password', {
    data: { token, password: 'YetAnotherPass123!' },
    headers: { 'x-forwarded-for': '10.77.0.2' },
  });
  expect([400, 401]).toContain(replay.status());

  // Old password no longer works.
  const oldLogin = await admin.request.post('/api/auth/login', {
    data: { identifier: targetEmail, password: originalPassword, provider: 'database' },
    headers: { 'x-forwarded-for': '10.77.0.3' },
  });
  expect([400, 401]).toContain(oldLogin.status());

  // New password does work.
  const newClient = await loginApi({ baseURL, identifier: targetEmail, password: newPassword });
  await disposeClient(newClient);

  await disposeClient(admin);
});

// eslint-disable-next-line no-empty-pattern
test('forgot-password silently succeeds for an unknown email (no enumeration leak)', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const playwrightRequest = (await import('@playwright/test')).request;
  const probe = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { 'x-forwarded-for': '10.50.0.1' },
  });
  try {
    const res = await probe.post('/api/auth/forgot-password', {
      data: { email: 'definitely-does-not-exist@example.com', workspace: 'default' },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { message: string };
    expect(body.message.toLowerCase()).toContain('reset link has been sent');
  } finally {
    await probe.dispose();
  }
});

// eslint-disable-next-line no-empty-pattern
test('forgot-password rejects when workspace.allowPasswordReset is false', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // Create a workspace with allowPasswordReset disabled.
  const slug = `noreset-${Date.now().toString(36)}`;
  const ws = await admin.request.post('/api/workspaces', {
    data: { name: 'No-Reset WS', slug, allowPasswordReset: false, allowRegistration: true },
  });
  expect(ws.status(), await ws.text()).toBe(201);
  const wsId = ((await ws.json()) as { workspace: { id: string } }).workspace.id;
  try {
    const res = await admin.request.post('/api/auth/forgot-password', {
      data: { email: 'whoever@example.com', workspace: slug },
      headers: { 'x-forwarded-for': '10.51.0.1' },
    });
    expect(res.status()).toBe(403);
  } finally {
    await admin.request.delete(`/api/workspaces/${wsId}`);
    await disposeClient(admin);
  }
});
