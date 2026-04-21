import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { createLogger, decrypt, encrypt } from '@oao/shared';
import { db } from '../database/index.js';
import { triggers, workflows, workspaceVariables, userVariables } from '../database/schema.js';
import { enqueueWorkflowExecution } from './workflow-engine.js';
import { safeParseTriggerConfiguration } from './trigger-definitions.js';
import { TriggerServiceError } from './trigger-errors.js';

type WorkflowRecord = typeof workflows.$inferSelect;
type TriggerRecord = typeof triggers.$inferSelect;

interface JiraRuntimeState extends Record<string, unknown> {
  callbackTokenEncrypted?: string;
  cloudId?: string;
  webhookRegistrationIds?: number[];
  webhookExpirationDate?: string | null;
  lastWebhookSyncAt?: string | null;
  registrationStatus?: string;
  lastError?: string | null;
  lastErrorAt?: string | null;
  oauthSession?: {
    accessTokenEncrypted?: string;
    refreshTokenEncrypted?: string;
    accessTokenExpiresAt?: string | null;
  };
  lastPolledAt?: string | null;
  lastSuccessfulPollAt?: string | null;
  recentIssueMap?: Record<string, string>;
}

interface JiraIssueSummary {
  id: string;
  key: string;
  summary: string;
  status: string | null;
  assignee: string | null;
  updated: string | null;
  url: string | null;
  fields: Record<string, unknown>;
}

interface JiraRequestInit {
  method?: string;
  body?: unknown;
  headers?: HeadersInit;
}

const logger = createLogger('jira-integration');
const JIRA_TOKEN_ENDPOINT = 'https://auth.atlassian.com/oauth/token';
const JIRA_ACCESSIBLE_RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources';
const JIRA_WEBHOOK_REFRESH_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;
const JIRA_WEBHOOK_SYNC_BACKOFF_MS = 30 * 60 * 1000;
const JIRA_POLLING_STATE_LIMIT = 200;
const JIRA_POLLING_MAX_TOTAL_RESULTS = 500;

function asRecord(value: unknown) {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asNumberArray(value: unknown) {
  return Array.isArray(value)
    ? value
      .map((entry) => typeof entry === 'number' ? entry : Number(entry))
      .filter((entry) => Number.isFinite(entry))
    : [];
}

function cloneRuntimeState(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {})) as JiraRuntimeState;
}

function runtimeStateChanged(left: unknown, right: unknown) {
  return JSON.stringify(left ?? {}) !== JSON.stringify(right ?? {});
}

function setRuntimeError(state: JiraRuntimeState, message: string) {
  state.lastError = message;
  state.lastErrorAt = new Date().toISOString();
  if (!state.registrationStatus && state.webhookRegistrationIds?.length) {
    state.registrationStatus = 'error';
  }
}

function clearRuntimeError(state: JiraRuntimeState) {
  state.lastError = null;
  state.lastErrorAt = null;
}

function normalizeSiteUrl(value: string) {
  return value.replace(/\/+$/, '');
}

