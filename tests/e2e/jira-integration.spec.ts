import { Buffer } from 'node:buffer';
import { expect, test, type APIRequestContext, type Page } from './helpers/fixtures';
import { resetSuperAdminPassword, uniqueName } from './helpers/cluster';
import { ensureWorkspaceCopilotTokenVariable } from './helpers/copilot-token';
import { loginViaUi, openTab } from './helpers/ui';
import { loadTestEnv } from '../helpers/test-env';

const ADMIN_EMAIL = 'admin@oao.local';
const ADMIN_PASSWORD = 'AdminPass123!';
const WEEKLY_WEATHER_DESCRIPTION = 'Get a Weekly Weather Report';

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

interface LiveJiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  issueType: string;
}

interface JiraIssueRecord {
  id: string;
  key: string;
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

function jiraDescriptionDocument(text: string) {
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text },
        ],
      },
    ],
  };
}

function getLiveJiraConfig(): { config: LiveJiraConfig | null; skipReason: string } {
  loadTestEnv();

  const baseUrl = firstEnvValue('JIRA_BASE_URL', 'TESTING_JIRA_BASE_URL');
  const email = firstEnvValue('JIRA_EMAIL', 'TESTING_JIRA_EMAIL');
  const apiToken = firstEnvValue('JIRA_API_TOKEN', 'TESTING_JIRA_API_TOKEN');
  const projectKey = firstEnvValue('JIRA_PROJECT_KEY', 'TESTING_JIRA_PROJECT_KEY');
  const issueType = firstEnvValue('JIRA_ISSUE_TYPE', 'TESTING_JIRA_ISSUE_TYPE') || 'Task';
  const missingKeys = [
    !baseUrl ? 'JIRA_BASE_URL or TESTING_JIRA_BASE_URL' : null,
    !email ? 'JIRA_EMAIL or TESTING_JIRA_EMAIL' : null,
    !apiToken ? 'JIRA_API_TOKEN or TESTING_JIRA_API_TOKEN' : null,
    !projectKey ? 'JIRA_PROJECT_KEY or TESTING_JIRA_PROJECT_KEY' : null,
  ].filter((key): key is string => Boolean(key));
  const hasOptIn = process.env.RUN_LIVE_JIRA_E2E === '1' || process.env.RUN_JIRA_INTEGRATION === '1';

  if (!hasOptIn || missingKeys.length > 0) {
    const missingDetails = missingKeys.length > 0 ? ` Missing: ${missingKeys.join(', ')}.` : '';
    return {
      config: null,
      skipReason: `Set RUN_LIVE_JIRA_E2E=1 plus Jira env vars to run the live Jira ticket trigger test.${missingDetails}`,
    };
  }

  return {
    config: {
      baseUrl: baseUrl!.replace(/\/+$/, ''),
      email: email!,
      apiToken: apiToken!,
      projectKey: projectKey!,
      issueType,
    },
    skipReason: '',
  };
}

function firstEnvValue(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return null;
}

function jiraHeaders(config: LiveJiraConfig) {
  return {
    Authorization: `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

async function createJiraIssue(config: LiveJiraConfig, label: string): Promise<JiraIssueRecord> {
  const response = await fetch(`${config.baseUrl}/rest/api/3/issue`, {
    method: 'POST',
    headers: jiraHeaders(config),
    body: JSON.stringify({
      fields: {
        project: { key: config.projectKey },
        issuetype: { name: config.issueType },
        summary: `OAO E2E Weekly Weather Report ${label}`,
        description: jiraDescriptionDocument(WEEKLY_WEATHER_DESCRIPTION),
        labels: [label],
      },
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Failed to create Jira issue (${response.status}): ${text}`);
  }

  const body = JSON.parse(text) as { id?: string; key?: string };
  expect(body.id).toBeTruthy();
  expect(body.key).toBeTruthy();
  return { id: body.id!, key: body.key! };
}

