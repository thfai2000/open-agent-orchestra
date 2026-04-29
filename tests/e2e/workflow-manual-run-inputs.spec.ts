import { expect, test } from './helpers/fixtures';
import { resetSuperAdminPassword, uniqueName } from './helpers/cluster';
import { fillField, loginViaUi } from './helpers/ui';

const ADMIN_EMAIL = 'admin@oao.local';
const ADMIN_PASSWORD = 'AdminPass123!';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await resetSuperAdminPassword(ADMIN_PASSWORD);
});

test('manual run rejects missing required webhook inputs and accepts a valid payload', async ({ page }) => {
  const agentName = uniqueName('pw-manual-agent');
  const workflowName = uniqueName('pw-manual-workflow');
  const webhookPath = `/${uniqueName('manual-run')}`;

  await loginViaUi(page, { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD, providerLabel: 'Built-in Database' });
  const authToken = (await page.context().cookies()).find((cookie) => cookie.name === 'token')?.value;
  expect(authToken).toBeTruthy();

  await page.locator('aside a[href="/default/agents"]').first().click();
  await expect(page).toHaveURL(/\/default\/agents$/);
  await page.getByRole('button', { name: /Create Agent/i }).click();
  await expect(page).toHaveURL(/\/default\/agents\/new$/);
  await fillField(page, 'Name', agentName);
  await fillField(page, 'Description', 'Playwright agent for manual run validation');
  await page.getByRole('button', { name: /^Database$/ }).click();
  await fillField(page, 'Agent Instruction (agent.md)', '# Manual Run Agent\n\nReturn a concise acknowledgement for the provided webhook inputs.');

  const createAgentResponsePromise = page.waitForResponse((response) => response.url().includes('/api/agents') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /Create Agent/i }).click();
  const createAgentResponse = await createAgentResponsePromise;
  expect(createAgentResponse.status()).toBe(201);
  const createAgentPayload = await createAgentResponse.json() as { agent?: { id?: string } };
  const createdAgentId = createAgentPayload.agent?.id;
  expect(createdAgentId).toBeTruthy();

  const createWorkflowResult = await page.evaluate(async ({ agentId, token, webhookPath, workflowName }) => {
    const response = await fetch('/api/workflows', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: workflowName,
        description: 'Workflow with required manual run inputs',
        scope: 'user',
        defaultAgentId: agentId,
        workerRuntime: 'static',
        stepAllocationTimeoutSeconds: 300,
        steps: [
          {
            name: 'Step 1',
            promptTemplate: "Acknowledge ticket {{ inputs.ticketId }} and note {{ inputs.comment | default('none') }}.",
            stepOrder: 1,
            timeoutSeconds: 300,
          },
        ],
        triggers: [
          {
            triggerType: 'webhook',
            isActive: true,
            configuration: {
              path: webhookPath,
              parameters: [
                { name: 'ticketId', description: 'Ticket identifier', required: true },
                { name: 'comment', description: 'Optional note', required: false },
              ],
            },
          },
        ],
      }),
    });

    return {
      status: response.status,
      body: await response.json(),
    };
  }, {
    agentId: createdAgentId,
    token: authToken,
    webhookPath,
    workflowName,
  });
  expect(createWorkflowResult.status).toBe(201);
  const createdWorkflowId = createWorkflowResult.body?.workflow?.id as string | undefined;
  const createdTriggerId = createWorkflowResult.body?.triggers?.[0]?.id as string | undefined;
  expect(createdWorkflowId).toBeTruthy();
  expect(createdTriggerId).toBeTruthy();

  await page.locator('aside a[href="/default/workflows"]').first().click();
  await expect(page).toHaveURL(/\/default\/workflows$/);
  const workflowDetailLink = page.locator(`a[href="/default/workflows/${createdWorkflowId}"]`).first();
  await expect(workflowDetailLink).toBeVisible();
  await workflowDetailLink.click();
  await expect(page).toHaveURL(new RegExp(`/default/workflows/${createdWorkflowId}$`));

  await page.getByRole('button', { name: /Run — Webhook/i }).click();
  const runDialog = page.getByRole('dialog', { name: /Run via Webhook/i });
  await expect(runDialog).toBeVisible();
  await expect(runDialog.getByText(/ticketId/)).toBeVisible();
  await expect(runDialog.getByText(/comment/)).toBeVisible();
  await runDialog.getByRole('button', { name: /^Cancel$/ }).click();

  const invalidManualRun = await page.evaluate(async ({ triggerId, token }) => {
    const response = await fetch(`/api/triggers/${triggerId}/run`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputs: {} }),
    });

    return {
      status: response.status,
      body: await response.json(),
    };
  }, { triggerId: createdTriggerId, token: authToken });
  expect(invalidManualRun.status).toBe(400);
  expect(invalidManualRun.body?.error).toContain('Missing required inputs: ticketId');

  const validManualRun = await page.evaluate(async ({ triggerId, token }) => {
    const response = await fetch(`/api/triggers/${triggerId}/run`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: {
          ticketId: 'INC-1234',
          comment: 'Escalated from on-call dashboard',
        },
      }),
    });

    return {
      status: response.status,
      body: await response.json(),
    };
  }, { triggerId: createdTriggerId, token: authToken });
  expect(validManualRun.status).toBe(202);
  expect(validManualRun.body?.status).toBe('pending');
  expect(validManualRun.body?.executionId).toBeTruthy();

  const workflowDeleteStatus = await page.evaluate(async ({ workflowId, token }) => {
    const response = await fetch(`/api/workflows/${workflowId}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return response.status;
  }, { workflowId: createdWorkflowId, token: authToken });
  expect(workflowDeleteStatus).toBe(200);

  const agentDeleteStatus = await page.evaluate(async ({ agentId, token }) => {
    const response = await fetch(`/api/agents/${agentId}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return response.status;
  }, { agentId: createdAgentId, token: authToken });
  expect(agentDeleteStatus).toBe(200);
});