function buildBasicAuthHeader(email: string, apiToken: string) {
  return `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
}

function hasOAuthRefreshCredentials(credentials: Record<string, unknown>) {
  return Boolean(
    asString(credentials.refreshTokenVariableKey)
    && asString(credentials.clientIdVariableKey)
    && asString(credentials.clientSecretVariableKey),
  );
}

function buildTriggerCallbackUrl(triggerId: string, callbackToken: string) {
  const baseUrl = process.env.PUBLIC_API_BASE_URL?.trim();
  if (!baseUrl) {
    throw new TriggerServiceError(
      'PUBLIC_API_BASE_URL is required to host Jira change-notification callbacks',
      400,
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new TriggerServiceError('PUBLIC_API_BASE_URL must be a valid absolute URL', 400);
  }

  const normalizedBaseUrl = normalizeSiteUrl(parsedUrl.toString());
  return `${normalizedBaseUrl}/api/jira-webhooks/${triggerId}?token=${encodeURIComponent(callbackToken)}`;
}

function getCallbackToken(state: JiraRuntimeState) {
  if (state.callbackTokenEncrypted) {
    return decrypt(state.callbackTokenEncrypted);
  }

  const callbackToken = randomBytes(24).toString('hex');
  state.callbackTokenEncrypted = encrypt(callbackToken);
  return callbackToken;
}

async function loadWorkflowSecretMap(workflow: WorkflowRecord) {
  const [workspaceSecrets, userSecrets] = await Promise.all([
    workflow.workspaceId
      ? db.query.workspaceVariables.findMany({ where: eq(workspaceVariables.workspaceId, workflow.workspaceId) })
      : Promise.resolve([]),
    db.query.userVariables.findMany({ where: eq(userVariables.userId, workflow.userId) }),
  ]);

  const secretMap = new Map<string, string>();
  for (const variable of workspaceSecrets) {
    secretMap.set(variable.key, decrypt(variable.valueEncrypted));
  }
  for (const variable of userSecrets) {
    secretMap.set(variable.key, decrypt(variable.valueEncrypted));
  }

  return secretMap;
}

function getSecretValue(secretMap: Map<string, string>, key: string, label: string) {
  const value = secretMap.get(key);
  if (!value) {
    throw new TriggerServiceError(`Missing Jira credential reference for ${label}: ${key}`, 400);
  }
  return value;
}

async function refreshOAuthAccessToken(
  secretMap: Map<string, string>,
  credentials: Record<string, unknown>,
  state: JiraRuntimeState,
) {
  if (!hasOAuthRefreshCredentials(credentials)) {
    throw new TriggerServiceError(
      'Jira OAuth token refresh requires refreshTokenVariableKey, clientIdVariableKey, and clientSecretVariableKey',
      400,
    );
  }

  const refreshToken = state.oauthSession?.refreshTokenEncrypted
    ? decrypt(state.oauthSession.refreshTokenEncrypted)
    : getSecretValue(secretMap, asString(credentials.refreshTokenVariableKey)!, 'refresh token');

  const clientId = getSecretValue(secretMap, asString(credentials.clientIdVariableKey)!, 'client id');
  const clientSecret = getSecretValue(secretMap, asString(credentials.clientSecretVariableKey)!, 'client secret');

  const response = await fetch(JIRA_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new TriggerServiceError(
      `Failed to refresh Jira OAuth token (${response.status}): ${errorBody || response.statusText}`,
      response.status >= 500 ? 502 : 400,
    );
  }

  const payload = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!payload.access_token) {
    throw new TriggerServiceError('Jira OAuth refresh did not return an access token', 400);
  }

  state.oauthSession = {
    accessTokenEncrypted: encrypt(payload.access_token),
    refreshTokenEncrypted: encrypt(payload.refresh_token || refreshToken),
    accessTokenExpiresAt: payload.expires_in
      ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
      : null,
  };

  clearRuntimeError(state);
  return payload.access_token;
}

async function resolveOAuthAccessToken(
  secretMap: Map<string, string>,
  credentials: Record<string, unknown>,
  state: JiraRuntimeState,
) {
  const expiresAt = state.oauthSession?.accessTokenExpiresAt
    ? new Date(state.oauthSession.accessTokenExpiresAt)
    : null;

  if (state.oauthSession?.accessTokenEncrypted && (!expiresAt || expiresAt.getTime() > Date.now() + 60_000)) {
    return decrypt(state.oauthSession.accessTokenEncrypted);
  }

  if (hasOAuthRefreshCredentials(credentials)) {
    return refreshOAuthAccessToken(secretMap, credentials, state);
  }

  return getSecretValue(
    secretMap,
    asString(credentials.accessTokenVariableKey)!,
    'access token',
  );
}

async function resolveCloudId(
  siteUrl: string,
  accessToken: string,
  credentials: Record<string, unknown>,
  state: JiraRuntimeState,
) {
  if (asString(credentials.cloudId)) {
    state.cloudId = asString(credentials.cloudId)!;
    return state.cloudId;
  }

  if (state.cloudId) {
    return state.cloudId;
  }

  const response = await fetch(JIRA_ACCESSIBLE_RESOURCES_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new TriggerServiceError(
      `Failed to resolve Jira cloudId (${response.status}): ${errorBody || response.statusText}`,
      response.status >= 500 ? 502 : 400,
    );
  }

  const resources = await response.json() as Array<Record<string, unknown>>;
  const match = resources.find((resource) => normalizeSiteUrl(String(resource.url || '')) === siteUrl);
  if (!match?.id) {
    throw new TriggerServiceError(
      `The Jira OAuth token does not grant access to ${siteUrl}. Provide cloudId explicitly or re-authorize the app for that site.`,
      400,
    );
  }

  state.cloudId = String(match.id);
  return state.cloudId;
}

async function buildJiraRequestContext(
  workflow: WorkflowRecord,
  configuration: Record<string, unknown>,
  state: JiraRuntimeState,
  forceRefresh = false,
) {
  const secretMap = await loadWorkflowSecretMap(workflow);
  const authMode = asString(configuration.authMode) || 'api_token';
  const siteUrl = normalizeSiteUrl(asString(configuration.jiraSiteUrl) || '');
  const credentials = asRecord(configuration.credentials);

  if (!siteUrl) {
    throw new TriggerServiceError('Jira site URL is required', 400);
  }

  if (authMode === 'api_token') {
    const email = asString(credentials.email);
    const apiTokenVariableKey = asString(credentials.apiTokenVariableKey);
    if (!email || !apiTokenVariableKey) {
      throw new TriggerServiceError('Jira API token polling requires email and apiTokenVariableKey', 400);
    }

    const apiToken = getSecretValue(secretMap, apiTokenVariableKey, 'API token');
    return {
      requestUrl: (path: string) => `${siteUrl}${path}`,
      headers: {
        Authorization: buildBasicAuthHeader(email, apiToken),
        Accept: 'application/json',
      },
      authMode,
    };
  }

  const accessToken = forceRefresh
    ? await refreshOAuthAccessToken(secretMap, credentials, state)
    : await resolveOAuthAccessToken(secretMap, credentials, state);
  const cloudId = await resolveCloudId(siteUrl, accessToken, credentials, state);

  return {
    requestUrl: (path: string) => `https://api.atlassian.com/ex/jira/${cloudId}${path}`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    authMode,
  };
}

