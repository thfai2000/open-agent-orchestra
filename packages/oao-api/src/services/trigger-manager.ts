import { and, eq, sql } from 'drizzle-orm';
import { createLogger } from '@oao/shared';
import { db } from '../database/index.js';
import { triggers } from '../database/schema.js';
import {
  type CreatableTriggerType,
  getWebhookPathFromConfiguration,
  safeParseTriggerConfiguration,
} from './trigger-definitions.js';
import {
  cleanupSpecificJiraWebhookIds,
  registerJiraChangesNotificationTrigger,
} from './jira-integration.js';
import { TriggerServiceError } from './trigger-errors.js';

type WorkflowRecord = NonNullable<Awaited<ReturnType<typeof db.query.workflows.findFirst>>>;
type TriggerRecord = typeof triggers.$inferSelect;

const logger = createLogger('trigger-manager');

function cloneJson<T>(value: T) {
  return JSON.parse(JSON.stringify(value)) as T;
}

function configsEqual(left: unknown, right: unknown) {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}

export function normalizeTriggerConfiguration(triggerType: CreatableTriggerType, configuration: unknown) {
  const parsed = safeParseTriggerConfiguration(triggerType, configuration);
  if (!parsed.success) {
    throw new TriggerServiceError('Validation failed', 400, parsed.error.issues);
  }
  return parsed.data as Record<string, unknown>;
}

export async function ensureWebhookPathIsUnique(path: string, excludeTriggerId?: string) {
  const conflictingTrigger = await db.query.triggers.findFirst({
    where: and(
      eq(triggers.triggerType, 'webhook'),
      sql`configuration->>'path' = ${path}`,
      excludeTriggerId ? sql`${triggers.id} <> ${excludeTriggerId}` : sql`true`,
    ),
  });

  if (conflictingTrigger) {
    throw new TriggerServiceError(`Webhook path "${path}" is already in use`, 409);
  }
}

export async function createWorkflowTrigger(params: {
  workflow: WorkflowRecord;
  triggerType: CreatableTriggerType;
  configuration: unknown;
  isActive?: boolean;
}) {
  const normalizedConfiguration = normalizeTriggerConfiguration(params.triggerType, params.configuration);
  const isActive = params.isActive ?? true;
  const webhookPath = getWebhookPathFromConfiguration(params.triggerType, normalizedConfiguration);
  if (webhookPath) {
    await ensureWebhookPathIsUnique(webhookPath);
  }

  const [createdTrigger] = await db.insert(triggers).values({
    workflowId: params.workflow.id,
    triggerType: params.triggerType,
    configuration: normalizedConfiguration,
    runtimeState: {},
    isActive,
    updatedAt: new Date(),
  }).returning();

  if (params.triggerType !== 'jira_changes_notification' || !isActive) {
    return createdTrigger;
  }

  try {
    const runtimeState = await registerJiraChangesNotificationTrigger(
      params.workflow,
      createdTrigger,
      normalizedConfiguration,
      createdTrigger.runtimeState,
    );

    const [updatedTrigger] = await db.update(triggers)
      .set({ runtimeState, updatedAt: new Date() })
      .where(eq(triggers.id, createdTrigger.id))
      .returning();

    return updatedTrigger;
  } catch (error) {
    await db.delete(triggers).where(eq(triggers.id, createdTrigger.id));
    throw error;
  }
}

