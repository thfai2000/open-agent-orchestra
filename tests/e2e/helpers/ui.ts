import { expect, type Locator, type Page } from '@playwright/test';

type FieldRoot = Locator | Page;

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fieldContainer(root: FieldRoot, label: string | RegExp) {
  const matcher = typeof label === 'string'
    ? new RegExp(`^${escapeRegex(label)}(?:\\s*\\*)?$`)
    : label;
  return root.locator('label').filter({ hasText: matcher }).first().locator('..');
}

export async function fillField(page: Page, label: string | RegExp, value: string, root: FieldRoot = page) {
  const container = fieldContainer(root, label);
  const input = container.locator('input:not([type=hidden]), textarea').first();
  await input.fill(value);

  if ((await input.getAttribute('type')) === 'password') {
    await page.keyboard.press('Escape');
  }
}

export async function selectOption(page: Page, label: string | RegExp, option: string, root: FieldRoot = page) {
  const container = fieldContainer(root, label);
  const combobox = container.getByRole('combobox').first();
  const selectRoot = container.locator('.p-select, .p-dropdown, [data-pc-name="select"]').first();
  const dropdownTrigger = container.locator('.p-select-dropdown, .p-dropdown-trigger, [data-pc-section="dropdown"]').first();
  const trigger = await selectRoot.count() ? selectRoot : combobox;
  const valueTarget = await combobox.count() ? combobox : trigger;
  const currentValue = ((await valueTarget.textContent()) || '').trim();
  if (currentValue === option) {
    return;
  }

  const optionPattern = new RegExp(`^${escapeRegex(option)}$`);
  const optionLocators = [
    page.locator('[data-pc-section="option"]').filter({ hasText: optionPattern }).first(),
    page.locator('[data-pc-section="item"]').filter({ hasText: optionPattern }).first(),
    page.locator('[role="listbox"] li, [role="listbox"] [data-pc-section="optionlabel"]').filter({ hasText: optionPattern }).first(),
    page.getByRole('option', { name: option, exact: true }).first(),
  ];

  const isOptionVisible = async () => {
    for (const locator of optionLocators) {
      if (await locator.isVisible({ timeout: 3_000 }).catch(() => false)) {
        return true;
      }
    }
    return false;
  };

  await trigger.click({ force: true });
  await page.waitForTimeout(300);
  if (!await isOptionVisible()) {
    if (await dropdownTrigger.count()) {
      await dropdownTrigger.click({ force: true }).catch(() => {});
      await page.waitForTimeout(300);
    }
  }
  if (!await isOptionVisible()) {
    await valueTarget.focus().catch(() => {});
    await page.keyboard.press('ArrowDown').catch(() => {});
    await page.waitForTimeout(300);
  }
  if (!await isOptionVisible()) {
    await valueTarget.focus().catch(() => {});
    await page.keyboard.press('Enter').catch(() => {});
    await page.waitForTimeout(300);
  }
  if (!await isOptionVisible()) {
    // PrimeVue v4: try clicking the visible overlay trigger icon or label span
    const labelSpan = container.locator('.p-select-label').first();
    if (await labelSpan.count()) await labelSpan.click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
  }

  for (const locator of optionLocators) {
    if (await locator.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await locator.click();
      return;
    }
  }

  await expect(optionLocators[0]).toBeVisible({ timeout: 8_000 });
}

export async function dismissVisibleToasts(page: Page) {
  const toastRoot = page.locator('.p-toast').first();
  if (await toastRoot.isVisible({ timeout: 250 }).catch(() => false)) {
    await expect(toastRoot).toBeHidden({ timeout: 6_000 });
  }
}

export async function confirmDeleteDialog(page: Page) {
  const dialog = page.getByRole('alertdialog', { name: /Confirm Delete/i });
  await expect(dialog).toBeVisible();
  const deleteButton = dialog.getByRole('button', { name: /^Delete$/ });
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click({ force: true });
}

export async function openTab(page: Page, name: string | RegExp) {
  const tab = page.getByRole('tab', { name }).first();
  await expect(tab).toBeVisible();

  const panelId = await tab.getAttribute('aria-controls');
  expect(panelId).toBeTruthy();
  const escapedPanelId = panelId!.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const panel = page.locator(`[id="${escapedPanelId}"]`);

  if (await panel.isVisible().catch(() => false)) {
    return panel;
  }

  await expect(async () => {
    await tab.scrollIntoViewIfNeeded();
    await tab.click({ force: true });
    await expect(panel).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });

  return panel;
}

export async function loginViaUi(page: Page, params: {
  identifier: string;
  password: string;
  providerLabel?: 'Built-in Database' | 'Active Directory';
}) {
  await page.context().clearCookies();
  const providersResponse = page.waitForResponse((response) => {
    return response.url().includes('/api/auth/providers') && response.request().method() === 'GET';
  }).catch(() => null);
  await page.goto('/default/login');
  await providersResponse;
  await page.waitForLoadState('networkidle');

  if (params.providerLabel) {
    const identifierLabel = page.locator('label[for="identifier"]').first();
    const wantsLdap = params.providerLabel === 'Active Directory';
    const expectedIdentifierLabel = wantsLdap ? 'Username or Email' : 'Email';

    // The login page renders a PrimeVue Select labelled "Authentication Method"
    // when more than one provider exists. Switch to the requested option, then
    // wait for the identifier label to update.
    const select = page.locator('label', { hasText: 'Authentication Method' }).first().locator('..').locator('.p-select, [data-pc-name="select"]').first();
    if (await select.count()) {
      const currentSelectionText = ((await select.textContent()) || '').trim();
      if (!currentSelectionText.includes(params.providerLabel)) {
        await selectOption(page, 'Authentication Method', params.providerLabel);
      }
    }
    await expect(identifierLabel).toHaveText(expectedIdentifierLabel, { timeout: 5_000 });
  }

  await fillField(page, /Username or Email|Email/, params.identifier);
  await fillField(page, 'Password', params.password);
  await page.getByRole('button', { name: /Sign In/i }).click();
  await expect(page).toHaveURL(/\/default(?:\?.*)?$/);
}

export async function logoutViaUi(page: Page) {
  const userButton = page.locator('header').getByRole('button').last();
  await userButton.click();
  await page.getByText('Logout', { exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
}