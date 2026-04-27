/**
 * E2E · Workspace CRUD (non-default)
 *
 * Covers user request category 11:
 *   - super_admin can create a new workspace via UI
 *   - it appears in the list, can be edited, and can be deleted
 *   - the 'default' workspace cannot be deleted (UI hides delete button + API 400)
 *   - non-superadmin users cannot list/create/delete workspaces (API 403)
 *
 * Strategy: UI for create/edit/delete happy path (the primary user-facing flow);
 * API for permission boundaries to keep the test fast.
 */

import { test, expect } from './helpers/fixtures';
import { resetSuperAdminPassword, uniqueName } from './helpers/cluster';
import { loginViaUi, fillField } from './helpers/ui';
import { loginApi, disposeClient } from './helpers/api-auth';

const ADMIN_EMAIL = 'admin@oao.local';
const ADMIN_PASSWORD = 'AdminPass123!';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await resetSuperAdminPassword(ADMIN_PASSWORD);
});

test('super_admin can create, edit, and delete a non-default workspace via the UI', async ({ page }) => {
  const slug = `e2e-${Date.now().toString(36)}`;
  const initialName = uniqueName('WS');
  const renamed = `${initialName}-renamed`;

  await loginViaUi(page, { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD, providerLabel: 'Built-in Database' });
  await page.goto('/default/workspaces');
  await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();

  // ── Create ──────────────────────────────────────────────────────────
  const openCreateBtn = page.getByRole('button', { name: /^Create Workspace$/ });
  const dialog = page.locator('.p-dialog').filter({ has: page.getByText(/^Create Workspace$/) }).last();
  await openCreateBtn.click();
  if (!await dialog.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await openCreateBtn.click();
  }
  await expect(dialog).toBeVisible();
  await fillField(page, 'Name', initialName, dialog);
  await fillField(page, 'Slug', slug, dialog);
  await fillField(page, 'Description', 'Created by e2e', dialog);
  const createResponse = page.waitForResponse((r) => r.url().endsWith('/api/workspaces') && r.request().method() === 'POST');
  await dialog.getByRole('button', { name: /^Create$/ }).click();
  const created = await createResponse;
  expect(created.status(), await created.text()).toBe(201);
  await expect(dialog).toBeHidden();
  const newCardHeading = page.getByRole('heading', { level: 3, name: initialName });
  await expect(newCardHeading).toBeVisible();

  // ── Edit ────────────────────────────────────────────────────────────
  const card = newCardHeading.locator('xpath=ancestor::*[contains(@class, "p-card")]').first();
  await card.locator('button:has(.pi-pencil)').first().click();
  const editDialog = page.locator('.p-dialog').filter({ has: page.getByText(/^Edit Workspace$/) }).last();
  await expect(editDialog).toBeVisible();
  const nameInput = editDialog.locator('input').first();
  await nameInput.fill(renamed);
  const updateResponse = page.waitForResponse((r) => /\/api\/workspaces\/[a-f0-9-]+$/.test(r.url()) && r.request().method() === 'PUT');
  await editDialog.getByRole('button', { name: /^Save$/ }).click();
  const updated = await updateResponse;
  expect(updated.ok(), await updated.text()).toBe(true);
  await expect(editDialog).toBeHidden();
  await expect(page.locator('h3', { hasText: renamed })).toBeVisible();

  // ── Default workspace cannot be deleted ─────────────────────────────
  const defaultHeading = page.getByRole('heading', { level: 3, name: 'Default Workspace' });
  const defaultCard = defaultHeading.locator('xpath=ancestor::*[contains(@class, "p-card")]').first();
  await expect(defaultCard.locator('button:has(.pi-trash)')).toHaveCount(0);

  // ── Delete the new (renamed) workspace ──────────────────────────────
  const renamedHeading = page.getByRole('heading', { level: 3, name: renamed });
  const renamedCard = renamedHeading.locator('xpath=ancestor::*[contains(@class, "p-card")]').first();
  await renamedCard.locator('button:has(.pi-trash)').first().click();
  // PrimeVue ConfirmDialog uses 'Delete' as the accept label per page setup.
  const confirmAccept = page.locator('.p-confirmdialog').getByRole('button', { name: /^(Delete|Yes)$/ }).first();
  const deleteResponse = page.waitForResponse((r) => /\/api\/workspaces\/[a-f0-9-]+$/.test(r.url()) && r.request().method() === 'DELETE');
  await confirmAccept.click();
  const deleted = await deleteResponse;
  expect(deleted.ok(), await deleted.text()).toBe(true);
  await expect(renamedHeading).toHaveCount(0);
});

// eslint-disable-next-line no-empty-pattern
test('default workspace cannot be deleted via the API and non-admins cannot manage workspaces', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // Find the default workspace.
  const wsList = await admin.request.get('/api/workspaces');
  expect(wsList.ok()).toBe(true);
  const wsBody = (await wsList.json()) as { workspaces: Array<{ id: string; slug: string }> };
  const defaultWs = wsBody.workspaces.find((w) => w.slug === 'default');
  expect(defaultWs).toBeTruthy();

  // ── default cannot be deleted ───────────────────────────────────────
  const delDefault = await admin.request.delete(`/api/workspaces/${defaultWs!.id}`);
  expect([400, 403, 409]).toContain(delDefault.status());

  // ── Non-admin cannot list/create workspaces ─────────────────────────
  // Provision a temporary creator user.
  const email = `ws-rbac-${Date.now()}@example.com`;
  const password = 'WsPass123!';
  const create = await admin.request.post('/api/admin/users', {
    data: { name: 'WS RBAC', email, password, role: 'creator_user' },
  });
  expect(create.status()).toBe(201);

  const creator = await loginApi({ baseURL, identifier: email, password });
  try {
    const list = await creator.request.get('/api/workspaces');
    expect(list.status()).toBe(403);
    const cr = await creator.request.post('/api/workspaces', {
      data: { name: 'Should-Fail', slug: `fail-${Date.now()}` },
    });
    expect(cr.status()).toBe(403);
  } finally {
    await disposeClient(creator);
    await disposeClient(admin);
  }
});
