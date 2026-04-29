import { expect, test, type APIRequestContext, type Page } from './helpers/fixtures';
import { resetSuperAdminPassword, uniqueName } from './helpers/cluster';
import { ensureWorkspaceCopilotTokenVariable } from './helpers/copilot-token';
import { loginViaUi, openTab } from './helpers/ui';

const ADMIN_EMAIL = 'admin@oao.local';
const ADMIN_PASSWORD = 'AdminPass123!';

interface AuthContext {
  authToken: string;
}

interface AgentRecord {
  id: string;
  name: string;
}

interface WorkflowRecord {
  id: string;
  name: string;
  triggerId: string;
  webhookPath: string;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await resetSuperAdminPassword(ADMIN_PASSWORD);
});

async function getAuthContext(page: Page): Promise<AuthContext> {
  const authToken = (await page.context().cookies()).find((cookie) => cookie.name === 'token')?.value;
  expect(authToken).toBeTruthy();
  return { authToken: authToken! };
}

async function createDatabaseAgent(request: APIRequestContext, authToken: string, prefix: string): Promise<AgentRecord> {
  const name = uniqueName(prefix);
  // Best-effort: attach a real Copilot token so workflow runs triggered by
  // this test exercise the LLM (rather than failing silently in the
  // background and leaving orphan agent rows without a token).
  const copilotTokenCredentialId = await ensureWorkspaceCopilotTokenVariable(request, authToken);
  const response = await request.post('/api/agents', {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    data: {
      name,
      description: 'Playwright agent for execution and version coverage',
      sourceType: 'database',
      ...(copilotTokenCredentialId ? { copilotTokenCredentialId } : {}),
      files: [
        {
          filePath: 'agent.md',
          content: '# Version Test Agent\n\nReturn a concise acknowledgement.',
        },
      ],
    },
  });

  expect(response.status()).toBe(201);
  const body = await response.json() as { agent?: { id?: string } };
  expect(body.agent?.id).toBeTruthy();

  return {
    id: body.agent!.id!,
    name,
  };
}

async function updateAgent(request: APIRequestContext, authToken: string, agentId: string, name: string, description: string) {
  const response = await request.put(`/api/agents/${agentId}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    data: {
      name,
      description,
    },
  });

  expect(response.status()).toBe(200);
}

async function createWebhookWorkflow(request: APIRequestContext, authToken: string, agentId: string, prefix: string): Promise<WorkflowRecord> {
  const name = uniqueName(prefix);
  const webhookPath = `/${uniqueName('exec-history')}`;
  const response = await request.post('/api/workflows', {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    data: {
      name,
      description: 'Playwright workflow for execution history coverage',
      scope: 'user',
      defaultAgentId: agentId,
      workerRuntime: 'static',
      stepAllocationTimeoutSeconds: 300,
      steps: [
        {
          name: 'Summarize Inputs',
          promptTemplate: 'Acknowledge {{ inputs.ticketId | default("missing") }} in one sentence.',
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
            ],
          },
        },
      ],
    },
  });

  expect(response.status()).toBe(201);
  const body = await response.json() as {
    workflow?: { id?: string };
    triggers?: Array<{ id?: string }>;
  };
  expect(body.workflow?.id).toBeTruthy();
  expect(body.triggers?.[0]?.id).toBeTruthy();

  return {
    id: body.workflow!.id!,
    name,
    triggerId: body.triggers![0]!.id!,
    webhookPath,
  };
}

async function updateWorkflow(request: APIRequestContext, authToken: string, workflowId: string, payload: {
  name: string;
  description: string;
  defaultAgentId: string;
}) {
  const response = await request.put(`/api/workflows/${workflowId}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    data: {
      name: payload.name,
      description: payload.description,
      defaultAgentId: payload.defaultAgentId,
      workerRuntime: 'static',
      stepAllocationTimeoutSeconds: 300,
    },
  });

  expect(response.status()).toBe(200);
}

async function triggerManualRun(request: APIRequestContext, authToken: string, triggerId: string, ticketId: string) {
  const response = await request.post(`/api/triggers/${triggerId}/run`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    data: {
      inputs: { ticketId },
    },
  });

  expect(response.status()).toBe(202);
}

async function waitForExecution(request: APIRequestContext, authToken: string, workflowId: string) {
  let executionId = '';

  await expect.poll(async () => {
    const response = await request.get(`/api/executions?workflowId=${workflowId}&page=1&limit=20`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    if ([502, 503, 504].includes(response.status())) {
      return '';
    }

    expect(response.status()).toBe(200);

    const body = await response.json() as {
      executions?: Array<{ id?: string }>;
    };

    executionId = body.executions?.[0]?.id ?? '';
    return executionId;
  }, { timeout: 75_000 }).not.toBe('');

  return executionId;
}

async function deleteWorkflow(request: APIRequestContext, authToken: string, workflowId: string) {
  const response = await request.delete(`/api/workflows/${workflowId}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });
  expect(response.status()).toBe(200);
}

async function deleteAgent(request: APIRequestContext, authToken: string, agentId: string) {
  const response = await request.delete(`/api/agents/${agentId}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });
  expect(response.status()).toBe(200);
}