async function requestJira(
  workflow: WorkflowRecord,
  configuration: Record<string, unknown>,
  state: JiraRuntimeState,
  path: string,
  init: JiraRequestInit = {},
) {
  const performRequest = async (forceRefresh = false) => {
    const context = await buildJiraRequestContext(workflow, configuration, state, forceRefresh);
    const headers = new Headers(context.headers);
    if (init.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }
    if (init.headers) {
      const additionalHeaders = new Headers(init.headers);
      additionalHeaders.forEach((value, key) => headers.set(key, value));
    }

    const response = await fetch(context.requestUrl(path), {
      method: init.method || 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

    return { response, context };
  };

  const initialRequest = await performRequest(false);
  let response = initialRequest.response;
  const context = initialRequest.context;
  if (response.status === 401 && context.authMode === 'oauth2' && hasOAuthRefreshCredentials(asRecord(configuration.credentials))) {
    ({ response } = await performRequest(true));
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new TriggerServiceError(
      `Jira API request failed (${response.status}) for ${path}: ${errorBody || response.statusText}`,
      response.status >= 500 ? 502 : 400,
    );
  }

  if (response.status === 202 || response.status === 204) {
    return null;
  }

  const rawText = await response.text();
  if (!rawText.trim()) {
    return null;
  }

  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    return rawText;
  }
}

function normalizeJiraIssue(issue: Record<string, unknown>, siteUrl: string): JiraIssueSummary {
  const fields = asRecord(issue.fields);
  const status = asRecord(fields.status);
  const assignee = asRecord(fields.assignee);

  return {
    id: String(issue.id || ''),
    key: String(issue.key || ''),
    summary: typeof fields.summary === 'string' ? fields.summary : '',
    status: asString(status.name),
    assignee: asString(assignee.displayName),
    updated: asString(fields.updated),
    url: typeof issue.key === 'string' && issue.key
      ? `${siteUrl}/browse/${issue.key}`
      : null,
    fields,
  };
}

function trimRecentIssueMap(issueMap: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(issueMap)
      .sort((left, right) => right[1].localeCompare(left[1]))
      .slice(0, JIRA_POLLING_STATE_LIMIT),
  );
}

