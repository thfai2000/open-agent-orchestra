import { test, expect } from './helpers/fixtures';
import { resetSuperAdminPassword, uniqueName } from './helpers/cluster';
import { ensureWorkspaceCopilotTokenVariable } from './helpers/copilot-token';
import { confirmDeleteDialog, dismissVisibleToasts, fillField, loginViaUi, selectOption } from './helpers/ui';

const ADMIN_EMAIL = 'admin@oao.local';
const ADMIN_PASSWORD = 'AdminPass123!';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await resetSuperAdminPassword(ADMIN_PASSWORD);
});

test('admin can create/edit an agent, use it in a conversation, create/edit/delete a workflow, and manually run it', async ({ page }) => {
  test.setTimeout(120_000);

  const agentName = uniqueName('pw-agent');
  const updatedAgentName = `${agentName}-v2`;
  const workflowName = uniqueName('pw-workflow');
  const updatedWorkflowName = `${workflowName}-v2`;
  const webhookPath = `/${uniqueName('wh')}`;

  await loginViaUi(page, { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD, providerLabel: 'Built-in Database' });

  await page.locator('aside a[href="/default/agents"]').first().click();
  await expect(page).toHaveURL(/\/default\/agents$/);
  await page.getByRole('button', { name: /Create Agent/i }).click();
  await expect(page).toHaveURL(/\/default\/agents\/new$/);
  await fillField(page, 'Name', agentName);
  await fillField(page, 'Description', 'Playwright database agent');
  await page.getByRole('button', { name: /^Database$/ }).click();
  await fillField(page, 'Agent Instruction (agent.md)', '# Playwright Agent\n\nYou are a concise assistant used for end-to-end tests.');
  const createAgentResponsePromise = page.waitForResponse((response) => response.url().includes('/api/agents') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /Create Agent/i }).click();
  const createAgentResponse = await createAgentResponsePromise;
  expect(createAgentResponse.status()).toBe(201);
  const createAgentPayload = await createAgentResponse.json() as { agent?: { id?: string } };
  const createdAgentId = createAgentPayload.agent?.id;
  expect(createdAgentId).toBeTruthy();

  // Attach a real Copilot token to the freshly-created agent so the
  // conversation send below has a chance of completing against a real LLM.
  // When TESTING_GITHUB_PAT / GITHUB_TOKEN are absent this is a no-op.
  const authToken = (await page.context().cookies()).find((cookie) => cookie.name === 'token')?.value;
  if (authToken && createdAgentId) {
    const tokenVarId = await ensureWorkspaceCopilotTokenVariable(page.request, authToken);
    if (tokenVarId) {
      await page.request.put(`/api/agents/${createdAgentId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
        data: { copilotTokenCredentialId: tokenVarId },
      });
    }
  }

  await expect(page).toHaveURL(/\/default\/agents$/);
  const createdAgentLink = page.locator(`a[href="/default/agents/${createdAgentId}"]`).first();
  await expect(createdAgentLink).toBeVisible();
  await createdAgentLink.click();
  await expect(page).toHaveURL(new RegExp(`/default/agents/${createdAgentId}$`));

  await page.getByRole('button', { name: /^Edit$/ }).click();
  await fillField(page, 'Name', updatedAgentName);
  await fillField(page, 'Description', 'Updated by Playwright');
  await page.getByRole('button', { name: /^Save$/ }).click();
  await expect(page.getByRole('heading', { name: updatedAgentName, exact: true })).toBeVisible();

  await page.getByRole('link', { name: /Start Conversation/i }).click();
  await expect(page).toHaveURL(/\/default\/conversations\/new/);
  await fillField(page, 'Title', 'Playwright Conversation');
  await page.getByRole('button', { name: /Create Conversation/i }).click();
  await expect(page).toHaveURL(/\/default\/conversations\/.+$/);

  await page.getByPlaceholder('Ask the agent something...').fill('Reply with a short confirmation for Playwright.');
  const sendMessageResponsePromise = page.waitForResponse((response) => response.url().includes('/api/conversations/') && response.url().includes('/messages') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /^Send$/ }).click();
  const sendMessageResponse = await sendMessageResponsePromise;
  const sendFailedToast = page.locator('.p-toast-message').filter({ hasText: 'Send Failed' }).first();
  const sendMessageResponseText = await sendMessageResponse.text();
  const sendMessagePayload = (() => {
    try {
      return JSON.parse(sendMessageResponseText) as { error?: unknown; message?: unknown; assistantMessage?: { id?: unknown } };
    } catch {
      return null;
    }
  })();
  await expect(page.getByText('Reply with a short confirmation for Playwright.')).toBeVisible();
  if (sendMessageResponse.ok()) {
    expect(sendMessagePayload?.assistantMessage?.id).toBeTruthy();
  } else {
    const sendMessageError = typeof sendMessagePayload?.error === 'string'
      ? sendMessagePayload.error
      : typeof sendMessagePayload?.message === 'string'
        ? sendMessagePayload.message
        : 'Failed to send message.';
    const conversationMain = page.locator('main');
    const surfacedError = conversationMain.getByText(sendMessageError, { exact: false });
    const noContentMessage = conversationMain.getByText('No content.').first();
    await expect.poll(async () => {
      if (await sendFailedToast.isVisible().catch(() => false)) {
        return 'toast';
      }
      if (await surfacedError.isVisible().catch(() => false)) {
        return 'error';
      }
      if (await noContentMessage.isVisible().catch(() => false)) {
        return 'no-content';
      }
      return 'pending';
    }, { timeout: 15_000 }).not.toBe('pending');

    if (await sendFailedToast.isVisible().catch(() => false)) {
      const closeToastButton = sendFailedToast.locator('button').first();
      if (await closeToastButton.isVisible().catch(() => false)) {
        await closeToastButton.click();
      } else {
        await expect(sendFailedToast).toBeHidden({ timeout: 6_000 });
      }
    }
  }

  await page.locator('aside a[href="/default/workflows"]').first().click();
  await expect(page).toHaveURL(/\/default\/workflows$/);
  await page.getByRole('button', { name: /Create Workflow/i }).click();
  await expect(page).toHaveURL(/\/default\/workflows\/new$/);
  const workflowNameInput = page.getByPlaceholder('My Workflow');
  await workflowNameInput.fill(workflowName);
  await expect(workflowNameInput).toHaveValue(workflowName);
  await fillField(page, 'Description', 'Playwright workflow');
  await selectOption(page, 'Default Agent', updatedAgentName);
  await fillField(page, 'Prompt Template', 'Say hello from Playwright.');

  await page.getByRole('button', { name: /Webhook/ }).click();
  await fillField(page, 'Webhook Path', webhookPath);
  await page.getByRole('button', { name: /Schedule/ }).click();
  await fillField(page, 'Cron Expression', '*/30 * * * *');
  const createWorkflowResponsePromise = page.waitForResponse((response) => response.url().includes('/api/workflows') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /Create Workflow/i }).click();
  const createWorkflowResponse = await createWorkflowResponsePromise;
  expect(createWorkflowResponse.status()).toBe(201);
  const createWorkflowPayload = await createWorkflowResponse.json() as { workflow?: { id?: string } };
  const createdWorkflowId = createWorkflowPayload.workflow?.id;
  expect(createdWorkflowId).toBeTruthy();

  await expect(page).toHaveURL(/\/default\/workflows$/);
  const createdWorkflowLink = page.locator(`a[href="/default/workflows/${createdWorkflowId}"]`).first();
  await expect(createdWorkflowLink).toBeVisible();
  await createdWorkflowLink.click();
  await expect(page).toHaveURL(new RegExp(`/default/workflows/${createdWorkflowId}$`));

  await fillField(page, 'Name', updatedWorkflowName);
  await page.getByRole('button', { name: /Save changes/i }).click();
  await expect(page.getByRole('heading', { name: updatedWorkflowName, exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Run — Webhook/i }).click();
  await page.getByRole('button', { name: /Start Run/i }).click();
  await expect(page.getByText(/Workflow run accepted!/i)).toBeVisible();
  await dismissVisibleToasts(page);

  await page.getByRole('button', { name: /^Delete$/ }).click();
  await confirmDeleteDialog(page);
  await expect(page).toHaveURL(/\/default\/workflows$/);
  await expect(page.getByText(updatedWorkflowName)).toHaveCount(0);

  await page.goto('/default/agents');
  await expect(page).toHaveURL(/\/default\/agents$/);
  await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible();
  const updatedAgentLink = page.locator(`a[href="/default/agents/${createdAgentId}"]`).first();
  await expect(updatedAgentLink).toBeVisible();
  await updatedAgentLink.click();
  await expect(page).toHaveURL(new RegExp(`/default/agents/${createdAgentId}$`));
  await page.getByRole('button', { name: /^Delete$/ }).click();
  await confirmDeleteDialog(page);
  await expect(page).toHaveURL(/\/default\/agents$/);
  await expect(page.getByText(updatedAgentName)).toHaveCount(0);
});