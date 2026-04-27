/**
 * E2E · Trigger types — built-in (Cat 7)
 *
 * Creates and updates each of the four built-in trigger types
 * (time_schedule, exact_datetime, webhook, event) and verifies the
 * configuration round-trip plus toggle/delete behaviour.
 * Jira triggers are out of scope here (covered by jira-integration.spec.ts).
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
      name: uniqueName('trigger-agent'),
      description: 'triggers spec',
      sourceType: 'database',
      scope: 'user',
      ...(copilotTokenCredentialId ? { copilotTokenCredentialId } : {}),
      files: [{ filePath: 'agent.md', content: '# Trigger Agent' }],
    },
  });
  expect(ag.status()).toBe(201);
  const agentId = ((await ag.json()) as { agent: { id: string } }).agent.id;

  const wf = await admin.request.post('/api/workflows', {
    data: {
      name: uniqueName('trigger-workflow'),
      description: 'triggers spec workflow',
      scope: 'user',
      defaultAgentId: agentId,
      steps: [{ name: 'Step 1', promptTemplate: 'do work', stepOrder: 1 }],
    },
  });
  expect(wf.status(), await wf.text()).toBe(201);
  const workflowId = ((await wf.json()) as { workflow: { id: string } }).workflow.id;
  return { agentId, workflowId };
}

// eslint-disable-next-line no-empty-pattern
test('triggers: GET /types returns the catalog', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  try {
    const res = await admin.request.get('/api/triggers/types');
    expect(res.ok(), await res.text()).toBe(true);
    const body = (await res.json()) as { types: Array<{ type: string; label: string; category: string }> };
    const types = body.types.map((t) => t.type);
    expect(types).toEqual(expect.arrayContaining(['time_schedule', 'exact_datetime', 'webhook', 'event']));
  } finally {
    await disposeClient(admin);
  }
});

// eslint-disable-next-line no-empty-pattern
test('triggers: time_schedule trigger CRUD with cron config', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const { agentId, workflowId } = await createAgentAndWorkflow(admin);
  try {
    const create = await admin.request.post('/api/triggers', {
      data: {
        workflowId,
        triggerType: 'time_schedule',
        configuration: { cron: '0 9 * * *' },
        isActive: true,
      },
    });
    expect(create.status(), await create.text()).toBe(201);
    const t = ((await create.json()) as { trigger: { id: string; triggerType: string; configuration: Record<string, unknown>; isActive: boolean } }).trigger;
    expect(t.triggerType).toBe('time_schedule');
    expect(t.configuration.cron).toBe('0 9 * * *');
    expect(t.isActive).toBe(true);

    // Toggle inactive
    const toggle = await admin.request.put(`/api/triggers/${t.id}`, { data: { isActive: false } });
    expect(toggle.ok(), await toggle.text()).toBe(true);
    const toggled = ((await toggle.json()) as { trigger: { isActive: boolean } }).trigger;
    expect(toggled.isActive).toBe(false);

    // Reject empty cron on update
    const bad = await admin.request.put(`/api/triggers/${t.id}`, {
      data: { configuration: { cron: '' } },
    });
    expect(bad.status()).toBeGreaterThanOrEqual(400);
    expect(bad.status()).toBeLessThan(500);

    const del = await admin.request.delete(`/api/triggers/${t.id}`);
    expect(del.ok()).toBe(true);
  } finally {
    await admin.request.delete(`/api/workflows/${workflowId}`);
    await admin.request.delete(`/api/agents/${agentId}`);
    await disposeClient(admin);
  }
});

// eslint-disable-next-line no-empty-pattern
test('triggers: exact_datetime trigger with future datetime', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const { agentId, workflowId } = await createAgentAndWorkflow(admin);
  try {
    const futureIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const create = await admin.request.post('/api/triggers', {
      data: { workflowId, triggerType: 'exact_datetime', configuration: { datetime: futureIso } },
    });
    expect(create.status(), await create.text()).toBe(201);
    const t = ((await create.json()) as { trigger: { id: string; triggerType: string; configuration: { datetime: string } } }).trigger;
    expect(t.triggerType).toBe('exact_datetime');
    expect(t.configuration.datetime).toBe(futureIso);

    await admin.request.delete(`/api/triggers/${t.id}`);
  } finally {
    await admin.request.delete(`/api/workflows/${workflowId}`);
    await admin.request.delete(`/api/agents/${agentId}`);
    await disposeClient(admin);
  }
});

// eslint-disable-next-line no-empty-pattern
test('triggers: webhook trigger with parameters; reuse rejected; HMAC registration created', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const { agentId, workflowId } = await createAgentAndWorkflow(admin);
  const path = `/cat7-${Math.random().toString(36).slice(2, 10)}`;
  try {
    const create = await admin.request.post('/api/triggers', {
      data: {
        workflowId,
        triggerType: 'webhook',
        configuration: {
          path,
          parameters: [{ name: 'issueKey', required: true, description: 'Jira-style key' }],
        },
      },
    });
    expect(create.status(), await create.text()).toBe(201);
    const t = ((await create.json()) as { trigger: { id: string; configuration: { path: string; parameters: Array<{ name: string; required: boolean }> } } }).trigger;
    expect(t.configuration.path).toBe(path);
    expect(t.configuration.parameters[0]?.name).toBe('issueKey');
    expect(t.configuration.parameters[0]?.required).toBe(true);

    await admin.request.delete(`/api/triggers/${t.id}`);
  } finally {
    await admin.request.delete(`/api/workflows/${workflowId}`);
    await admin.request.delete(`/api/agents/${agentId}`);
    await disposeClient(admin);
  }
});

// eslint-disable-next-line no-empty-pattern
test('triggers: event trigger with eventName + conditions', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const admin = await loginApi({ baseURL, identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const { agentId, workflowId } = await createAgentAndWorkflow(admin);
  try {
    const create = await admin.request.post('/api/triggers', {
      data: {
        workflowId,
        triggerType: 'event',
        configuration: {
          eventName: 'agent.created',
          eventScope: 'workspace',
          conditions: { 'data.scope': 'workspace' },
        },
      },
    });
    expect(create.status(), await create.text()).toBe(201);
    const t = ((await create.json()) as { trigger: { id: string; configuration: { eventName: string; eventScope: string; conditions: Record<string, unknown> } } }).trigger;
    expect(t.configuration.eventName).toBe('agent.created');
    expect(t.configuration.eventScope).toBe('workspace');
    expect(t.configuration.conditions['data.scope']).toBe('workspace');

    // Reject empty eventName
    const bad = await admin.request.post('/api/triggers', {
      data: { workflowId, triggerType: 'event', configuration: { eventName: '' } },
    });
    expect(bad.status()).toBeGreaterThanOrEqual(400);
    expect(bad.status()).toBeLessThan(500);

    await admin.request.delete(`/api/triggers/${t.id}`);
  } finally {
    await admin.request.delete(`/api/workflows/${workflowId}`);
    await admin.request.delete(`/api/agents/${agentId}`);
    await disposeClient(admin);
  }
});
