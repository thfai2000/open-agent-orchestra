import { expect, test } from './helpers/fixtures';
import { resetSuperAdminPassword, uniqueName } from './helpers/cluster';
import { fillField, loginViaUi } from './helpers/ui';

const ADMIN_EMAIL = 'admin@oao.local';
const ADMIN_PASSWORD = 'AdminPass123!';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await resetSuperAdminPassword(ADMIN_PASSWORD);
});

async function dropTriggerType(page: import('@playwright/test').Page, triggerType: string, position: { x: number; y: number }) {
  const svg = page.locator('svg:has(pattern#vgrid)').first();
  await expect(svg).toBeVisible();
  await svg.evaluate((svgElement, params) => {
    const wrapper = svgElement.parentElement;
    if (!wrapper) throw new Error('Visual editor canvas wrapper not found');

    const rect = svgElement.getBoundingClientRect();
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('oao/triggerType', params.triggerType);
    wrapper.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientX: rect.left + params.position.x,
      clientY: rect.top + params.position.y,
    }));
  }, { triggerType, position });
}

test('visual editor treats dragged triggers as individual canvas blocks', async ({ page }) => {
  const workflowName = uniqueName('pw-visual-trigger-workflow');

  await loginViaUi(page, { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD, providerLabel: 'Built-in Database' });
  const authToken = (await page.context().cookies()).find((cookie) => cookie.name === 'token')?.value;
  expect(authToken).toBeTruthy();

  const createWorkflowResult = await page.evaluate(async ({ token, workflowName }) => {
    const response = await fetch('/api/workflows', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: workflowName,
        description: 'Workflow for visual trigger block validation',
        scope: 'user',
        workerRuntime: 'static',
        stepAllocationTimeoutSeconds: 300,
        steps: [
          {
            name: 'Step 1',
            promptTemplate: 'Acknowledge {{ inputs.topic | default("manual") }}.',
            stepOrder: 1,
            timeoutSeconds: 300,
          },
        ],
      }),
    });

    return {
      status: response.status,
      body: await response.json(),
    };
  }, { token: authToken, workflowName });

  expect(createWorkflowResult.status).toBe(201);
  const workflowId = createWorkflowResult.body?.workflow?.id as string | undefined;
  expect(workflowId).toBeTruthy();

  await page.goto(`/default/workflows/${workflowId}?tab=visual`);
  await expect(page.getByRole('button', { name: /Save Graph/i })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Loading visual workflow...')).toBeHidden({ timeout: 15_000 });

  await dropTriggerType(page, 'time_schedule', { x: 120, y: 120 });
  await expect(page.locator('svg:has(pattern#vgrid) text').filter({ hasText: 'Schedule' })).toHaveCount(1);
  await expect(page.getByText('New trigger')).toBeVisible();
  await expect(page.locator('label').filter({ hasText: /^Cron Expression$/ })).toBeVisible();

  await dropTriggerType(page, 'exact_datetime', { x: 120, y: 220 });
  await expect(page.locator('svg:has(pattern#vgrid) text').filter({ hasText: 'Schedule' })).toHaveCount(1);
  await expect(page.locator('svg:has(pattern#vgrid) text').filter({ hasText: 'Exact Time' })).toHaveCount(1);
  await expect(page.getByRole('tab', { name: /^Element$/ })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /^Triggers$/ })).toHaveCount(0);
  await expect(page.locator('label').filter({ hasText: /^Date & Time$/ })).toBeVisible();

  await page.locator('svg:has(pattern#vgrid) text').filter({ hasText: 'Schedule' }).first().click();
  await expect(page.locator('label').filter({ hasText: /^Cron Expression$/ })).toBeVisible();

  await fillField(page, 'Cron Expression', '0 9 * * *');
  await expect(page.locator('svg:has(pattern#vgrid) text').filter({ hasText: '0 9 * * *' })).toHaveCount(1);
  const createTriggerResponsePromise = page.waitForResponse((response) => response.url().includes('/api/triggers') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /^Save This Trigger$/ }).click();
  const createTriggerResponse = await createTriggerResponsePromise;
  expect(createTriggerResponse.status()).toBe(201);

  await expect(page.locator('svg:has(pattern#vgrid) text').filter({ hasText: 'Schedule' })).toHaveCount(1);
  await expect(page.locator('svg:has(pattern#vgrid) text').filter({ hasText: '0 9 * * *' })).toHaveCount(1);
  await expect(page.locator('svg:has(pattern#vgrid) text').filter({ hasText: 'Exact Time' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Test$/ })).toBeVisible();
});