function stripOrderByClause(jql: string) {
  return jql.replace(/\border\s+by\b[\s\S]*$/i, '').trim();
}

async function persistTriggerRuntimeState(triggerId: string, runtimeState: JiraRuntimeState, updates: Partial<typeof triggers.$inferInsert> = {}) {
  await db.update(triggers)
    .set({
      runtimeState,
      updatedAt: new Date(),
      ...updates,
    })
    .where(eq(triggers.id, triggerId));
}

export function extractJiraIssuesFromPayload(siteUrl: string, payload: Record<string, unknown>) {
  const issues: JiraIssueSummary[] = [];
  const singleIssue = payload.issue;
  if (singleIssue && typeof singleIssue === 'object') {
    issues.push(normalizeJiraIssue(singleIssue as Record<string, unknown>, siteUrl));
  }

  if (Array.isArray(payload.issues)) {
    for (const issue of payload.issues) {
      if (issue && typeof issue === 'object') {
        issues.push(normalizeJiraIssue(issue as Record<string, unknown>, siteUrl));
      }
    }
  }

  return issues;
}

export function buildJiraWebhookInputs(trigger: TriggerRecord, payload: Record<string, unknown>) {
  const configuration = asRecord(trigger.configuration);
  const jiraSiteUrl = asString(configuration.jiraSiteUrl) || '';
  const jiraIssues = extractJiraIssuesFromPayload(jiraSiteUrl, payload);

  return {
    jiraSiteUrl,
    jiraJql: asString(configuration.jql) || '',
    jiraWebhookEvent: asString(payload.webhookEvent) || asString(payload.issue_event_type_name) || 'jira:webhook',
    jiraIssueKeys: jiraIssues.map((issue) => issue.key),
    jiraIssues,
    receivedAt: new Date().toISOString(),
  };
}

export async function registerJiraChangesNotificationTrigger(
  workflow: WorkflowRecord,
  trigger: TriggerRecord,
  configuration: Record<string, unknown>,
  runtimeStateInput: unknown,
) {
  const parsedConfiguration = safeParseTriggerConfiguration('jira_changes_notification', configuration);
  if (!parsedConfiguration.success) {
    throw new TriggerServiceError('Validation failed', 400, parsedConfiguration.error.issues);
  }

  const runtimeState = cloneRuntimeState(runtimeStateInput);
  const callbackToken = getCallbackToken(runtimeState);
  const parsedConfig = parsedConfiguration.data as Record<string, unknown>;
  const fieldIdsFilter = Array.isArray(parsedConfig.fieldIdsFilter)
    ? parsedConfig.fieldIdsFilter
    : [];
  const webhookRequest = {
    url: buildTriggerCallbackUrl(trigger.id, callbackToken),
    webhooks: [
      {
        events: parsedConfig.events,
        jqlFilter: parsedConfig.jql,
        ...(fieldIdsFilter.length > 0
          ? { fieldIdsFilter }
          : {}),
      },
    ],
  };

  const registrationResponse = await requestJira(
    workflow,
    parsedConfiguration.data as Record<string, unknown>,
    runtimeState,
    '/rest/api/3/webhook',
    {
      method: 'POST',
      body: webhookRequest,
    },
  ) as { webhookRegistrationResult?: Array<{ createdWebhookId?: number; errors?: string[] }> } | null;

  const firstResult = registrationResponse?.webhookRegistrationResult?.[0];
  if (!firstResult?.createdWebhookId) {
    throw new TriggerServiceError(
      firstResult?.errors?.join('; ') || 'Jira did not return a createdWebhookId for the requested webhook',
      400,
    );
  }

  const webhookId = Number(firstResult.createdWebhookId);
  runtimeState.webhookRegistrationIds = [webhookId];
  runtimeState.registrationStatus = 'registered';
  runtimeState.lastWebhookSyncAt = new Date().toISOString();
  clearRuntimeError(runtimeState);

  try {
    const refreshResponse = await requestJira(
      workflow,
      parsedConfiguration.data as Record<string, unknown>,
      runtimeState,
      '/rest/api/3/webhook/refresh',
      {
        method: 'PUT',
        body: { webhookIds: [webhookId] },
      },
    ) as { expirationDate?: string } | null;
    runtimeState.webhookExpirationDate = refreshResponse?.expirationDate || null;
  } catch (error) {
    logger.warn({ triggerId: trigger.id, error }, 'Failed to refresh Jira webhook lifetime immediately after registration');
  }

  return runtimeState;
}