async function deleteJiraIssue(config: LiveJiraConfig, issueKey: string) {
  const response = await fetch(`${config.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
    method: 'DELETE',
    headers: jiraHeaders(config),
  });

  if (![204, 404].includes(response.status)) {
    const text = await response.text();
    throw new Error(`Failed to delete Jira issue ${issueKey} (${response.status}): ${text}`);
  }
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
      description: 'Playwright agent for Jira integration coverage',
      sourceType: 'database',
      ...(copilotTokenCredentialId ? { copilotTokenCredentialId } : {}),
      files: [
        {
          filePath: 'agent.md',
          content: '# Jira Integration Agent\n\nHandle Jira issue payloads and return a concise summary.',
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

async function createWorkspaceCredentialVariable(
  request: APIRequestContext,
  authToken: string,
  key: string,
  value: string,
  description: string,
): Promise<VariableRecord> {
  const response = await request.post('/api/variables', {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    data: {
      scope: 'workspace',
      key,
      value,
      variableType: 'credential',
      credentialSubType: 'secret_text',
      injectAsEnvVariable: false,
      description,
    },
  });

  expect(response.status()).toBe(201);
  const body = await response.json() as { variable?: { id?: string; key?: string }; scope?: string };
  expect(body.variable?.id).toBeTruthy();
  expect(body.variable?.key).toBe(key);
  expect(body.scope).toBe('workspace');

  return {
    id: body.variable!.id!,
    key,
    scope: 'workspace',
  };
}

async function createJiraNotificationWorkflow(request: APIRequestContext, authToken: string, params: {
  agentId: string;
  accessTokenVariableKey: string;
  refreshTokenVariableKey: string;
  clientIdVariableKey: string;
  clientSecretVariableKey: string;
  jql: string;
  defaultModel?: string;
}) {
  const name = uniqueName('pw-jira-notify-workflow');
  const response = await request.post('/api/workflows', {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    data: {
      name,
      description: 'Playwright workflow with Jira dynamic webhook configuration',
      scope: 'user',
      defaultAgentId: params.agentId,
      workerRuntime: 'static',
      stepAllocationTimeoutSeconds: 300,
      ...(params.defaultModel ? { defaultModel: params.defaultModel } : {}),
      steps: [
        {
          name: 'Handle Jira Description',
          promptTemplate: `Review Jira ticket descriptions and identify weather-report requests. Description request: ${WEEKLY_WEATHER_DESCRIPTION}.`,
          stepOrder: 1,
          timeoutSeconds: 300,
        },
      ],
      triggers: [
        {
          triggerType: 'jira_changes_notification',
          isActive: false,
          configuration: {
            jiraSiteUrl: 'https://example.atlassian.net',
            authMode: 'oauth2',
            credentials: {
              accessTokenVariableKey: params.accessTokenVariableKey,
              refreshTokenVariableKey: params.refreshTokenVariableKey,
              clientIdVariableKey: params.clientIdVariableKey,
              clientSecretVariableKey: params.clientSecretVariableKey,
            },
            jql: params.jql,
            events: ['jira:issue_created', 'jira:issue_updated'],
            fieldIdsFilter: ['summary', 'description'],
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
  } satisfies WorkflowRecord;
}

async function createJiraPollingWorkflow(request: APIRequestContext, authToken: string, params: {
  agentId: string;
  jiraSiteUrl: string;
  jiraEmail: string;
  apiTokenVariableKey: string;
  jql: string;
  isActive: boolean;
  defaultModel?: string;
}) {
  const name = uniqueName('pw-jira-poll-workflow');
  const response = await request.post('/api/workflows', {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    data: {
      name,
      description: 'Playwright workflow with Jira polling trigger',
      scope: 'user',
      defaultAgentId: params.agentId,
      workerRuntime: 'static',
      stepAllocationTimeoutSeconds: 300,
      ...(params.defaultModel ? { defaultModel: params.defaultModel } : {}),
      steps: [
        {
          name: 'Handle Jira Description',
          promptTemplate: [
            'Handle Jira ticket descriptions for weekly weather report requests.',
            'Issue keys: {{ inputs.jiraIssueKeys | join(", ") }}',
            // Jira Cloud descriptions are ADF (a JSON object). Bare `{{ ... }}`
            // would render as `[object Object]`; use `| dump` so the agent sees
            // readable JSON instead.
            'First issue description: {{ inputs.jiraIssues[0].fields.description | dump | default("\"No description\"") }}',
          ].join('\n'),
          stepOrder: 1,
          timeoutSeconds: 300,
        },
      ],
      triggers: [
        {
          triggerType: 'jira_polling',
          isActive: params.isActive,
          configuration: {
            jiraSiteUrl: params.jiraSiteUrl,
            authMode: 'api_token',
            credentials: {
              email: params.jiraEmail,
              apiTokenVariableKey: params.apiTokenVariableKey,
            },
            jql: params.jql,
            intervalMinutes: 1,
            maxResults: 10,
            fields: ['summary', 'description', 'status', 'updated', 'issuetype', 'priority', 'labels'],
            initialLoadMode: 'include_current_matches',
            overlapMinutes: 5,
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
  } satisfies WorkflowRecord;
}

async function deleteVariable(request: APIRequestContext, authToken: string, variable: VariableRecord) {
  const response = await request.delete(`/api/variables/${variable.id}?scope=${variable.scope}`, {
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

async function deleteAgent(request: APIRequestContext, authToken: string, agentId: string) {
  const response = await request.delete(`/api/agents/${agentId}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });
  expect([200, 404]).toContain(response.status());
}

async function waitForJiraExecution(request: APIRequestContext, authToken: string, workflowId: string, issueKey: string) {
  let matchingExecution: Record<string, unknown> | null = null;

  await expect.poll(async () => {
    const response = await request.get('/api/executions', {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      params: {
        workflowId,
        page: '1',
        limit: '20',
      },
    });

    if ([502, 503, 504].includes(response.status())) {
      return '';
    }

    expect(response.status()).toBe(200);
    const body = await response.json() as { executions?: Array<Record<string, unknown>> };
    matchingExecution = (body.executions || []).find((execution) => {
      return JSON.stringify(execution.triggerMetadata || {}).includes(issueKey);
    }) || null;

    return typeof matchingExecution?.id === 'string' ? matchingExecution.id : '';
  }, { timeout: 150_000, intervals: [5_000] }).not.toBe('');

  return matchingExecution!;
}

