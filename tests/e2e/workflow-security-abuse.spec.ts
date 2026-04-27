import { expect, test, type APIRequestContext, type Page } from './helpers/fixtures';
import {
  getWebhookRegistrationId,
  getWebhookRequestCount,
  resetSuperAdminPassword,
  uniqueName,
} from './helpers/cluster';
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
  const copilotTokenCredentialId = await ensureWorkspaceCopilotTokenVariable(request, authToken);
  const response = await request.post('/api/agents', {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    data: {
      name,
      description: 'Playwright agent for security and cleanup coverage',
      sourceType: 'database',
      ...(copilotTokenCredentialId ? { copilotTokenCredentialId } : {}),
      files: [
        {
          filePath: 'agent.md',
          content: '# Playwright Agent\n\nReturn a short acknowledgement.',
        },
      ],
    },
  });

  expect(response.status()).toBe(201);
  const body = await response.json() as { agent?: { id?: string; name?: string } };
  expect(body.agent?.id).toBeTruthy();
  return {
    id: body.agent!.id!,
    name,
  };
}

async function createWebhookWorkflow(request: APIRequestContext, authToken: string, agentId: string, prefix: string): Promise<WorkflowRecord> {
  const name = uniqueName(prefix);
  const webhookPath = `/${uniqueName('webhook')}`;
  const response = await request.post('/api/workflows', {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    data: {
      name,
      description: 'Playwright workflow with webhook trigger',
      scope: 'user',
      defaultAgentId: agentId,
      workerRuntime: 'static',
      stepAllocationTimeoutSeconds: 300,
      steps: [
        {
          name: 'Step 1',
          promptTemplate: 'Acknowledge {{ inputs.ticketId | default("missing") }}.',
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
    workflow?: { id?: string; name?: string };
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

test('webhook abuse cases reject malformed signatures, dedupe replayed PAT events, and hide PAT secrets after creation', async ({ page, request }) => {
  await loginViaUi(page, { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD, providerLabel: 'Built-in Database' });
  const { authToken } = await getAuthContext(page);

  const tokenResponse = await request.post('/api/tokens', {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    data: {
      name: uniqueName('pw-webhook-pat'),
      scopes: ['webhook:trigger'],
      expiresInDays: 1,
    },
  });
  expect(tokenResponse.status()).toBe(201);
  const tokenBody = await tokenResponse.json() as {
    token?: string;
    pat?: { id?: string; tokenPrefix?: string };
  };
  expect(tokenBody.token).toMatch(/^oao_/);
  expect(tokenBody.pat?.id).toBeTruthy();

  const tokenListResponse = await request.get('/api/tokens', {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });
  expect(tokenListResponse.status()).toBe(200);
  const tokenListBody = await tokenListResponse.json() as {
    tokens?: Array<Record<string, unknown>>;
  };
  const createdToken = tokenListBody.tokens?.find((entry) => entry.id === tokenBody.pat?.id);
  expect(createdToken).toBeTruthy();
  expect(createdToken).not.toHaveProperty('token');
  expect(createdToken).not.toHaveProperty('tokenHash');
  expect(createdToken).toHaveProperty('tokenPrefix');

  const agent = await createDatabaseAgent(request, authToken, 'pw-security-agent');
  const workflow = await createWebhookWorkflow(request, authToken, agent.id, 'pw-security-workflow');

  const invalidFileResponse = await request.post(`/api/agent-files/${agent.id}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    data: {
      filePath: '../escape.md',
      content: 'blocked',
    },
  });
  expect(invalidFileResponse.status()).toBe(400);
  const invalidFileBody = await invalidFileResponse.json() as { error?: string; details?: Array<{ message?: string }> };
  expect(invalidFileBody.details?.some((issue) => issue.message === 'Path traversal not allowed')).toBe(true);

  const agentFilesResponse = await request.get(`/api/agent-files/${agent.id}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });
  expect(agentFilesResponse.status()).toBe(200);
  const agentFilesBody = await agentFilesResponse.json() as { files?: Array<{ filePath?: string }> };
  expect(agentFilesBody.files?.some((file) => file.filePath === '../escape.md')).toBe(false);

  const registrationId = getWebhookRegistrationId(workflow.triggerId);
  expect(registrationId).toBeTruthy();

  const malformedResponse = await request.post(`/api/webhooks/${registrationId}`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Event-Id': uniqueName('bad-sig'),
      'X-Signature': 'bad',
      'X-Timestamp': String(Math.floor(Date.now() / 1000)),
    },
    data: {
      ticketId: 'INC-401',
    },
  });
  expect(malformedResponse.status()).toBe(401);
  const malformedBody = await malformedResponse.json() as { error?: string };
  expect(malformedBody.error).toBe('Invalid signature');
  expect(getWebhookRequestCount(registrationId)).toBe(0);

  const replayEventId = uniqueName('replay');
  const replayStart = new Date(Date.now() - 1_000).toISOString();

  const firstReplayResponse = await request.post(`/api/webhooks/${registrationId}`, {
    headers: {
      Authorization: `Bearer ${tokenBody.token!}`,
      'Content-Type': 'application/json',
      'X-Event-Id': replayEventId,
    },
    data: {
      ticketId: 'INC-202',
    },
  });
  expect(firstReplayResponse.status()).toBe(202);
  const firstReplayBody = await firstReplayResponse.json() as { status?: string };
  expect(firstReplayBody.status).toBe('accepted');
  expect(getWebhookRequestCount(registrationId)).toBe(1);

  const secondReplayResponse = await request.post(`/api/webhooks/${registrationId}`, {
    headers: {
      Authorization: `Bearer ${tokenBody.token!}`,
      'Content-Type': 'application/json',
      'X-Event-Id': replayEventId,
    },
    data: {
      ticketId: 'INC-202',
    },
  });
  expect(secondReplayResponse.status()).toBe(200);
  const secondReplayBody = await secondReplayResponse.json() as { status?: string };
  expect(secondReplayBody.status).toBe('already_processed');
  expect(getWebhookRequestCount(registrationId)).toBe(1);

  const eventsResponse = await request.get('/api/events', {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    params: {
      eventName: 'webhook.received',
      from: replayStart,
      limit: '100',
    },
  });
  expect(eventsResponse.status()).toBe(200);
  const eventsBody = await eventsResponse.json() as {
    events?: Array<{ eventData?: { eventId?: string; workflowId?: string } }>;
  };
  const matchingEvents = (eventsBody.events || []).filter((event) => {
    return event.eventData?.eventId === replayEventId && event.eventData?.workflowId === workflow.id;
  });
  expect(matchingEvents).toHaveLength(1);

  await deleteWorkflow(request, authToken, workflow.id);
  await deleteAgent(request, authToken, agent.id);
});

test('workflow trigger cleanup keeps the detail page healthy and disables manual run when no active webhook remains', async ({ page, request }) => {
  await loginViaUi(page, { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD, providerLabel: 'Built-in Database' });
  const { authToken } = await getAuthContext(page);

  const agent = await createDatabaseAgent(request, authToken, 'pw-cleanup-agent');
  const workflow = await createWebhookWorkflow(request, authToken, agent.id, 'pw-cleanup-workflow');

  await page.goto(`/default/workflows/${workflow.id}`);
  await expect(page.getByRole('heading', { name: workflow.name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Manual Run/i })).toBeVisible();

  let visibleTabPanel = await openTab(page, /Triggers/i);
  await expect(visibleTabPanel).toContainText(workflow.webhookPath, { timeout: 10_000 });
  await expect(visibleTabPanel).toContainText('Active', { timeout: 10_000 });

  const disableTriggerResponse = await request.put(`/api/triggers/${workflow.triggerId}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    data: {
      isActive: false,
    },
  });
  expect(disableTriggerResponse.status()).toBe(200);
  const disableTriggerBody = await disableTriggerResponse.json() as {
    trigger?: { isActive?: boolean; runtimeSummary?: { status?: string } };
  };
  expect(disableTriggerBody.trigger?.isActive).toBe(false);
  expect(disableTriggerBody.trigger?.runtimeSummary?.status).toBe('inactive');

  const manualRunResponse = await request.post(`/api/workflows/${workflow.id}/run`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    data: {
      inputs: {
        ticketId: 'INC-500',
      },
    },
  });
  expect(manualRunResponse.status()).toBe(400);
  const manualRunBody = await manualRunResponse.json() as { error?: string };
  expect(manualRunBody.error).toContain('No active webhook trigger found');

  await page.reload();
  await expect(page.getByRole('heading', { name: workflow.name, exact: true })).toBeVisible();
  visibleTabPanel = await openTab(page, /Triggers/i);
  await expect(visibleTabPanel).toContainText(workflow.webhookPath, { timeout: 10_000 });
  await expect(visibleTabPanel).toContainText('Inactive', { timeout: 10_000 });

  const deleteTriggerResponse = await request.delete(`/api/triggers/${workflow.triggerId}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });
  expect(deleteTriggerResponse.status()).toBe(200);

  const triggerListResponse = await request.get('/api/triggers', {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    params: {
      workflowId: workflow.id,
    },
  });
  expect(triggerListResponse.status()).toBe(200);
  const triggerListBody = await triggerListResponse.json() as { triggers?: Array<{ id?: string }> };
  expect(triggerListBody.triggers).toEqual([]);

  await page.reload();
  await expect(page.getByRole('heading', { name: workflow.name, exact: true })).toBeVisible();
  visibleTabPanel = await openTab(page, /Triggers/i);
  await expect(visibleTabPanel).toContainText('No triggers configured yet.', { timeout: 10_000 });

  await deleteWorkflow(request, authToken, workflow.id);
  await deleteAgent(request, authToken, agent.id);
});