export async function cleanupSpecificJiraWebhookIds(
  workflow: WorkflowRecord,
  configuration: Record<string, unknown>,
  runtimeStateInput: unknown,
  webhookIds: number[],
) {
  if (webhookIds.length === 0) {
    return cloneRuntimeState(runtimeStateInput);
  }

  const runtimeState = cloneRuntimeState(runtimeStateInput);
  try {
    await requestJira(workflow, configuration, runtimeState, '/rest/api/3/webhook', {
      method: 'DELETE',
      body: { webhookIds },
    });

    if (JSON.stringify(asNumberArray(runtimeState.webhookRegistrationIds)) === JSON.stringify(webhookIds)) {
      runtimeState.webhookRegistrationIds = [];
      runtimeState.webhookExpirationDate = null;
    }
    runtimeState.registrationStatus = runtimeState.registrationStatus === 'registered'
      ? 'inactive'
      : runtimeState.registrationStatus;
    clearRuntimeError(runtimeState);
  } catch (error) {
    logger.warn({ workflowId: workflow.id, webhookIds, error }, 'Failed to delete Jira webhooks; stale registrations may remain until expiry');
    setRuntimeError(
      runtimeState,
      error instanceof Error ? error.message : 'Failed to delete Jira webhooks',
    );
  }

  return runtimeState;
}

export async function refreshJiraChangesNotificationTrigger(
  workflow: WorkflowRecord,
  configuration: Record<string, unknown>,
  runtimeStateInput: unknown,
) {
  const parsedConfiguration = safeParseTriggerConfiguration('jira_changes_notification', configuration);
  if (!parsedConfiguration.success) {
    throw new TriggerServiceError('Validation failed', 400, parsedConfiguration.error.issues);
  }

  const runtimeState = cloneRuntimeState(runtimeStateInput);
  const webhookIds = asNumberArray(runtimeState.webhookRegistrationIds);
  if (webhookIds.length === 0) {
    throw new TriggerServiceError('No Jira webhook ids are stored for refresh', 400);
  }

  const refreshResponse = await requestJira(
    workflow,
    parsedConfiguration.data as Record<string, unknown>,
    runtimeState,
    '/rest/api/3/webhook/refresh',
    {
      method: 'PUT',
      body: { webhookIds },
    },
  ) as { expirationDate?: string } | null;

  runtimeState.registrationStatus = 'registered';
  runtimeState.lastWebhookSyncAt = new Date().toISOString();
  runtimeState.webhookExpirationDate = refreshResponse?.expirationDate || runtimeState.webhookExpirationDate || null;
  clearRuntimeError(runtimeState);
  return runtimeState;
}