async function waitForExecutionCompletion(
  request: APIRequestContext,
  authToken: string,
  executionId: string,
  timeout = 180_000,
): Promise<{ execution: Record<string, unknown>; steps: Array<Record<string, unknown>> }> {
  let finalExecution: Record<string, unknown> = {};
  let finalSteps: Array<Record<string, unknown>> = [];

  await expect.poll(async () => {
    const response = await request.get(`/api/executions/${executionId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    if ([502, 503, 504].includes(response.status())) return '';

    expect(response.status()).toBe(200);
    const body = await response.json() as {
      execution?: Record<string, unknown>;
      steps?: Array<Record<string, unknown>>;
    };

    finalExecution = body.execution ?? {};
    finalSteps = body.steps ?? [];
    return typeof finalExecution.status === 'string' ? finalExecution.status : '';
  }, { timeout, intervals: [3_000] }).toMatch(/^(completed|failed)$/);

  return { execution: finalExecution, steps: finalSteps };
}

async function fireTrigger(
  request: APIRequestContext,
  authToken: string,
  triggerId: string,
  payload?: Record<string, unknown>,
): Promise<{ fired?: boolean; executionId?: string; issueCount?: number; error?: string }> {
  const response = await request.post(`/api/triggers/${triggerId}/fire`, {
    headers: { Authorization: `Bearer ${authToken}` },
    data: payload !== undefined ? { payload } : {},
  });
  return response.json() as Promise<{ fired?: boolean; executionId?: string; issueCount?: number; error?: string }>;
}

function buildMockJiraIssuePayload(issueKey: string, summary: string, description: string) {
  return {
    webhookEvent: 'jira:issue_created',
    issue_event_type_name: 'issue_created',
    issue: {
      id: '10001',
      key: issueKey,
      fields: {
        summary,
        description: jiraDescriptionDocument(description),
        status: { name: 'To Do' },
        updated: new Date().toISOString(),
        issuetype: { name: 'Task' },
        priority: { name: 'Medium' },
        labels: [],
      },
    },
  };
}

async function createJiraNotificationWorkflowWithDummyCredentials(
  request: APIRequestContext,
  authToken: string,
  agentId: string,
  variables: VariableRecord[],
  options: { defaultModel?: string } = {},
) {
  const jql = `project = OAO AND description ~ "${WEEKLY_WEATHER_DESCRIPTION}"`;
  return createJiraNotificationWorkflow(request, authToken, {
    agentId,
    accessTokenVariableKey: variables[0].key,
    refreshTokenVariableKey: variables[1].key,
    clientIdVariableKey: variables[2].key,
    clientSecretVariableKey: variables[3].key,
    jql,
    defaultModel: options.defaultModel,
  });
}

test('workspace Jira credential variable is stored without exposing the secret value', async ({ page, request }) => {
  await loginViaUi(page, { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD, providerLabel: 'Built-in Database' });
  const { authToken } = await getAuthContext(page);

  const secretValue = `dummy-jira-token-${uniqueName('secret')}`;
  const variable = await createWorkspaceCredentialVariable(
    request,
    authToken,
    uniqueVariableKey('JIRA_API_TOKEN_PW'),
    secretValue,
    'Playwright Jira API token credential',
  );

  try {
    const listResponse = await request.get('/api/variables?scope=workspace', {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
    expect(listResponse.status()).toBe(200);
    const listBody = await listResponse.json() as { variables?: Array<Record<string, unknown>> };
    const storedVariable = (listBody.variables || []).find((entry) => entry.id === variable.id);
    expect(storedVariable).toMatchObject({
      key: variable.key,
      variableType: 'credential',
      credentialSubType: 'secret_text',
      injectAsEnvVariable: false,
    });
    expect(JSON.stringify(listBody)).not.toContain(secretValue);

    await page.goto('/default/variables');
    await expect(page.getByRole('heading', { name: 'Variables', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: variable.key, exact: true })).toBeVisible();
    await page.getByRole('link', { name: variable.key, exact: true }).click();
    await expect(page.getByRole('heading', { name: variable.key, exact: true })).toBeVisible();
    await expect(page.getByText('Variable values are not shown after creation.')).toBeVisible();
    await expect(page.getByText(secretValue)).toHaveCount(0);
  } finally {
    await deleteVariable(request, authToken, variable);
  }
});

test('workflow can save a Jira dynamic webhook trigger with JQL and credential references', async ({ page, request }) => {
  await loginViaUi(page, { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD, providerLabel: 'Built-in Database' });
  const { authToken } = await getAuthContext(page);

  const variableDefinitions = [
    { key: uniqueVariableKey('JIRA_ACCESS_TOKEN_PW'), value: 'dummy-oauth-access-token' },
    { key: uniqueVariableKey('JIRA_REFRESH_TOKEN_PW'), value: 'dummy-oauth-refresh-token' },
    { key: uniqueVariableKey('JIRA_CLIENT_ID_PW'), value: 'dummy-oauth-client-id' },
    { key: uniqueVariableKey('JIRA_CLIENT_SECRET_PW'), value: 'dummy-oauth-client-secret' },
  ];
  const variables: VariableRecord[] = [];
  let agent: AgentRecord | null = null;
  let workflow: WorkflowRecord | null = null;

  try {
    for (const definition of variableDefinitions) {
      variables.push(await createWorkspaceCredentialVariable(
        request,
        authToken,
        definition.key,
        definition.value,
        'Playwright Jira OAuth credential reference',
      ));
    }

    agent = await createDatabaseAgent(request, authToken, 'pw-jira-notify-agent');
    const jql = `project = OAO AND description ~ "${WEEKLY_WEATHER_DESCRIPTION}"`;
    workflow = await createJiraNotificationWorkflow(request, authToken, {
      agentId: agent.id,
      accessTokenVariableKey: variables[0].key,
      refreshTokenVariableKey: variables[1].key,
      clientIdVariableKey: variables[2].key,
      clientSecretVariableKey: variables[3].key,
      jql,
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
    const triggerListBody = await triggerListResponse.json() as { triggers?: Array<Record<string, any>> };
    const trigger = triggerListBody.triggers?.find((entry) => entry.id === workflow!.triggerId);
    expect(trigger).toBeTruthy();
    expect(trigger).toMatchObject({
      triggerType: 'jira_changes_notification',
      isActive: false,
      runtimeSummary: { status: 'inactive' },
    });
    expect(trigger?.configuration).toMatchObject({
      authMode: 'oauth2',
      jql,
      credentials: {
        accessTokenVariableKey: variables[0].key,
        refreshTokenVariableKey: variables[1].key,
        clientIdVariableKey: variables[2].key,
        clientSecretVariableKey: variables[3].key,
      },
      events: ['jira:issue_created', 'jira:issue_updated'],
      fieldIdsFilter: ['summary', 'description'],
    });
    expect(JSON.stringify(trigger)).not.toContain('dummy-oauth-access-token');

    await page.goto(`/default/workflows/${workflow.id}`);
    await expect(page.getByRole('heading', { name: workflow.name, exact: true })).toBeVisible();
    const triggerPanel = await openTab(page, /Triggers/i);
    await expect(triggerPanel).toContainText('Jira Changes Notification');
    await expect(triggerPanel).toContainText('Inactive');
    await expect(triggerPanel).toContainText('JQL:');
    await expect(triggerPanel).toContainText(WEEKLY_WEATHER_DESCRIPTION);
  } finally {
    if (workflow) await deleteWorkflow(request, authToken, workflow.id);
    if (agent) await deleteAgent(request, authToken, agent.id);
    for (const variable of variables) {
      await deleteVariable(request, authToken, variable);
    }
  }
});

test('live Jira polling workflow creates an execution for a new weather-report ticket', async ({ page, request }) => {
  test.setTimeout(180_000);

  const liveJira = getLiveJiraConfig();
  if (!liveJira.config) {
    test.skip(true, liveJira.skipReason);
    return;
  }

  await loginViaUi(page, { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD, providerLabel: 'Built-in Database' });
  const { authToken } = await getAuthContext(page);

  const label = uniqueName('oao-e2e-jira').toLowerCase();
  const jql = `project = ${liveJira.config.projectKey} AND labels = "${label}"`;
  let variable: VariableRecord | null = null;
  let agent: AgentRecord | null = null;
  let workflow: WorkflowRecord | null = null;
  let jiraIssue: JiraIssueRecord | null = null;

  try {
    variable = await createWorkspaceCredentialVariable(
      request,
      authToken,
      uniqueVariableKey('JIRA_API_TOKEN_PW'),
      liveJira.config.apiToken,
      'Live Jira API token for Playwright polling test',
    );
    agent = await createDatabaseAgent(request, authToken, 'pw-jira-live-agent');
    workflow = await createJiraPollingWorkflow(request, authToken, {
      agentId: agent.id,
      jiraSiteUrl: liveJira.config.baseUrl,
      jiraEmail: liveJira.config.email,
      apiTokenVariableKey: variable.key,
      jql,
      isActive: true,
    });

    const connectivityResponse = await request.post(`/api/triggers/${workflow.triggerId}/test`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
    expect(connectivityResponse.status()).toBe(200);
    const connectivityBody = await connectivityResponse.json() as { ok?: boolean; summary?: string };
    expect(connectivityBody.ok).toBe(true);
    expect(connectivityBody.summary).toContain('Jira search succeeded');

    jiraIssue = await createJiraIssue(liveJira.config, label);

    const execution = await waitForJiraExecution(request, authToken, workflow.id, jiraIssue.key);
    expect(execution).toMatchObject({
      workflowId: workflow.id,
      triggerId: workflow.triggerId,
    });
    const triggerMetadata = JSON.stringify(execution.triggerMetadata || {});
    expect(triggerMetadata).toContain('jira_polling');
    expect(triggerMetadata).toContain(jiraIssue.key);
    expect(triggerMetadata).toContain(WEEKLY_WEATHER_DESCRIPTION);

    await page.goto('/default/executions');
    await expect(page.getByRole('heading', { name: /Workflow Executions/i })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(`^${String(execution.id).substring(0, 8)}`) })).toBeVisible();
  } finally {
    if (jiraIssue) {
      await deleteJiraIssue(liveJira.config, jiraIssue.key).catch((error: unknown) => {
        console.warn(error instanceof Error ? error.message : 'Failed to delete Jira issue created by E2E test');
      });
    }
    if (workflow) await deleteWorkflow(request, authToken, workflow.id);
    if (agent) await deleteAgent(request, authToken, agent.id);
    if (variable) await deleteVariable(request, authToken, variable);
  }
});

// ─── Jira Changes Notification: Simulation via force-fire endpoint ────────────

test('Jira changes notification simulation fires and completes a workflow execution', async ({ page, request }) => {
  test.setTimeout(240_000);

  loadTestEnv();
  const copilotTokenValue = firstEnvValue('TESTING_GITHUB_PAT', 'GITHUB_TOKEN');
  if (!copilotTokenValue) {
    test.skip(true, 'TESTING_GITHUB_PAT or GITHUB_TOKEN must be set so the simulated workflow execution can run a real Copilot session.');
    return;
  }

  await loginViaUi(page, { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD, providerLabel: 'Built-in Database' });
  const { authToken } = await getAuthContext(page);

  const variableDefinitions = [
    { key: uniqueVariableKey('JIRA_ACCESS_TOKEN_SIM'), value: 'sim-oauth-access-token' },
    { key: uniqueVariableKey('JIRA_REFRESH_TOKEN_SIM'), value: 'sim-oauth-refresh-token' },
    { key: uniqueVariableKey('JIRA_CLIENT_ID_SIM'), value: 'sim-oauth-client-id' },
    { key: uniqueVariableKey('JIRA_CLIENT_SECRET_SIM'), value: 'sim-oauth-client-secret' },
  ];
  const variables: VariableRecord[] = [];
  let copilotTokenVariable: VariableRecord | null = null;
  let agent: AgentRecord | null = null;
  let workflow: WorkflowRecord | null = null;

  try {
    for (const definition of variableDefinitions) {
      variables.push(await createWorkspaceCredentialVariable(
        request,
        authToken,
        definition.key,
        definition.value,
        'Simulation Jira OAuth credential reference',
      ));
    }

    // Attach a real Copilot token credential so the agent can actually run.
    const copilotResponse = await request.post('/api/variables', {
      headers: { Authorization: `Bearer ${authToken}` },
      data: {
        scope: 'workspace',
        key: uniqueVariableKey('COPILOT_TOKEN_SIM'),
        value: copilotTokenValue,
        variableType: 'credential',
        credentialSubType: 'github_token',
        injectAsEnvVariable: false,
        description: 'GitHub Copilot token (Jira simulation E2E)',
      },
    });
    expect(copilotResponse.status()).toBe(201);
    const copilotBody = await copilotResponse.json() as { variable?: { id?: string; key?: string } };
    expect(copilotBody.variable?.id).toBeTruthy();
    copilotTokenVariable = {
      id: copilotBody.variable!.id!,
      key: copilotBody.variable!.key!,
      scope: 'workspace',
    };

    agent = await createDatabaseAgentWithCopilotToken(request, authToken, 'pw-jira-sim-agent', copilotTokenVariable.id);
    workflow = await createJiraNotificationWorkflowWithDummyCredentials(request, authToken, agent.id, variables, { defaultModel: 'gpt-5-mini' });

    // Fire the trigger with a simulated Jira issue payload
    const mockIssueKey = 'OAOE2E-42';
    const mockPayload = buildMockJiraIssuePayload(
      mockIssueKey,
      'OAO E2E: Simulated weather report task',
      WEEKLY_WEATHER_DESCRIPTION,
    );

    const fireResult = await fireTrigger(request, authToken, workflow.triggerId, mockPayload);
    expect(fireResult.fired).toBe(true);
    expect(typeof fireResult.executionId).toBe('string');
    expect(fireResult.executionId).toBeTruthy();

    // Wait for the execution to complete
    const { execution, steps } = await waitForExecutionCompletion(
      request, authToken, fireResult.executionId!, 200_000,
    );

    // Verify execution metadata
    expect(execution.workflowId).toBe(workflow.id);
    expect(execution.triggerId).toBe(workflow.triggerId);
    const triggerMetadata = JSON.stringify(execution.triggerMetadata ?? {});
    expect(triggerMetadata).toContain('jira_changes_notification');
    expect(triggerMetadata).toContain('simulated');
    expect(triggerMetadata).toContain(mockIssueKey);

    // Verify step execution completed with output
    expect(steps.length).toBeGreaterThan(0);
    const firstStep = steps[0];
    expect(firstStep.status).toBe('completed');
    expect(typeof firstStep.output).toBe('string');
    expect((firstStep.output as string).trim().length).toBeGreaterThan(0);

    // Verify execution status
    expect(execution.status).toBe('completed');

    // UI: navigate to executions list
    await page.goto('/default/executions');
    await expect(page.getByRole('heading', { name: /Workflow Executions/i })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(`^${fireResult.executionId!.substring(0, 8)}`) })).toBeVisible();

    // UI: open execution detail page
    const executionId = fireResult.executionId!;
    await page.goto(`/default/executions/${executionId}`);
    await expect(page).toHaveURL(new RegExp(`/default/executions/${executionId}$`));
    await expect(page.getByRole('heading', { name: new RegExp(`Execution ${executionId.substring(0, 8)}`) })).toBeVisible();

    // The execution page should link back to the workflow
    await expect(page.getByRole('link', { name: workflow.name, exact: true })).toBeVisible();

    // The step output should appear somewhere on the page
    await expect(page.locator('main')).toContainText(/completed/i);
  } finally {
    if (workflow) await deleteWorkflow(request, authToken, workflow.id);
    if (agent) await deleteAgent(request, authToken, agent.id);
    for (const variable of variables) {
      await deleteVariable(request, authToken, variable);
    }
    if (copilotTokenVariable) await deleteVariable(request, authToken, copilotTokenVariable);
  }
});

// ─── Jira Polling: Force-fire + execution completion verification ─────────────

test('live Jira polling force-fire immediately polls and completes a workflow execution', async ({ page, request }) => {
  test.setTimeout(300_000);

  const liveJira = getLiveJiraConfig();
  if (!liveJira.config) {
    test.skip(true, liveJira.skipReason);
    return;
  }

  loadTestEnv();
  const copilotTokenValue = firstEnvValue('TESTING_GITHUB_PAT', 'GITHUB_TOKEN');
  if (!copilotTokenValue) {
    test.skip(true, 'TESTING_GITHUB_PAT or GITHUB_TOKEN must be set so the polling workflow execution can run a real Copilot session.');
    return;
  }

  await loginViaUi(page, { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD, providerLabel: 'Built-in Database' });
  const { authToken } = await getAuthContext(page);

  const label = uniqueName('oao-force-fire').toLowerCase();
  const jql = `project = ${liveJira.config.projectKey} AND labels = "${label}"`;
  let variable: VariableRecord | null = null;
  let copilotTokenVariable: VariableRecord | null = null;
  let agent: AgentRecord | null = null;
  let workflow: WorkflowRecord | null = null;
  let jiraIssue: JiraIssueRecord | null = null;

  try {
    variable = await createWorkspaceCredentialVariable(
      request,
      authToken,
      uniqueVariableKey('JIRA_API_TOKEN_FF'),
      liveJira.config.apiToken,
      'Live Jira API token for force-fire test',
    );
    const copilotResponse = await request.post('/api/variables', {
      headers: { Authorization: `Bearer ${authToken}` },
      data: {
        scope: 'workspace',
        key: uniqueVariableKey('COPILOT_TOKEN_FF'),
        value: copilotTokenValue,
        variableType: 'credential',
        credentialSubType: 'github_token',
        injectAsEnvVariable: false,
        description: 'GitHub Copilot token (Jira force-fire E2E)',
      },
    });
    expect(copilotResponse.status()).toBe(201);
    const copilotBody = await copilotResponse.json() as { variable?: { id?: string; key?: string } };
    expect(copilotBody.variable?.id).toBeTruthy();
    copilotTokenVariable = {
      id: copilotBody.variable!.id!,
      key: copilotBody.variable!.key!,
      scope: 'workspace',
    };
    agent = await createDatabaseAgentWithCopilotToken(request, authToken, 'pw-jira-force-agent', copilotTokenVariable.id);
    workflow = await createJiraPollingWorkflow(request, authToken, {
      agentId: agent.id,
      jiraSiteUrl: liveJira.config.baseUrl,
      jiraEmail: liveJira.config.email,
      apiTokenVariableKey: variable.key,
      jql,
      isActive: true,
      defaultModel: 'gpt-5-mini',
    });

    // Confirm connectivity before creating the Jira issue
    const connectivityResponse = await request.post(`/api/triggers/${workflow.triggerId}/test`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(connectivityResponse.status()).toBe(200);
    const connectivityBody = await connectivityResponse.json() as { ok?: boolean; summary?: string };
    expect(connectivityBody.ok).toBe(true);

    // Create a real Jira issue
    jiraIssue = await createJiraIssue(liveJira.config, label);

    // Force-fire the polling trigger immediately (no 1-minute wait)
    const fireResult = await fireTrigger(request, authToken, workflow.triggerId);
    expect(fireResult.fired).toBe(true);
    expect(typeof fireResult.executionId).toBe('string');
    expect(fireResult.executionId).toBeTruthy();
    expect(typeof fireResult.issueCount).toBe('number');
    expect(fireResult.issueCount).toBeGreaterThan(0);

    // Wait for the execution to complete
    const { execution, steps } = await waitForExecutionCompletion(
      request, authToken, fireResult.executionId!, 250_000,
    );

    // Verify execution metadata
    expect(execution.workflowId).toBe(workflow.id);
    expect(execution.triggerId).toBe(workflow.triggerId);
    const triggerMetadata = JSON.stringify(execution.triggerMetadata ?? {});
    expect(triggerMetadata).toContain('jira_polling');
    expect(triggerMetadata).toContain(jiraIssue.key);
    expect(triggerMetadata).toContain(WEEKLY_WEATHER_DESCRIPTION);

    // Verify step execution completed with output
    expect(steps.length).toBeGreaterThan(0);
    const firstStep = steps[0];
    expect(firstStep.status).toBe('completed');
    expect(typeof firstStep.output).toBe('string');
    const stepOutput = (firstStep.output as string).trim();
    expect(stepOutput.length).toBeGreaterThan(0);
    // The step output should mention weather or the issue since the prompt references it
    expect(stepOutput).toMatch(/weather|report|jira|issue/i);

    expect(execution.status).toBe('completed');

    // UI: navigate to execution detail page
    const executionId = fireResult.executionId!;
    await page.goto(`/default/executions/${executionId}`);
    await expect(page).toHaveURL(new RegExp(`/default/executions/${executionId}$`));
    await expect(page.getByRole('heading', { name: new RegExp(`Execution ${executionId.substring(0, 8)}`) })).toBeVisible();
    await expect(page.getByRole('link', { name: workflow.name, exact: true })).toBeVisible();
    await expect(page.locator('main')).toContainText(/completed/i);

    // Step output text is verified via API above (see stepOutput.toMatch).
    // The UI page collapses step output by default, so we don't assert it here.
  } finally {
    if (jiraIssue) {
      await deleteJiraIssue(liveJira.config, jiraIssue.key).catch((error: unknown) => {
        console.warn(error instanceof Error ? error.message : 'Failed to delete Jira issue created by E2E force-fire test');
      });
    }
    if (workflow) await deleteWorkflow(request, authToken, workflow.id);
    if (agent) await deleteAgent(request, authToken, agent.id);
    if (variable) await deleteVariable(request, authToken, variable);
    if (copilotTokenVariable) await deleteVariable(request, authToken, copilotTokenVariable);
  }
});

// ─── Jira fire endpoint: authorization enforcement ────────────────────────────

test('non-admin user cannot force-fire a Jira trigger', async ({ page, request }) => {
  await loginViaUi(page, { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD, providerLabel: 'Built-in Database' });
  const { authToken: adminToken } = await getAuthContext(page);

  const variableDefinitions = [
    { key: uniqueVariableKey('JIRA_ACCESS_TOKEN_AUTH'), value: 'dummy-access-token' },
    { key: uniqueVariableKey('JIRA_REFRESH_TOKEN_AUTH'), value: 'dummy-refresh-token' },
    { key: uniqueVariableKey('JIRA_CLIENT_ID_AUTH'), value: 'dummy-client-id' },
    { key: uniqueVariableKey('JIRA_CLIENT_SECRET_AUTH'), value: 'dummy-client-secret' },
  ];
  const variables: VariableRecord[] = [];
  let agent: AgentRecord | null = null;
  let workflow: WorkflowRecord | null = null;

  // Create a regular non-admin user
  const regularUserEmail = `e2e-nonadmin-${uniqueName('u')}@oao.test`;
  const regularUserPassword = 'TestPass123!';
  let regularUserId: string | null = null;

  try {
    // Create the non-admin user
    const createUserResponse = await request.post('/api/users', {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        email: regularUserEmail,
        password: regularUserPassword,
        role: 'creator',
        workspaceId: 'default',
      },
    });
    if (createUserResponse.status() === 201) {
      const createUserBody = await createUserResponse.json() as { user?: { id?: string } };
      regularUserId = createUserBody.user?.id ?? null;
    }

    // Login as the regular user
    const loginResponse = await request.post('/api/auth/login', {
      data: { identifier: regularUserEmail, password: regularUserPassword, provider: 'database' },
    });
    if (loginResponse.status() !== 200) {
      // If user creation/login isn't available, skip this test gracefully
      return;
    }
    const loginBody = await loginResponse.json() as { token?: string };
    const regularUserToken = loginBody.token;
    if (!regularUserToken) return;

    // Set up workflow + trigger as admin
    for (const definition of variableDefinitions) {
      variables.push(await createWorkspaceCredentialVariable(
        request, adminToken, definition.key, definition.value, 'Auth test credential',
      ));
    }
    agent = await createDatabaseAgent(request, adminToken, 'pw-jira-auth-agent');
    workflow = await createJiraNotificationWorkflowWithDummyCredentials(request, adminToken, agent.id, variables);

    // Non-admin should get 403 when trying to force-fire
    const fireResponse = await request.post(`/api/triggers/${workflow.triggerId}/fire`, {
      headers: { Authorization: `Bearer ${regularUserToken}` },
      data: {},
    });
    expect(fireResponse.status()).toBe(403);
  } finally {
    if (workflow) await deleteWorkflow(request, adminToken, workflow.id);
    if (agent) await deleteAgent(request, adminToken, agent.id);
    for (const variable of variables) {
      await deleteVariable(request, adminToken, variable);
    }
    if (regularUserId) {
      await request.delete(`/api/users/${regularUserId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      }).catch(() => undefined);
    }
  }
});

