import { expect, test, type APIRequestContext, type Page } from './helpers/fixtures';
import { resetSuperAdminPassword, uniqueName } from './helpers/cluster';
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

interface VariableRecord {
  id: string;
  key: string;
  scope: 'workspace';
}

interface WorkflowRecord {
  id: string;
  name: string;
  triggerId: string;
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

function uniqueVariableKey(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .slice(0, 100);
}

async function createWorkspaceCredentialVariable(
  request: APIRequestContext,
  authToken: string,
  params: {
    key: string;
    value: string;
    credentialSubType: 'secret_text' | 'github_token';
    description: string;
  },
): Promise<VariableRecord> {
  const response = await request.post('/api/variables', {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    data: {
      scope: 'workspace',
      key: params.key,
      value: params.value,
      variableType: 'credential',
      credentialSubType: params.credentialSubType,
      injectAsEnvVariable: false,
      description: params.description,
    },
  });

  expect(response.status()).toBe(201);
  const body = await response.json() as { variable?: { id?: string; key?: string; credentialSubType?: string }; scope?: string };
  expect(body.variable?.id).toBeTruthy();
  expect(body.variable?.key).toBe(params.key);
  expect(body.variable?.credentialSubType).toBe(params.credentialSubType);
  expect(body.scope).toBe('workspace');

  return {
    id: body.variable!.id!,
    key: params.key,
    scope: 'workspace',
  };
}

async function createDatabaseAgent(request: APIRequestContext, authToken: string, params: {
  prefix: string;
  description: string;
  copilotTokenCredentialId?: string;
  builtinToolNames?: string[];
}): Promise<AgentRecord> {
  const name = uniqueName(params.prefix);
  const response = await request.post('/api/agents', {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    data: {
      name,
      description: params.description,
      sourceType: 'database',
      copilotTokenCredentialId: params.copilotTokenCredentialId,
      builtinToolsEnabled: params.builtinToolNames
        ? { mode: 'explicit', names: params.builtinToolNames }
        : undefined,
      files: [
        {
          filePath: 'agent.md',
          content: '# External Integration Agent\n\nHandle external platform payloads and call approved tools only.',
        },
      ],
    },
  });

  expect(response.status()).toBe(201);
  const body = await response.json() as { agent?: { id?: string; name?: string; copilotTokenCredentialId?: string | null } };
  expect(body.agent?.id).toBeTruthy();
  if (params.copilotTokenCredentialId) {
    expect(body.agent?.copilotTokenCredentialId).toBe(params.copilotTokenCredentialId);
  }

  return {
    id: body.agent!.id!,
    name,
  };
}

async function createWebhookWorkflow(request: APIRequestContext, authToken: string, params: {
  agentId: string;
  promptTemplate: string;
  webhookPath: string;
}): Promise<WorkflowRecord> {
  const name = uniqueName('pw-external-webhook-workflow');
  const response = await request.post('/api/workflows', {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    data: {
      name,
      description: 'Playwright workflow for external integration webhook setup',
      scope: 'user',
      defaultAgentId: params.agentId,
      workerRuntime: 'static',
      stepAllocationTimeoutSeconds: 300,
      labels: ['external-integration', 'playwright'],
      steps: [
        {
          name: 'Handle External Payload',
          promptTemplate: params.promptTemplate,
          stepOrder: 1,
          timeoutSeconds: 300,
        },
      ],
      triggers: [
        {
          triggerType: 'webhook',
          isActive: false,
          configuration: {
            path: params.webhookPath,
            parameters: [
              {
                name: 'severity',
                required: true,
                description: 'Alert severity from the external platform',
              },
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
  };
}

async function deleteVariable(request: APIRequestContext, authToken: string, variable: VariableRecord) {
  const response = await request.delete(`/api/variables/${variable.id}?scope=${variable.scope}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });
  expect([200, 404]).toContain(response.status());
}

async function deleteAgent(request: APIRequestContext, authToken: string, agentId: string) {
  const response = await request.delete(`/api/agents/${agentId}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });
  expect([200, 404]).toContain(response.status());
}

async function deleteWorkflow(request: APIRequestContext, authToken: string, workflowId: string) {
  const response = await request.delete(`/api/workflows/${workflowId}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });
  expect([200, 404]).toContain(response.status());
}

test('workspace Copilot token variable can be assigned to an agent without exposing the token', async ({ page, request }) => {
  await loginViaUi(page, { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD, providerLabel: 'Email & Password' });
  const { authToken } = await getAuthContext(page);

  const tokenValue = `ghp_playwright_placeholder_${uniqueName('token')}`;
  let variable: VariableRecord | null = null;
  let agent: AgentRecord | null = null;

  try {
    variable = await createWorkspaceCredentialVariable(request, authToken, {
      key: uniqueVariableKey('COPILOT_TOKEN_PW'),
      value: tokenValue,
      credentialSubType: 'github_token',
      description: 'Playwright Copilot token credential',
    });
    agent = await createDatabaseAgent(request, authToken, {
      prefix: 'pw-copilot-token-agent',
      description: 'Agent configured with a workspace Copilot token credential',
      copilotTokenCredentialId: variable.id,
    });

    const detailResponse = await request.get(`/api/agents/${agent.id}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
    expect(detailResponse.status()).toBe(200);
    const detailBody = await detailResponse.json() as { agent?: Record<string, unknown> };
    expect(detailBody.agent?.copilotTokenCredentialId).toBe(variable.id);
    expect(JSON.stringify(detailBody)).not.toContain(tokenValue);

    await page.goto(`/default/variables/workspace/${variable.id}`);
    await expect(page.getByRole('heading', { name: variable.key, exact: true })).toBeVisible();
    await expect(page.getByText('github_token').first()).toBeVisible();
    await expect(page.getByText('Variable values are not shown after creation.')).toBeVisible();
    await expect(page.getByText(tokenValue)).toHaveCount(0);

    await page.goto(`/default/agents/${agent.id}`);
    await expect(page.getByRole('heading', { name: agent.name, exact: true })).toBeVisible();
    const variablesPanel = await openTab(page, /Variables/i);
    await expect(variablesPanel).toContainText(variable.key);
    await expect(variablesPanel).toContainText('credential');
    await expect(variablesPanel).not.toContainText(tokenValue);
  } finally {
    if (agent) await deleteAgent(request, authToken, agent.id);
    if (variable) await deleteVariable(request, authToken, variable);
  }
});

test('webhook workflow can reference an external HTTP credential without storing the secret in trigger config', async ({ page, request }) => {
  await loginViaUi(page, { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD, providerLabel: 'Email & Password' });
  const { authToken } = await getAuthContext(page);

  const webhookSecret = `https://hooks.slack.example/services/${uniqueName('secret')}`;
  let variable: VariableRecord | null = null;
  let agent: AgentRecord | null = null;
  let workflow: WorkflowRecord | null = null;

  try {
    variable = await createWorkspaceCredentialVariable(request, authToken, {
      key: uniqueVariableKey('SLACK_WEBHOOK_URL_PW'),
      value: webhookSecret,
      credentialSubType: 'secret_text',
      description: 'Playwright Slack webhook credential',
    });
    agent = await createDatabaseAgent(request, authToken, {
      prefix: 'pw-slack-webhook-agent',
      description: 'Agent allowed to call external HTTP APIs for webhook workflows',
      builtinToolNames: ['read_variables', 'simple_http_request'],
    });

    const promptTemplate = [
      `Read the credential variable ${variable.key}.`,
      'Use simple_http_request to POST a compact JSON alert summary to the webhook URL.',
      'Incoming severity: {{ inputs.severity }}',
      'Incoming title: {{ inputs.title | default("Untitled alert") }}',
    ].join('\n');
    const webhookPath = `/pw-external-${uniqueName('webhook').toLowerCase()}`;
    workflow = await createWebhookWorkflow(request, authToken, {
      agentId: agent.id,
      promptTemplate,
      webhookPath,
    });

    const triggerListResponse = await request.get('/api/triggers', {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      params: {
        workflowId: workflow.id,
      },
    });
    expect(triggerListResponse.status()).toBe(200);
    const triggerListBody = await triggerListResponse.json() as { triggers?: Array<Record<string, unknown>> };
    const trigger = triggerListBody.triggers?.find((entry) => entry.id === workflow!.triggerId);
    expect(trigger).toMatchObject({
      triggerType: 'webhook',
      isActive: false,
      configuration: {
        path: webhookPath,
        parameters: [
          {
            name: 'severity',
            required: true,
            description: 'Alert severity from the external platform',
          },
        ],
      },
    });
    expect(JSON.stringify(trigger)).not.toContain(webhookSecret);

    const agentResponse = await request.get(`/api/agents/${agent.id}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
    expect(agentResponse.status()).toBe(200);
    const agentBody = await agentResponse.json() as { agent?: { builtinToolsEnabled?: unknown } };
    expect(agentBody.agent?.builtinToolsEnabled).toEqual({
      mode: 'explicit',
      names: ['read_variables', 'simple_http_request'],
    });

    await page.goto(`/default/workflows/${workflow.id}`);
    await expect(page.getByRole('heading', { name: workflow.name, exact: true })).toBeVisible();
    const triggerPanel = await openTab(page, /Triggers/i);
    await expect(triggerPanel).toContainText('Webhook');
    await expect(triggerPanel).toContainText(webhookPath);
    await expect(triggerPanel).toContainText('1 parameter');
    await expect(triggerPanel).not.toContainText(webhookSecret);
  } finally {
    if (workflow) await deleteWorkflow(request, authToken, workflow.id);
    if (agent) await deleteAgent(request, authToken, agent.id);
    if (variable) await deleteVariable(request, authToken, variable);
  }
});