export async function maintainJiraChangesNotificationTriggers() {
  const activeTriggers = await db.query.triggers.findMany({
    where: and(eq(triggers.triggerType, 'jira_changes_notification'), eq(triggers.isActive, true)),
  });

  for (const trigger of activeTriggers) {
    const workflow = await db.query.workflows.findFirst({ where: eq(workflows.id, trigger.workflowId) });
    if (!workflow?.isActive) {
      continue;
    }

    const parsedConfiguration = safeParseTriggerConfiguration('jira_changes_notification', trigger.configuration);
    if (!parsedConfiguration.success) {
      const nextState = cloneRuntimeState(trigger.runtimeState);
      setRuntimeError(nextState, 'Jira trigger configuration is no longer valid');
      nextState.registrationStatus = 'error';
      if (runtimeStateChanged(nextState, trigger.runtimeState)) {
        await persistTriggerRuntimeState(trigger.id, nextState);
      }
      continue;
    }

    const runtimeState = cloneRuntimeState(trigger.runtimeState);
    const lastWebhookSyncAt = runtimeState.lastWebhookSyncAt ? new Date(runtimeState.lastWebhookSyncAt) : null;
    const syncCooldownElapsed = !lastWebhookSyncAt || Date.now() - lastWebhookSyncAt.getTime() >= JIRA_WEBHOOK_SYNC_BACKOFF_MS;
    const webhookIds = asNumberArray(runtimeState.webhookRegistrationIds);
    const webhookExpirationDate = runtimeState.webhookExpirationDate ? new Date(runtimeState.webhookExpirationDate) : null;

    let nextState = runtimeState;
    try {
      if (webhookIds.length === 0) {
        if (!syncCooldownElapsed) {
          continue;
        }
        nextState = await registerJiraChangesNotificationTrigger(
          workflow,
          trigger,
          parsedConfiguration.data as Record<string, unknown>,
          runtimeState,
        );
      } else if (!webhookExpirationDate || webhookExpirationDate.getTime() - Date.now() <= JIRA_WEBHOOK_REFRESH_WINDOW_MS) {
        if (!syncCooldownElapsed) {
          continue;
        }
        nextState = await refreshJiraChangesNotificationTrigger(
          workflow,
          parsedConfiguration.data as Record<string, unknown>,
          runtimeState,
        );
      }
    } catch (error) {
      nextState = cloneRuntimeState(runtimeState);
      setRuntimeError(
        nextState,
        error instanceof Error ? error.message : 'Failed to maintain Jira webhook registration',
      );
      nextState.registrationStatus = 'error';
    }

    if (runtimeStateChanged(nextState, trigger.runtimeState)) {
      await persistTriggerRuntimeState(trigger.id, nextState);
    }
  }
}

async function fetchJiraPollingIssues(
  workflow: WorkflowRecord,
  configuration: Record<string, unknown>,
  runtimeState: JiraRuntimeState,
  now: Date,
) {
  const intervalMinutes = Number(configuration.intervalMinutes || 15);
  const overlapMinutes = Number(configuration.overlapMinutes || 5);
  const maxResults = Number(configuration.maxResults || 50);
  const lastSuccessfulPollAt = runtimeState.lastSuccessfulPollAt ? new Date(runtimeState.lastSuccessfulPollAt) : null;
  const elapsedMinutes = lastSuccessfulPollAt
    ? Math.max(1, Math.ceil((now.getTime() - lastSuccessfulPollAt.getTime()) / 60_000))
    : intervalMinutes;
  const windowMinutes = Math.min(7 * 24 * 60, Math.max(intervalMinutes + overlapMinutes, elapsedMinutes + overlapMinutes));
  const baseJql = stripOrderByClause(asString(configuration.jql) || '');
  const pollingJql = `(${baseJql}) AND updated >= -${windowMinutes}m ORDER BY updated ASC`;

  const issues: JiraIssueSummary[] = [];
  let nextPageToken: string | undefined;

  do {
    const response = await requestJira(
      workflow,
      configuration,
      runtimeState,
      '/rest/api/3/search/jql',
      {
        method: 'POST',
        body: {
          jql: pollingJql,
          maxResults,
          fields: configuration.fields,
          nextPageToken,
        },
      },
    ) as {
      issues?: Array<Record<string, unknown>>;
      nextPageToken?: string;
      isLast?: boolean;
    } | null;

    for (const issue of response?.issues || []) {
      issues.push(normalizeJiraIssue(issue, asString(configuration.jiraSiteUrl) || ''));
      if (issues.length >= JIRA_POLLING_MAX_TOTAL_RESULTS) {
        break;
      }
    }

    if (issues.length >= JIRA_POLLING_MAX_TOTAL_RESULTS) {
      break;
    }

    nextPageToken = response?.isLast ? undefined : response?.nextPageToken;
  } while (nextPageToken);

  return { issues, windowMinutes };
}