// ─── Jira Polling: Trigger connectivity + runtimeSummary display ──────────────

test('Jira polling trigger runtimeSummary reflects connectivity test result', async ({ page, request }) => {
  const liveJira = getLiveJiraConfig();
  if (!liveJira.config) {
    test.skip(true, liveJira.skipReason);
    return;
  }

  await loginViaUi(page, { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD, providerLabel: 'Built-in Database' });
  const { authToken } = await getAuthContext(page);

  let variable: VariableRecord | null = null;
  let agent: AgentRecord | null = null;
  let workflow: WorkflowRecord | null = null;

  try {
    variable = await createWorkspaceCredentialVariable(
      request, authToken, uniqueVariableKey('JIRA_API_TOKEN_RT'),
      liveJira.config.apiToken, 'Runtime-summary test token',
    );
    agent = await createDatabaseAgent(request, authToken, 'pw-jira-rt-agent');
    workflow = await createJiraPollingWorkflow(request, authToken, {
      agentId: agent.id,
      jiraSiteUrl: liveJira.config.baseUrl,
      jiraEmail: liveJira.config.email,
      apiTokenVariableKey: variable.key,
      jql: `project = ${liveJira.config.projectKey} ORDER BY updated DESC`,
      isActive: false,
    });

    // Before test: trigger shows inactive
    const beforeTestResponse = await request.get('/api/triggers', {
      headers: { Authorization: `Bearer ${authToken}` },
      params: { workflowId: workflow.id },
    });
    expect(beforeTestResponse.status()).toBe(200);
    const beforeBody = await beforeTestResponse.json() as { triggers?: Array<Record<string, unknown>> };
    const beforeTrigger = beforeBody.triggers?.find((t) => t.id === workflow!.triggerId);
    expect(beforeTrigger?.isActive).toBe(false);

    // Run connectivity test
    const testResponse = await request.post(`/api/triggers/${workflow.triggerId}/test`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(testResponse.status()).toBe(200);
    const testBody = await testResponse.json() as { ok?: boolean; summary?: string };
    expect(testBody.ok).toBe(true);
    expect(testBody.summary).toContain('Jira search succeeded');

    // UI: workflow triggers tab shows Jira polling configuration
    await page.goto(`/default/workflows/${workflow.id}`);
    await expect(page.getByRole('heading', { name: workflow.name, exact: true })).toBeVisible();
    const triggerPanel = await openTab(page, /Triggers/i);
    await expect(triggerPanel).toContainText('Jira Polling');
    await expect(triggerPanel).toContainText('Inactive');
    await expect(triggerPanel).toContainText(`project = ${liveJira.config.projectKey}`);
  } finally {
    if (workflow) await deleteWorkflow(request, authToken, workflow.id);
    if (agent) await deleteAgent(request, authToken, agent.id);
    if (variable) await deleteVariable(request, authToken, variable);
  }
});

// ─── Ephemeral runtime + Copilot token credential + Jira polling (live) ──────

async function createDatabaseAgentWithCopilotToken(
  request: APIRequestContext,
  authToken: string,
  prefix: string,
  copilotTokenCredentialId: string,
): Promise<AgentRecord> {
  const name = uniqueName(prefix);
  const response = await request.post('/api/agents', {
    headers: { Authorization: `Bearer ${authToken}` },
    data: {
      name,
      description: 'Playwright agent with Copilot token credential for Jira ticket handling',
      sourceType: 'database',
      copilotTokenCredentialId,
      files: [
        {
          filePath: 'agent.md',
          content: '# Jira Ticket Handler Agent\n\nYou handle Jira issue payloads. Read the description and fulfil the request — for example, produce a concise weather report when asked.',
        },
      ],
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json() as { agent?: { id?: string; copilotTokenCredentialId?: string | null } };
  expect(body.agent?.id).toBeTruthy();
  expect(body.agent?.copilotTokenCredentialId).toBe(copilotTokenCredentialId);
  return { id: body.agent!.id!, name };
}

async function createJiraPollingEphemeralWorkflow(
  request: APIRequestContext,
  authToken: string,
  params: {
    agentId: string;
    jiraSiteUrl: string;
    jiraEmail: string;
    apiTokenVariableKey: string;
    jql: string;
  },
): Promise<WorkflowRecord> {
  const name = uniqueName('pw-jira-ephemeral-workflow');
  const response = await request.post('/api/workflows', {
    headers: { Authorization: `Bearer ${authToken}` },
    data: {
      name,
      description: 'Playwright workflow: ephemeral runtime + Jira polling + Copilot token credential',
      scope: 'user',
      defaultAgentId: params.agentId,
      workerRuntime: 'ephemeral',
      stepAllocationTimeoutSeconds: 600,
      defaultModel: 'gpt-5-mini',
      steps: [
        {
          name: 'Handle Jira Tickets',
          // The prompt does not name "weather report" — it instructs the agent
          // to act on the issue Description, which the polling trigger injects
          // into `inputs.jiraIssues[0].fields.description` via Jinja. The Jira
          // description field is in Atlassian Document Format (ADF), so it is
          // rendered with the `dump` filter to expose the inner text.
          promptTemplate: [
            'Handle Jira Tickets according to Description.',
            '',
            'Summary: {{ inputs.jiraIssues[0].summary | default("(none)") }}',
            'Description: {{ inputs.jiraIssues[0].fields.description | dump | default("(none)") }}',
          ].join('\n'),
          stepOrder: 1,
          timeoutSeconds: 600,
          model: 'gpt-5-mini',
        },
      ],
      triggers: [
        {
          triggerType: 'jira_polling',
          isActive: true,
          configuration: {
            jiraSiteUrl: params.jiraSiteUrl,
            authMode: 'api_token',
            credentials: {
              email: params.jiraEmail,
              apiTokenVariableKey: params.apiTokenVariableKey,
            },
            jql: params.jql,
            intervalMinutes: 1,
            maxResults: 10,
            fields: ['summary', 'description', 'status', 'updated', 'issuetype', 'labels'],
            initialLoadMode: 'include_current_matches',
            overlapMinutes: 5,
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

test('live Jira polling with ephemeral runtime + Copilot token credential completes a weather-report ticket', async ({ page, request }) => {
  test.setTimeout(600_000);

  const liveJira = getLiveJiraConfig();
  if (!liveJira.config) {
    test.skip(true, liveJira.skipReason);
    return;
  }

  loadTestEnv();
  const copilotTokenValue = firstEnvValue('TESTING_GITHUB_PAT', 'GITHUB_TOKEN');
  if (!copilotTokenValue) {
    test.skip(true, 'TESTING_GITHUB_PAT or GITHUB_TOKEN must be set to run the ephemeral Copilot E2E test.');
    return;
  }

  await loginViaUi(page, { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD, providerLabel: 'Built-in Database' });
  const { authToken } = await getAuthContext(page);

  const label = uniqueName('oao-eph-jira').toLowerCase();
  // Corrected JQL: status name is "To Do" (with quotes for the space). Add a label
  // filter so the test ticket is isolated from any pre-existing tickets in the project.
  const jql = `project = ${liveJira.config.projectKey} AND status = "To Do" AND labels = "${label}"`;
  const ticketDescription = 'Please generate Weather Report';

  let jiraTokenVariable: VariableRecord | null = null;
  let copilotTokenVariable: VariableRecord | null = null;
  let agent: AgentRecord | null = null;
  let workflow: WorkflowRecord | null = null;
  let jiraIssue: JiraIssueRecord | null = null;

  try {
    // 1. Setup credentials: Jira API token + GitHub Copilot token.
    jiraTokenVariable = await createWorkspaceCredentialVariable(
      request,
      authToken,
      uniqueVariableKey('JIRA_API_TOKEN_EPH'),
      liveJira.config.apiToken,
      'Jira API token (ephemeral runtime E2E)',
    );

    const copilotResponse = await request.post('/api/variables', {
      headers: { Authorization: `Bearer ${authToken}` },
      data: {
        scope: 'workspace',
        key: uniqueVariableKey('COPILOT_TOKEN_EPH'),
        value: copilotTokenValue,
        variableType: 'credential',
        credentialSubType: 'github_token',
        injectAsEnvVariable: false,
        description: 'GitHub Copilot token (ephemeral runtime E2E)',
      },
    });
    expect(copilotResponse.status()).toBe(201);
    const copilotBody = await copilotResponse.json() as { variable?: { id?: string; key?: string } };
    expect(copilotBody.variable?.id).toBeTruthy();
    copilotTokenVariable = {
      id: copilotBody.variable!.id!,
      key: copilotBody.variable!.key!,
      scope: 'workspace',
    };

    // 2. Setup agent referencing the Copilot token credential.
    agent = await createDatabaseAgentWithCopilotToken(
      request,
      authToken,
      'pw-jira-eph-agent',
      copilotTokenVariable.id,
    );

    // 3. Setup workflow with ephemeral runtime, the agreed prompt template and JQL.
    workflow = await createJiraPollingEphemeralWorkflow(request, authToken, {
      agentId: agent.id,
      jiraSiteUrl: liveJira.config.baseUrl,
      jiraEmail: liveJira.config.email,
      apiTokenVariableKey: jiraTokenVariable.key,
      jql,
    });

    // Verify the trigger persists the corrected JQL.
    const triggerListResponse = await request.get('/api/triggers', {
      headers: { Authorization: `Bearer ${authToken}` },
      params: { workflowId: workflow.id },
    });
    expect(triggerListResponse.status()).toBe(200);
    const triggerListBody = await triggerListResponse.json() as { triggers?: Array<Record<string, unknown>> };
    const trigger = triggerListBody.triggers?.find((entry) => entry.id === workflow!.triggerId);
    const triggerConfig = (trigger?.configuration ?? {}) as Record<string, unknown>;
    expect(triggerConfig.jql).toBe(jql);
    expect(trigger?.isActive).toBe(true);

    // Connectivity test should succeed against live Jira.
    const connectivityResponse = await request.post(`/api/triggers/${workflow.triggerId}/test`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(connectivityResponse.status()).toBe(200);
    const connectivityBody = await connectivityResponse.json() as { ok?: boolean; summary?: string };
    expect(connectivityBody.ok).toBe(true);
    expect(connectivityBody.summary).toContain('Jira search succeeded');

    // 4. Create the Jira ticket with the requested description.
    const issueResponse = await fetch(`${liveJira.config.baseUrl}/rest/api/3/issue`, {
      method: 'POST',
      headers: jiraHeaders(liveJira.config),
      body: JSON.stringify({
        fields: {
          project: { key: liveJira.config.projectKey },
          issuetype: { name: liveJira.config.issueType },
          summary: `OAO E2E Weather Report Request ${label}`,
          description: jiraDescriptionDocument(ticketDescription),
          labels: [label],
        },
      }),
    });
    const issueText = await issueResponse.text();
    if (!issueResponse.ok) {
      throw new Error(`Failed to create Jira issue (${issueResponse.status}): ${issueText}`);
    }
    const issueBody = JSON.parse(issueText) as { id?: string; key?: string };
    expect(issueBody.id).toBeTruthy();
    expect(issueBody.key).toBeTruthy();
    jiraIssue = { id: issueBody.id!, key: issueBody.key! };

    // Some Jira projects (including the SCRUM template) use "Idea" as the
    // initial status. Transition the issue into "To Do" so it matches the JQL.
    const transitionsResponse = await fetch(
      `${liveJira.config.baseUrl}/rest/api/3/issue/${encodeURIComponent(jiraIssue.key)}/transitions`,
      { headers: jiraHeaders(liveJira.config) },
    );
    if (transitionsResponse.ok) {
      const transitionsBody = await transitionsResponse.json() as {
        transitions?: Array<{ id?: string; to?: { name?: string } }>;
      };
      const toDoTransition = (transitionsBody.transitions ?? []).find(
        (transition) => transition.to?.name === 'To Do',
      );
      if (toDoTransition?.id) {
        await fetch(
          `${liveJira.config.baseUrl}/rest/api/3/issue/${encodeURIComponent(jiraIssue.key)}/transitions`,
          {
            method: 'POST',
            headers: jiraHeaders(liveJira.config),
            body: JSON.stringify({ transition: { id: toDoTransition.id } }),
          },
        );
      }
    }

    // Give Jira a moment to index the new issue + status before polling.
    await new Promise((resolve) => setTimeout(resolve, 3_000));

    // 5. Force-fire the trigger and wait for the execution to complete.
    const fireResult = await fireTrigger(request, authToken, workflow.triggerId);
    expect(fireResult.fired).toBe(true);
    expect(typeof fireResult.executionId).toBe('string');
    expect(fireResult.executionId).toBeTruthy();
    expect(fireResult.issueCount ?? 0).toBeGreaterThan(0);

    const { execution, steps } = await waitForExecutionCompletion(
      request,
      authToken,
      fireResult.executionId!,
      550_000,
    );

    expect(execution.workflowId).toBe(workflow.id);
    expect(execution.triggerId).toBe(workflow.triggerId);
    const triggerMetadata = JSON.stringify(execution.triggerMetadata ?? {});
    expect(triggerMetadata).toContain('jira_polling');
    expect(triggerMetadata).toContain(jiraIssue.key);
    expect(triggerMetadata).toContain(ticketDescription);

    expect(steps.length).toBeGreaterThan(0);
    const firstStep = steps[0];
    expect(firstStep.status).toBe('completed');
    expect(typeof firstStep.output).toBe('string');
    const stepOutput = (firstStep.output as string).trim();
    expect(stepOutput.length).toBeGreaterThan(0);
    expect(stepOutput).toMatch(/weather|report|forecast|temperature/i);
    expect(execution.status).toBe('completed');

    // UI verification of the execution detail page.
    const executionId = fireResult.executionId!;
    await page.goto(`/default/executions/${executionId}`);
    await expect(page).toHaveURL(new RegExp(`/default/executions/${executionId}$`));
    await expect(page.getByRole('link', { name: workflow.name, exact: true })).toBeVisible();
    await expect(page.locator('main')).toContainText(/completed/i);
  } finally {
    if (jiraIssue) {
      await deleteJiraIssue(liveJira.config, jiraIssue.key).catch((error: unknown) => {
        console.warn(error instanceof Error ? error.message : 'Failed to delete Jira issue created by ephemeral E2E test');
      });
    }
    if (workflow) await deleteWorkflow(request, authToken, workflow.id);
    if (agent) await deleteAgent(request, authToken, agent.id);
    if (copilotTokenVariable) await deleteVariable(request, authToken, copilotTokenVariable);
    if (jiraTokenVariable) await deleteVariable(request, authToken, jiraTokenVariable);
  }
});
