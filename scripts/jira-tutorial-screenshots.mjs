// scripts/jira-tutorial-screenshots.mjs
// Generate the missing screenshots referenced by docs/guide/jira-integration.md.
// Creates demo entities via the OAO API (admin/superadmin token), drives the UI
// to each form/detail page, captures a PNG, then deletes the demo entities.
//
// Usage:
//   OAO_PASSWORD=<superadmin-password> node scripts/jira-tutorial-screenshots.mjs [base-url]
//
// Captures (under docs/public/screenshots/):
//   - jira-tutorial-agent-edit.png      — agent editor with Copilot token bound
//   - jira-tutorial-workflow-edit.png   — workflow editor with ephemeral runtime
//   - jira-tutorial-execution-detail.png — completed execution detail page
//
// The pre-existing screenshots `copilot-token-variable.png`,
// `jira-tutorial-variable.png`, and `jira-tutorial-workflow-trigger.png` are
// preserved if present.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'docs', 'public', 'screenshots');

const BASE_URL = process.argv[2] || 'http://oao.local';
const EMAIL = process.env.OAO_EMAIL || 'admin@oao.local';
const PASSWORD = process.env.OAO_PASSWORD || 'AdminPass123!';
const WORKSPACE = process.env.OAO_WORKSPACE || 'default';

