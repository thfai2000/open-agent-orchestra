/**
 * E2E · Jira trigger schema validation gap-fill (Cat 8)
 *
 * The bulk of Jira coverage lives in `jira-integration.spec.ts`, which
 * exercises live polling + webhook simulations. This spec fills the gap
 * around pure schema validation of the two Jira trigger configurations
 * — failures here surface contract regressions immediately without
 * requiring a live Jira tenant.
 */

import { test, expect } from './helpers/fixtures';
import { resetSuperAdminPassword, uniqueName } from './helpers/cluster';
import { ensureWorkspaceCopilotTokenVariable } from './helpers/copilot-token';
import { loginApi, disposeClient } from './helpers/api-auth';

const ADMIN_EMAIL = 'admin@oao.local';
const ADMIN_PASSWORD = 'AdminPass123!';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await resetSuperAdminPassword(ADMIN_PASSWORD);
});

async function createAgentAndWorkflow(admin: Awaited<ReturnType<typeof loginApi>>) {
  const copilotTokenCredentialId = await ensureWorkspaceCopilotTokenVariable(admin.request, admin.token);
  const ag = await admin.request.post('/api/agents', {
    data: {
      name: uniqueName('jira-gap-agent'),
      description: 'Jira gap-fill agent',
      sourceType: 'database',
      scope: 'user',
      ...(copilotTokenCredentialId ? { copilotTokenCredentialId } : {}),
      files: [{ filePath: 'agent.md', content: '# Jira Gap Agent' }],
    },
  });
  expect(ag.status()).toBe(201);
  const agentId = ((await ag.json()) as { agent: { id: string } }).agent.id;
  const wf = await admin.request.post('/api/workflows', {
    data: {
      name: uniqueName('jira-gap-workflow'),
      scope: 'user',
      defaultAgentId: agentId,
      steps: [{ name: 'step1', promptTemplate: 'work', stepOrder: 1 }],
    },
  });
  expect(wf.status()).toBe(201);
  const workflowId = ((await wf.json()) as { workflow: { id: string } }).workflow.id;
  return { agentId, workflowId };
}

// eslint-disable-next-line no-empty-pattern
test('jira trigger types appear in the catalog with category=Jira', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  try {
    const res = await admin.request.get('/api/triggers/types');
    const body = (await res.json()) as { types: Array<{ type: string; category: string }> };
    const polling = body.types.find((t) => t.type === 'jira_polling');
    const notification = body.types.find((t) => t.type === 'jira_changes_notification');
    expect(polling?.category).toBe('Jira');
    expect(notification?.category).toBe('Jira');
  } finally {
    await disposeClient(admin);
  }
});

// eslint-disable-next-line no-empty-pattern
test('jira_polling rejects http:// site URL (https required)', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const { agentId, workflowId } = await createAgentAndWorkflow(admin);
  try {
    const res = await admin.request.post('/api/triggers', {
      data: {
        workflowId,
        triggerType: 'jira_polling',
        configuration: {
          jiraSiteUrl: 'http://insecure.atlassian.net',
          authMode: 'api_token',
          credentials: { email: 'me@example.com', apiTokenVariableKey: 'JIRA_TOKEN' },
          jql: 'project = ABC',
        },
      },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
    const body = await res.text();
    expect(body.toLowerCase()).toContain('https');
  } finally {
    await admin.request.delete(`/api/workflows/${workflowId}`);
    await admin.request.delete(`/api/agents/${agentId}`);
    await disposeClient(admin);
  }
});

// eslint-disable-next-line no-empty-pattern
test('jira_polling api_token mode requires apiTokenVariableKey + email', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const { agentId, workflowId } = await createAgentAndWorkflow(admin);
  try {
    // Missing apiTokenVariableKey — partial credentials.
    const partial = await admin.request.post('/api/triggers', {
      data: {
        workflowId,
        triggerType: 'jira_polling',
        configuration: {
          jiraSiteUrl: 'https://my-tenant.atlassian.net',
          authMode: 'api_token',
          credentials: { email: 'me@example.com' },
          jql: 'project = ABC',
        },
      },
    });
    expect(partial.status()).toBeGreaterThanOrEqual(400);
    expect(partial.status()).toBeLessThan(500);
  } finally {
    await admin.request.delete(`/api/workflows/${workflowId}`);
    await admin.request.delete(`/api/agents/${agentId}`);
    await disposeClient(admin);
  }
});

// eslint-disable-next-line no-empty-pattern
test('jira_polling round-trips a valid api_token configuration with default fields', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const { agentId, workflowId } = await createAgentAndWorkflow(admin);
  try {
    const res = await admin.request.post('/api/triggers', {
      data: {
        workflowId,
        triggerType: 'jira_polling',
        configuration: {
          jiraSiteUrl: 'https://my-tenant.atlassian.net',
          authMode: 'api_token',
          credentials: { email: 'me@example.com', apiTokenVariableKey: 'JIRA_TOKEN' },
          jql: 'project = OAO ORDER BY updated DESC',
          intervalMinutes: 30,
          maxResults: 25,
          fields: ['summary', 'status'],
          initialLoadMode: 'from_now',
          overlapMinutes: 10,
        },
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const trigger = ((await res.json()) as { trigger: { id: string; configuration: { jiraSiteUrl: string; intervalMinutes: number; fields: string[] } } }).trigger;
    expect(trigger.configuration.jiraSiteUrl).toBe('https://my-tenant.atlassian.net');
    expect(trigger.configuration.intervalMinutes).toBe(30);
    // Default polling fields are merged into whatever the caller provides.
    expect(trigger.configuration.fields).toEqual(expect.arrayContaining(['summary', 'status', 'updated', 'assignee']));

    await admin.request.delete(`/api/triggers/${trigger.id}`);
  } finally {
    await admin.request.delete(`/api/workflows/${workflowId}`);
    await admin.request.delete(`/api/agents/${agentId}`);
    await disposeClient(admin);
  }
});

// eslint-disable-next-line no-empty-pattern
test('jira_changes_notification rejects partial OAuth refresh credentials', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const { agentId, workflowId } = await createAgentAndWorkflow(admin);
  try {
    // Provides refreshTokenVariableKey but omits clientId/clientSecret — must fail.
    const res = await admin.request.post('/api/triggers', {
      data: {
        workflowId,
        triggerType: 'jira_changes_notification',
        configuration: {
          jiraSiteUrl: 'https://my-tenant.atlassian.net',
          authMode: 'oauth2',
          credentials: {
            accessTokenVariableKey: 'JIRA_ACCESS_TOKEN',
            refreshTokenVariableKey: 'JIRA_REFRESH_TOKEN',
          },
          jql: 'project = ABC',
        },
      },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  } finally {
    await admin.request.delete(`/api/workflows/${workflowId}`);
    await admin.request.delete(`/api/agents/${agentId}`);
    await disposeClient(admin);
  }
});
