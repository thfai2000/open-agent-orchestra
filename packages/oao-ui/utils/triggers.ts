export interface TriggerCatalogEntry {
  type: string;
  label: string;
  shortLabel: string;
  category: string;
  description: string;
  notes?: string;
  supportsManualRun: boolean;
  defaultConfiguration: Record<string, unknown>;
}

export interface WorkflowTriggerLike {
  id?: string;
  triggerType: string;
  configuration: Record<string, any>;
  isActive?: boolean;
  runtimeSummary?: Record<string, any>;
}

const triggerLabels: Record<string, string> = {
  time_schedule: 'Schedule',
  exact_datetime: 'Exact Time',
  webhook: 'Webhook',
  event: 'System Event',
  jira_changes_notification: 'Jira Changes Notification',
  jira_polling: 'Jira Polling',
  manual: 'Manual',
};

export function formatTriggerType(triggerType?: string | null) {
  return triggerLabels[triggerType || ''] || triggerType || 'Unknown';
}

export function cloneTriggerDefaultConfiguration(defaultConfiguration: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(defaultConfiguration ?? {})) as Record<string, unknown>;
}

export function createTriggerDraft(triggerType: TriggerCatalogEntry) {
  const configuration = cloneTriggerDefaultConfiguration(triggerType.defaultConfiguration);
  if (triggerType.type === 'webhook' && !configuration.path) {
    configuration.path = randomWebhookPath();
  }

  return {
    triggerType: triggerType.type,
    configuration,
    isActive: true,
  };
}

export function randomWebhookPath() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `/wh-${crypto.randomUUID().slice(0, 8)}`;
    }
  } catch {
    // Fall back below on non-secure origins.
  }

  return `/wh-${Math.random().toString(36).slice(2, 10)}`;
}

function ellipsize(value: string, limit = 100) {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function formatShortDate(value?: string | null) {
  if (!value) {
    return null;
  }
  return new Date(value).toLocaleString();
}

export function formatTriggerConfiguration(trigger: WorkflowTriggerLike) {
  const configuration = trigger.configuration || {};
  if (trigger.triggerType === 'time_schedule') {
    return configuration.cron || 'Cron schedule not configured';
  }
  if (trigger.triggerType === 'exact_datetime') {
    return configuration.datetime || 'Date and time not configured';
  }
  if (trigger.triggerType === 'webhook') {
    const paramCount = Array.isArray(configuration.parameters) ? configuration.parameters.length : 0;
    return configuration.path
      ? `${configuration.path}${paramCount > 0 ? ` • ${paramCount} parameter${paramCount === 1 ? '' : 's'}` : ''}`
      : 'Webhook path not configured';
  }
  if (trigger.triggerType === 'event') {
    const eventScope = configuration.eventScope ? ` • ${configuration.eventScope}` : '';
    return configuration.eventName
      ? `${configuration.eventName}${eventScope}`
      : 'Event trigger not configured';
  }
  if (trigger.triggerType === 'jira_changes_notification') {
    return configuration.jql
      ? `JQL: ${ellipsize(String(configuration.jql), 120)}`
      : 'Jira JQL not configured';
  }
  if (trigger.triggerType === 'jira_polling') {
    const intervalMinutes = configuration.intervalMinutes ? `Every ${configuration.intervalMinutes} min` : 'Polling interval not configured';
    const jql = configuration.jql ? ` • ${ellipsize(String(configuration.jql), 90)}` : '';
    return `${intervalMinutes}${jql}`;
  }
  return 'Trigger configuration';
}

export function formatTriggerRuntimeSummary(trigger: WorkflowTriggerLike) {
  const runtimeSummary = trigger.runtimeSummary || {};
  if (runtimeSummary.lastError) {
    return String(runtimeSummary.lastError);
  }

  if (trigger.triggerType === 'jira_changes_notification') {
    const parts = [] as string[];
    if (runtimeSummary.registeredWebhookCount) {
      parts.push(`${runtimeSummary.registeredWebhookCount} registered webhook${runtimeSummary.registeredWebhookCount === 1 ? '' : 's'}`);
    }
    if (runtimeSummary.webhookExpirationDate) {
      parts.push(`expires ${formatShortDate(runtimeSummary.webhookExpirationDate)}`);
    }
    if (runtimeSummary.lastWebhookSyncAt) {
      parts.push(`synced ${formatShortDate(runtimeSummary.lastWebhookSyncAt)}`);
    }
    if (runtimeSummary.status) {
      parts.unshift(String(runtimeSummary.status));
    }
    return parts.join(' • ');
  }

  if (trigger.triggerType === 'jira_polling') {
    const parts = [] as string[];
    if (runtimeSummary.lastSuccessfulPollAt) {
      parts.push(`last success ${formatShortDate(runtimeSummary.lastSuccessfulPollAt)}`);
    } else if (runtimeSummary.lastPolledAt) {
      parts.push(`last poll ${formatShortDate(runtimeSummary.lastPolledAt)}`);
    }
    if (runtimeSummary.trackedIssueCount) {
      parts.push(`${runtimeSummary.trackedIssueCount} tracked issue${runtimeSummary.trackedIssueCount === 1 ? '' : 's'}`);
    }
    if (runtimeSummary.status) {
      parts.unshift(String(runtimeSummary.status));
    }
    return parts.join(' • ');
  }

  return runtimeSummary.status ? String(runtimeSummary.status) : '';
}