export async function updateWorkflowTrigger(params: {
  workflow: WorkflowRecord;
  trigger: TriggerRecord;
  triggerType?: CreatableTriggerType;
  configuration?: unknown;
  isActive?: boolean;
}) {
  const nextTriggerType = params.triggerType ?? params.trigger.triggerType as CreatableTriggerType;
  const nextConfiguration = normalizeTriggerConfiguration(
    nextTriggerType,
    params.configuration ?? params.trigger.configuration,
  );
  const nextIsActive = params.isActive ?? params.trigger.isActive;
  const webhookPath = getWebhookPathFromConfiguration(nextTriggerType, nextConfiguration);
  if (webhookPath) {
    await ensureWebhookPathIsUnique(webhookPath, params.trigger.id);
  }

  const wasJiraNotification = params.trigger.triggerType === 'jira_changes_notification';
  const willBeJiraNotification = nextTriggerType === 'jira_changes_notification';
  const jiraConfigChanged = !configsEqual(params.trigger.configuration, nextConfiguration);
  const previousWebhookIds = wasJiraNotification
    ? Array.isArray((params.trigger.runtimeState as Record<string, unknown> | null)?.webhookRegistrationIds)
      ? ((params.trigger.runtimeState as Record<string, unknown>).webhookRegistrationIds as number[])
      : []
    : [];

  let nextRuntimeState: Record<string, unknown> = {};

  if (nextTriggerType === 'jira_polling') {
    nextRuntimeState = params.trigger.triggerType === 'jira_polling' && configsEqual(params.trigger.configuration, nextConfiguration)
      ? cloneJson(params.trigger.runtimeState as Record<string, unknown> || {})
      : {};
  }

  if (willBeJiraNotification) {
    const shouldRegisterJiraWebhook = nextIsActive
      && (!wasJiraNotification || jiraConfigChanged || !params.trigger.isActive || previousWebhookIds.length === 0);

    nextRuntimeState = shouldRegisterJiraWebhook
      ? await registerJiraChangesNotificationTrigger(
        params.workflow,
        params.trigger,
        nextConfiguration,
        params.trigger.runtimeState,
      )
      : cloneJson(params.trigger.runtimeState as Record<string, unknown> || {});

    if (!nextIsActive) {
      nextRuntimeState.registrationStatus = 'inactive';
      nextRuntimeState.webhookRegistrationIds = [];
      nextRuntimeState.webhookExpirationDate = null;
    }
  }

  const [updatedTrigger] = await db.update(triggers)
    .set({
      triggerType: nextTriggerType,
      configuration: nextConfiguration,
      runtimeState: nextRuntimeState,
      isActive: nextIsActive,
      updatedAt: new Date(),
    })
    .where(eq(triggers.id, params.trigger.id))
    .returning();

  if (previousWebhookIds.length > 0 && (!willBeJiraNotification || !configsEqual(params.trigger.configuration, nextConfiguration) || !nextIsActive)) {
    const cleanupState = await cleanupSpecificJiraWebhookIds(
      params.workflow,
      params.trigger.configuration as Record<string, unknown>,
      params.trigger.runtimeState,
      previousWebhookIds,
    );

    if (wasJiraNotification && !willBeJiraNotification) {
      logger.info({ triggerId: params.trigger.id }, 'Removed Jira webhook registrations while switching trigger type');
    }

    if (!configsEqual(cleanupState, updatedTrigger.runtimeState) && !willBeJiraNotification) {
      await db.update(triggers)
        .set({ runtimeState: {}, updatedAt: new Date() })
        .where(eq(triggers.id, updatedTrigger.id));
    }
  }

  return updatedTrigger;
}

export async function deleteWorkflowTrigger(params: {
  workflow: WorkflowRecord;
  trigger: TriggerRecord;
}) {
  const existingWebhookIds = params.trigger.triggerType === 'jira_changes_notification'
    ? Array.isArray((params.trigger.runtimeState as Record<string, unknown> | null)?.webhookRegistrationIds)
      ? ((params.trigger.runtimeState as Record<string, unknown>).webhookRegistrationIds as number[])
      : []
    : [];

  await db.delete(triggers).where(eq(triggers.id, params.trigger.id));

  if (existingWebhookIds.length > 0) {
    await cleanupSpecificJiraWebhookIds(
      params.workflow,
      params.trigger.configuration as Record<string, unknown>,
      params.trigger.runtimeState,
      existingWebhookIds,
    );
  }
}