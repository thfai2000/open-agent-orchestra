import { describe, expect, it } from 'vitest';
import { getTriggerCatalog, safeParseTriggerConfiguration } from '../src/services/trigger-definitions.js';

describe('trigger definitions', () => {
  it('includes both Jira trigger types in the catalog', () => {
    const catalog = getTriggerCatalog();

    expect(catalog.some((entry) => entry.type === 'jira_changes_notification')).toBe(true);
    expect(catalog.some((entry) => entry.type === 'jira_polling')).toBe(true);
  });

  it('normalizes a valid Jira changes notification configuration', () => {
    const result = safeParseTriggerConfiguration('jira_changes_notification', {
      jiraSiteUrl: 'https://example.atlassian.net/',
      authMode: 'oauth2',
      credentials: {
        accessTokenVariableKey: 'JIRA_ACCESS_TOKEN',
        refreshTokenVariableKey: 'JIRA_REFRESH_TOKEN',
        clientIdVariableKey: 'JIRA_CLIENT_ID',
        clientSecretVariableKey: 'JIRA_CLIENT_SECRET',
      },
      jql: 'project = OAO ORDER BY updated DESC',
      events: ['jira:issue_updated', 'jira:issue_updated', 'jira:issue_created'],
      fieldIdsFilter: ['summary', 'summary', 'status'],
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.jiraSiteUrl).toBe('https://example.atlassian.net');
    expect(result.data.events).toEqual(['jira:issue_updated', 'jira:issue_created']);
    expect(result.data.fieldIdsFilter).toEqual(['summary', 'status']);
  });

  it('rejects Jira polling api-token configuration when required credentials are missing', () => {
    const result = safeParseTriggerConfiguration('jira_polling', {
      jiraSiteUrl: 'https://example.atlassian.net',
      authMode: 'api_token',
      credentials: {
        email: 'ops@example.com',
      },
      jql: 'project = OAO',
      intervalMinutes: 10,
      maxResults: 25,
      fields: ['summary'],
      initialLoadMode: 'from_now',
      overlapMinutes: 5,
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    expect(result.error.issues.some((issue) => issue.path.includes('apiTokenVariableKey'))).toBe(true);
  });
});