test('execution history and version pages show persisted snapshots and linked history', async ({ page, request }) => {
  await loginViaUi(page, { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD, providerLabel: 'Built-in Database' });
  const { authToken } = await getAuthContext(page);

  const agent = await createDatabaseAgent(request, authToken, 'pw-version-agent');
  const updatedAgentName = `${agent.name}-v2`;
  const updatedAgentDescription = 'Agent version two created by Playwright';
  await updateAgent(request, authToken, agent.id, updatedAgentName, updatedAgentDescription);

  const workflow = await createWebhookWorkflow(request, authToken, agent.id, 'pw-version-workflow');
  const updatedWorkflowName = `${workflow.name}-v2`;
  const updatedWorkflowDescription = 'Workflow version two created by Playwright';
  await updateWorkflow(request, authToken, workflow.id, {
    name: updatedWorkflowName,
    description: updatedWorkflowDescription,
    defaultAgentId: agent.id,
  });

  await triggerManualRun(request, authToken, workflow.triggerId, 'INC-4242');
  const executionId = await waitForExecution(request, authToken, workflow.id);

  await page.goto('/default/executions');
  await expect(page.getByRole('heading', { name: /Workflow Executions/i })).toBeVisible();
  const executionLink = page.getByRole('link', { name: new RegExp(`^${executionId.substring(0, 8)}`) });
  await expect(executionLink).toBeVisible();
  await executionLink.click();

  await expect(page).toHaveURL(new RegExp(`/default/executions/${executionId}$`));
  await expect(page.getByRole('heading', { name: new RegExp(`Execution ${executionId.substring(0, 8)}`) })).toBeVisible();
  await expect(page.getByRole('link', { name: updatedWorkflowName, exact: true })).toBeVisible();
  await expect(page.getByText(/Workflow:/)).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(`${updatedWorkflowName} v2`) })).toBeVisible();

  const workflowVersionLink = page.getByRole('link', { name: `${updatedWorkflowName} v2`, exact: true });
  await expect(workflowVersionLink).toHaveAttribute('href', `/default/workflows/${workflow.id}/v/2`);
  await page.goto(`/default/workflows/${workflow.id}/v/2`);
  await expect(page).toHaveURL(new RegExp(`/default/workflows/${workflow.id}/v/2$`));
  await expect(page.getByRole('heading', { name: updatedWorkflowName, exact: true })).toBeVisible();
  await expect(page.locator('p').filter({ hasText: updatedWorkflowDescription }).first()).toBeVisible();
  await expect(page.getByText(/Historical workflow versions are read-only/i)).toBeVisible();
  await expect(page.getByText('Active at snapshot')).toBeVisible();
  await expect(page.getByText('Yes', { exact: true })).toBeVisible();

  await page.getByLabel(/Previous version/i).click();
  await expect(page).toHaveURL(new RegExp(`/default/workflows/${workflow.id}/v/1$`));
  await expect(page.getByRole('heading', { name: workflow.name, exact: true })).toBeVisible();
  await expect(page.locator('p').filter({ hasText: 'Playwright workflow for execution history coverage' }).first()).toBeVisible();
  await page.getByRole('button', { name: /Latest/i }).click();
  await expect(page).toHaveURL(new RegExp(`/default/workflows/${workflow.id}$`));

  await page.goto(`/default/agents/${agent.id}/v/2`);
  await expect(page.getByRole('heading', { name: updatedAgentName, exact: true })).toBeVisible();
  await expect(page.getByText(updatedAgentDescription, { exact: true })).toBeVisible();
  await expect(page.getByText(/Historical agent versions are read-only/i)).toBeVisible();

  let visiblePanel = await openTab(page, /Files/i);
  await expect(visiblePanel).toContainText('agent.md');

  await page.getByLabel(/Previous version/i).click();
  await expect(page).toHaveURL(new RegExp(`/default/agents/${agent.id}/v/1$`));
  await expect(page.getByRole('heading', { name: agent.name, exact: true })).toBeVisible();
  await expect(page.getByText('Playwright agent for execution and version coverage', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Latest/i }).click();
  await expect(page).toHaveURL(new RegExp(`/default/agents/${agent.id}$`));

  await deleteWorkflow(request, authToken, workflow.id);
  await deleteAgent(request, authToken, agent.id);
});