export async function pollJiraPollingTriggers() {
  const activeTriggers = await db.query.triggers.findMany({
    where: and(eq(triggers.triggerType, 'jira_polling'), eq(triggers.isActive, true)),
  });

  for (const trigger of activeTriggers) {
    const workflow = await db.query.workflows.findFirst({ where: eq(workflows.id, trigger.workflowId) });
    if (!workflow?.isActive) {
      continue;
    }

    const parsedConfiguration = safeParseTriggerConfiguration('jira_polling', trigger.configuration);
    if (!parsedConfiguration.success) {
      const nextState = cloneRuntimeState(trigger.runtimeState);
      setRuntimeError(nextState, 'Jira polling configuration is no longer valid');
      if (runtimeStateChanged(nextState, trigger.runtimeState)) {
        await persistTriggerRuntimeState(trigger.id, nextState);
      }
      continue;
    }

    const configuration = parsedConfiguration.data as Record<string, unknown>;
    const runtimeState = cloneRuntimeState(trigger.runtimeState);
    const intervalMinutes = Number(configuration.intervalMinutes || 15);
    const maxResults = Number(configuration.maxResults || 50);
    const lastPolledAt = runtimeState.lastPolledAt ? new Date(runtimeState.lastPolledAt) : null;
    if (lastPolledAt && Date.now() - lastPolledAt.getTime() < intervalMinutes * 60_000) {
      continue;
    }

    const now = new Date();
    const nextState = cloneRuntimeState(runtimeState);
    nextState.lastPolledAt = now.toISOString();

    try {
      const { issues, windowMinutes } = await fetchJiraPollingIssues(workflow, configuration, nextState, now);
      const previousIssueMap = asRecord(nextState.recentIssueMap) as Record<string, string>;
      const changedIssues = issues.filter((issue) => issue.updated && previousIssueMap[issue.id] !== issue.updated);
      const nextIssueMap = trimRecentIssueMap({
        ...previousIssueMap,
        ...Object.fromEntries(
          issues
            .filter((issue) => issue.updated)
            .map((issue) => [issue.id, issue.updated as string]),
        ),
      });

      if (!nextState.lastSuccessfulPollAt && configuration.initialLoadMode === 'from_now') {
        nextState.recentIssueMap = nextIssueMap;
        nextState.lastSuccessfulPollAt = now.toISOString();
        clearRuntimeError(nextState);
        if (runtimeStateChanged(nextState, trigger.runtimeState)) {
          await persistTriggerRuntimeState(trigger.id, nextState);
        }
        continue;
      }

      if (changedIssues.length > 0) {
        const executionIssues = changedIssues.slice(0, maxResults);
        const inputs = {
          jiraSiteUrl: asString(configuration.jiraSiteUrl) || '',
          jiraJql: asString(configuration.jql) || '',
          jiraIssueKeys: executionIssues.map((issue) => issue.key),
          jiraIssues: executionIssues,
          polledAt: now.toISOString(),
          pollingWindowMinutes: windowMinutes,
        };

        await enqueueWorkflowExecution(trigger.workflowId, trigger.id, {
          type: 'jira_polling',
          jiraSiteUrl: inputs.jiraSiteUrl,
          jiraJql: inputs.jiraJql,
          polledAt: inputs.polledAt,
          pollingWindowMinutes: windowMinutes,
          resultCount: changedIssues.length,
          truncatedResultCount: changedIssues.length > executionIssues.length ? changedIssues.length - executionIssues.length : 0,
          inputs,
        });

        await persistTriggerRuntimeState(trigger.id, nextState, { lastFiredAt: now });
      }

      nextState.recentIssueMap = nextIssueMap;
      nextState.lastSuccessfulPollAt = now.toISOString();
      clearRuntimeError(nextState);

      if (runtimeStateChanged(nextState, trigger.runtimeState)) {
        await persistTriggerRuntimeState(trigger.id, nextState);
      }
    } catch (error) {
      setRuntimeError(
        nextState,
        error instanceof Error ? error.message : 'Failed to poll Jira issues',
      );
      if (runtimeStateChanged(nextState, trigger.runtimeState)) {
        await persistTriggerRuntimeState(trigger.id, nextState);
      }
    }
  }
}