if (!PASSWORD) {
  console.error('Error: OAO_PASSWORD env var is required.');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

const suffix = `${Date.now().toString(36)}`;
const KEYS = {
  copilotVar: `TUTORIAL_COPILOT_TOKEN_${suffix}`.toUpperCase(),
  jiraVar: `TUTORIAL_JIRA_API_TOKEN_${suffix}`.toUpperCase(),
  agent: `Jira Weather Agent (Tutorial ${suffix})`,
  workflow: `Jira Weather Report (Tutorial ${suffix})`,
};

const cleanup = { agentId: null, workflowId: null, copilotVarId: null, jiraVarId: null, executionId: null };

async function api(token, method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function loginAndGetToken(page) {
  await page.context().clearCookies();
  await page.goto(`${BASE_URL}/${WORKSPACE}/login`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  // Switch to Email & Password provider if a provider switch is shown.
  const providerBtn = page.getByRole('button', { name: 'Email & Password', exact: true }).first();
  if (await providerBtn.count()) {
    const label = await page.locator('label[for="identifier"]').first().textContent().catch(() => '');
    if ((label || '').trim() !== 'Email') {
      await providerBtn.click().catch(() => {});
      await page.waitForTimeout(200);
    }
  }

  await page.locator('input[name="identifier"], input[type="email"]').first().fill(EMAIL);
  await page.locator('input[name="password"], input[type="password"]').first().fill(PASSWORD);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/login') && r.request().method() === 'POST', { timeout: 15000 }).catch(() => null),
    page.getByRole('button', { name: /Sign In/i }).click(),
  ]);
  // Wait for the cookie to be set rather than a specific URL.
  for (let i = 0; i < 30; i++) {
    const cookies = await page.context().cookies();
    if (cookies.find((c) => c.name === 'token')) break;
    await page.waitForTimeout(500);
  }

  const cookies = await page.context().cookies();
  const token = cookies.find((c) => c.name === 'token')?.value;
  if (!token) throw new Error('Login succeeded but no token cookie was set.');
  return token;
}

async function createCopilotVar(token) {
  const v = await api(token, 'POST', '/api/variables', {
    scope: 'workspace',
    key: KEYS.copilotVar,
    type: 'credential',
    credentialSubType: 'github_token',
    value: 'github_pat_TUTORIAL_PLACEHOLDER_TOKEN_DO_NOT_USE',
    isEnvVar: false,
    description: 'Tutorial Copilot token (placeholder)',
  });
  cleanup.copilotVarId = v?.variable?.id ?? v?.id;
  return cleanup.copilotVarId;
}

async function createJiraVar(token) {
  const v = await api(token, 'POST', '/api/variables', {
    scope: 'workspace',
    key: KEYS.jiraVar,
    type: 'credential',
    credentialSubType: 'secret_text',
    value: 'tutorial-jira-token-placeholder',
    isEnvVar: false,
    description: 'Tutorial Jira API token (placeholder)',
  });
  cleanup.jiraVarId = v?.variable?.id ?? v?.id;
  return cleanup.jiraVarId;
}

async function createAgent(token, copilotVarId) {
  const a = await api(token, 'POST', '/api/agents', {
    name: KEYS.agent,
    sourceType: 'database',
    description: 'Tutorial agent — handles Jira tickets requesting a weather report.',
    copilotTokenCredentialId: copilotVarId,
    files: [
      {
        filePath: 'agent.md',
        content: [
          '# Jira Weather Agent',
          '',
          'You handle Jira issue payloads for operations workflows.',
          '',
          'When a ticket asks for a weather report:',
          '- Identify the location, dates, and missing details from the issue description.',
          '- Produce a concise weather report or action plan.',
          '- Never print credential values or API tokens.',
        ].join('\n'),
      },
    ],
  });
  cleanup.agentId = a?.agent?.id ?? a?.id;
  return cleanup.agentId;
}

async function createWorkflow(token, agentId, jiraVarKey) {
  const w = await api(token, 'POST', '/api/workflows', {
    name: KEYS.workflow,
    description: 'Tutorial workflow — Jira polling + ephemeral worker + Copilot.',
    defaultAgentId: agentId,
    workerRuntime: 'ephemeral',
    stepAllocationTimeoutSeconds: 600,
    defaultModel: 'gpt-5-mini',
    steps: [
      {
        name: 'Handle Jira Description',
        stepOrder: 1,
        agentId,
        model: 'gpt-5-mini',
        promptTemplate: [
          'Handle Jira Tickets according to Description.',
          '',
          'Summary: {{ inputs.jiraIssues[0].summary | default("(none)") }}',
          'Description: {{ inputs.jiraIssues[0].fields.description | dump | default("(none)") }}',
        ].join('\n'),
      },
    ],
    triggers: [
      {
        triggerType: 'jira_polling',
        isActive: false,
        configuration: {
          jiraSiteUrl: 'https://your-domain.atlassian.net',
          authMode: 'api_token',
          credentials: {
            email: 'jira-bot@example.com',
            apiTokenVariableKey: jiraVarKey,
          },
          jql: 'project = SCRUM AND status = "To Do" ORDER BY updated DESC',
          intervalMinutes: 1,
          maxResults: 25,
          overlapMinutes: 5,
          initialLoadMode: 'from_now',
          fields: ['summary', 'description', 'status', 'updated', 'labels'],
        },
      },
    ],
  });
  cleanup.workflowId = w?.workflow?.id ?? w?.id;
  return cleanup.workflowId;
}

async function findRecentExecutionId(token) {
  // Try to find any recent execution (any workflow) so the tutorial can show
  // the execution detail layout. Returns null if none exists.
  try {
    const list = await api(token, 'GET', '/api/executions?page=1&limit=1');
    return list?.executions?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function safeShot(page, name) {
  try {
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(OUT_DIR, name), fullPage: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

async function main() {
  console.log(`Generating Jira tutorial screenshots against ${BASE_URL}\n  output: ${OUT_DIR}\n`);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  });
  const page = await context.newPage();

  let token;
  try {
    token = await loginAndGetToken(page);
    console.log('  ✓ logged in');

    // Provision demo entities via API.
    const copilotVarId = await createCopilotVar(token);
    console.log('  ✓ created Copilot token variable');
    const jiraVarId = await createJiraVar(token);
    console.log('  ✓ created Jira API token variable');
    const agentId = await createAgent(token, copilotVarId);
    console.log('  ✓ created agent');
    const workflowId = await createWorkflow(token, agentId, KEYS.jiraVar);
    console.log('  ✓ created workflow + trigger');

    // Agent edit page — click "Edit" so the form (with Copilot token dropdown) is visible.
    await page.goto(`${BASE_URL}/${WORKSPACE}/agents/${agentId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const editAgentBtn = page.getByRole('button', { name: /^Edit$/ }).first();
    if (await editAgentBtn.count()) {
      await editAgentBtn.click();
      await page.waitForTimeout(800);
    }
    await safeShot(page, 'jira-tutorial-agent-edit.png');

    // Workflow edit page — click "Edit" if present.
    await page.goto(`${BASE_URL}/${WORKSPACE}/workflows/${workflowId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const editWorkflowBtn = page.getByRole('button', { name: /^Edit$/ }).first();
    if (await editWorkflowBtn.count()) {
      await editWorkflowBtn.click();
      await page.waitForTimeout(800);
    }
    await safeShot(page, 'jira-tutorial-workflow-edit.png');

    // Execution detail (best-effort: any recent execution; fall back gracefully).
    const executionId = await findRecentExecutionId(token);
    if (executionId) {
      await page.goto(`${BASE_URL}/${WORKSPACE}/executions/${executionId}`, { waitUntil: 'networkidle' });
      await safeShot(page, 'jira-tutorial-execution-detail.png');
    } else {
      console.log('  · no recent execution found, skipping execution-detail screenshot');
    }
  } catch (err) {
    console.error('Screenshot run failed:', err.message);
    process.exitCode = 1;
  } finally {
    // Cleanup — best-effort, never throws.
    if (token) {
      const tries = [
        cleanup.workflowId && ['DELETE', `/api/workflows/${cleanup.workflowId}`],
        cleanup.agentId && ['DELETE', `/api/agents/${cleanup.agentId}`],
        cleanup.jiraVarId && ['DELETE', `/api/variables/${cleanup.jiraVarId}?scope=workspace`],
        cleanup.copilotVarId && ['DELETE', `/api/variables/${cleanup.copilotVarId}?scope=workspace`],
      ].filter(Boolean);
      for (const [method, path] of tries) {
        try {
          await api(token, method, path);
        } catch (err) {
          console.error(`  · cleanup ${method} ${path} failed: ${err.message}`);
        }
      }
    }
    await browser.close();
  }
}

main();
