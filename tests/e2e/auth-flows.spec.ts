import { test, expect } from './helpers/fixtures';
import { deleteLdapAuthProviders, ensureClusterLdap, cleanupClusterLdap, resetSuperAdminPassword, uniqueEmail, uniqueName } from './helpers/cluster';
import { fillField, loginViaUi, logoutViaUi, selectOption } from './helpers/ui';

const ADMIN_EMAIL = 'admin@oao.local';
const ADMIN_PASSWORD = 'AdminPass123!';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await resetSuperAdminPassword(ADMIN_PASSWORD);
});

test('database registration, logout, login, and password change work through the UI', async ({ page }) => {
  const email = uniqueEmail('register');
  const password = 'StartPass123!';
  const nextPassword = 'ChangedPass123!';

  await page.goto('/default/register');
  await fillField(page, 'Name', 'Playwright User');
  await fillField(page, 'Email', email);
  await fillField(page, 'Password', password);
  await page.getByRole('button', { name: /Create Account/i }).click();

  await expect(page).toHaveURL(/\/default(?:\?.*)?$/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  await logoutViaUi(page);
  await loginViaUi(page, { identifier: email, password, providerLabel: 'Built-in Database' });

  const userButton = page.locator('header').getByRole('button').last();
  await userButton.click();
  await page.getByText('Change Password', { exact: true }).click();
  await expect(page).toHaveURL(/\/default\/settings\/change-password$/);

  await fillField(page, 'Current Password', password);
  await fillField(page, 'New Password', nextPassword);
  await fillField(page, 'Confirm New Password', nextPassword);
  const changePasswordResponsePromise = page.waitForResponse((response) => {
    return response.url().includes('/api/auth/change-password') && response.request().method() === 'PUT';
  });
  await page.getByRole('button', { name: /Update Password/i }).click();
  const changePasswordResponse = await changePasswordResponsePromise;
  expect(changePasswordResponse.status()).toBe(200);
  await expect(page.locator('.p-message').filter({ hasText: 'Password updated successfully.' })).toBeVisible();

  await logoutViaUi(page);
  await loginViaUi(page, { identifier: email, password: nextPassword, providerLabel: 'Built-in Database' });
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('superadmin can create a user and change that user role', async ({ page }) => {
  const managedEmail = uniqueEmail('managed-user');

  await loginViaUi(page, { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD, providerLabel: 'Built-in Database' });
  await page.goto('/default/admin/users/new');

  await selectOption(page, 'Role', 'Viewer');
  await fillField(page, 'Name', 'Managed Viewer');
  await fillField(page, 'Email', managedEmail);
  await fillField(page, 'Password', 'ViewerPass123!');
  await expect(page.getByPlaceholder('Full name')).toHaveValue('Managed Viewer');
  await expect(page.getByPlaceholder('user@example.com')).toHaveValue(managedEmail);
  await page.getByRole('button', { name: /^Create$/ }).click();

  await expect(page).toHaveURL(/\/default\/admin\/users$/);
  await expect(page.getByText(managedEmail)).toBeVisible();

  const row = page.locator('tr', { hasText: managedEmail });
  await row.locator('button').first().click();
  await expect(page).toHaveURL(/\/default\/admin\/users\/.+$/);

  await selectOption(page, 'Role', 'Creator');
  await page.getByRole('button', { name: /^Save$/ }).click();
  await expect(page.getByText('Role updated successfully.')).toBeVisible();
});

test('superadmin can configure LDAP, test it, and an LDAP user can log in with a non-email identifier', async ({ page }) => {
  // Clear any leftover LDAP providers from previous failed runs (canAddMore would otherwise be false).
  deleteLdapAuthProviders();
  const ldapUrl = await ensureClusterLdap();
  const providerName = uniqueName('ldap-e2e');

  await loginViaUi(page, { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD, providerLabel: 'Built-in Database' });
  await page.locator('aside a[href="/default/admin/auth-providers"]').first().click();
  await expect(page).toHaveURL(/\/default\/admin\/auth-providers$/);
  await page.waitForLoadState('networkidle');

  // Auth providers now use an in-page form (no dialog). Navigate to /new.
  await page.getByRole('link', { name: /Add Provider/i }).first().click();
  await expect(page).toHaveURL(/\/default\/admin\/auth-providers\/new$/);
  await expect(page.getByRole('heading', { name: /Add Authentication Provider/i })).toBeVisible();

  await fillField(page, 'Name', providerName);
  await selectOption(page, 'Type', 'LDAP');
  await fillField(page, 'Server URL', ldapUrl);
  await fillField(page, 'Bind DN', 'uid=admin,ou=system');
  await fillField(page, 'Bind Password', 'secret');
  await fillField(page, 'Search Base', 'ou=users,dc=wimpi,dc=net');
  await fillField(page, 'Search Filter', '(cn={{username}})');
  await fillField(page, 'Username Attribute', 'cn');
  await fillField(page, 'Email Attribute', 'mail');
  await fillField(page, 'Name Attribute', 'cn');

  await page.getByRole('button', { name: /^Create$/ }).click();
  // Backend redirects to the new provider's edit page after creation.
  await expect(page).toHaveURL(/\/default\/admin\/auth-providers\/[0-9a-f-]{36}$/, { timeout: 10_000 });
  await expect(page.getByRole('heading', { name: providerName })).toBeVisible({ timeout: 10_000 });

  // Test connection from the edit page.
  const testConnectionResponsePromise = page.waitForResponse((response) => {
    return response.url().includes('/api/auth-providers/test-connection') && response.request().method() === 'POST';
  });
  await page.getByRole('button', { name: /Test Connection/i }).click();
  const testConnectionResponse = await testConnectionResponsePromise;
  expect(testConnectionResponse.ok()).toBe(true);
  const testConnectionPayload = await testConnectionResponse.json() as { success?: boolean };
  expect(testConnectionPayload.success).toBe(true);

  // Confirm the provider is listed before logging out.
  await page.locator('aside a[href="/default/admin/auth-providers"]').first().click();
  await expect(page).toHaveURL(/\/default\/admin\/auth-providers$/);
  await expect(page.getByText(providerName)).toBeVisible();

  await logoutViaUi(page);
  await loginViaUi(page, {
    identifier: 'Test User',
    password: 'secret',
    providerLabel: 'Active Directory',
  });
  await expect(page.locator('header').getByRole('button').last()).toContainText(/Test User|test/i);

  await logoutViaUi(page);
  await loginViaUi(page, { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD, providerLabel: 'Built-in Database' });
  await page.locator('aside a[href="/default/admin/auth-providers"]').first().click();
  await expect(page).toHaveURL(/\/default\/admin\/auth-providers$/);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(providerName)).toBeVisible({ timeout: 10_000 });

  // Delete via the edit page.
  await page.locator('tr', { hasText: providerName }).getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: providerName })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /^Delete$/ }).click();
  // PrimeVue confirm dialog
  await page.getByRole('button', { name: /^Delete$/ }).last().click();
  await expect(page).toHaveURL(/\/default\/admin\/auth-providers$/, { timeout: 10_000 });
  await expect(page.getByText(providerName)).toHaveCount(0);

  cleanupClusterLdap();
});