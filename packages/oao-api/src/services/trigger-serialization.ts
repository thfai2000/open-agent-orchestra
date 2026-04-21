import type { triggers } from '../database/schema.js';
import { getTriggerShortLabel, getTriggerTypeLabel } from './trigger-definitions.js';

type TriggerRecord = typeof triggers.$inferSelect;

function asRecord(value: unknown) {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

export function buildTriggerRuntimeSummary(trigger: Pick<TriggerRecord, 'triggerType' | 'isActive' | 'runtimeState'>) {
  const runtimeState = asRecord(trigger.runtimeState);

  if (trigger.triggerType === 'jira_changes_notification') {
    const registeredWebhookCount = asStringArray(runtimeState.webhookRegistrationIds).length
      || (Array.isArray(runtimeState.webhookRegistrationIds) ? runtimeState.webhookRegistrationIds.length : 0);
    return {
      status: asString(runtimeState.registrationStatus) || (trigger.isActive ? 'pending' : 'inactive'),
      lastError: asString(runtimeState.lastError),
      lastErrorAt: asString(runtimeState.lastErrorAt),
      lastWebhookSyncAt: asString(runtimeState.lastWebhookSyncAt),
      webhookExpirationDate: asString(runtimeState.webhookExpirationDate),
      registeredWebhookCount,
    };
  }

  if (trigger.triggerType === 'jira_polling') {
    const recentIssueMap = asRecord(runtimeState.recentIssueMap);
    return {
      status: asString(runtimeState.lastError)
        ? 'error'
        : (trigger.isActive ? 'active' : 'inactive'),
      lastError: asString(runtimeState.lastError),
      lastErrorAt: asString(runtimeState.lastErrorAt),
      lastPolledAt: asString(runtimeState.lastPolledAt),
      lastSuccessfulPollAt: asString(runtimeState.lastSuccessfulPollAt),
      trackedIssueCount: Object.keys(recentIssueMap).length,
    };
  }

  return {
    status: trigger.isActive ? 'active' : 'inactive',
  };
}

export function serializeTrigger<T extends TriggerRecord>(trigger: T) {
  const rest = { ...trigger } as Omit<T, 'runtimeState'> & { runtimeState?: unknown };
  delete rest.runtimeState;

  return {
    ...rest,
    typeLabel: getTriggerTypeLabel(trigger.triggerType),
    shortTypeLabel: getTriggerShortLabel(trigger.triggerType),
    runtimeSummary: buildTriggerRuntimeSummary(trigger),
  };
}

export function serializeTriggers<T extends TriggerRecord>(triggerList: T[]) {
  return triggerList.map((trigger) => serializeTrigger(trigger));
}