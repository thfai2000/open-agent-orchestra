import { and, asc, eq, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { createLogger } from '@oao/shared';
import { db } from '../database/index.js';
import { triggers, webhookRegistrations, workflowExecutions, workflowNodes, workflowSteps } from '../database/schema.js';
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

async function assertEntryNodeExists(workflowId: string, entryNodeKey?: string | null) {
  if (!entryNodeKey) return;
  const node = await db.query.workflowNodes.findFirst({
    where: and(
      eq(workflowNodes.workflowId, workflowId),
      eq(workflowNodes.nodeKey, entryNodeKey),
    ),
  });
  if (!node) {
    throw new TriggerServiceError(`Entry node "${entryNodeKey}" does not exist in this workflow graph`, 400);
  }
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

async function resolveWebhookRegistrationAgentId(workflow: WorkflowRecord) {
  if (workflow.defaultAgentId) {
    return workflow.defaultAgentId;
  }

  const stepWithAgent = await db.query.workflowSteps.findFirst({
    where: and(
      eq(workflowSteps.workflowId, workflow.id),
      sql`${workflowSteps.agentId} is not null`,
    ),
    orderBy: asc(workflowSteps.stepOrder),
  });

  if (stepWithAgent?.agentId) {
    return stepWithAgent.agentId;
  }

  throw new TriggerServiceError(
    'Webhook triggers require a default agent or at least one step-specific agent',
    400,
  );
}

async function syncWebhookRegistration(params: {
  workflow: WorkflowRecord;
  trigger: TriggerRecord;
  configuration: Record<string, unknown>;
  isActive: boolean;
}) {
  const endpointPath = getWebhookPathFromConfiguration('webhook', params.configuration);
  if (!endpointPath) {
    throw new TriggerServiceError('Webhook triggers require a configured path', 400);
  }

  const agentId = await resolveWebhookRegistrationAgentId(params.workflow);
  const existingRegistration = await db.query.webhookRegistrations.findFirst({
    where: eq(webhookRegistrations.triggerId, params.trigger.id),
  });

  if (existingRegistration) {
    await db
      .update(webhookRegistrations)
      .set({
        agentId,
        endpointPath,
        isActive: params.isActive,
      })
      .where(eq(webhookRegistrations.id, existingRegistration.id));
    return;
  }

  const { encrypt } = await import('@oao/shared');
  const hmacSecretEncrypted = encrypt(crypto.randomUUID() + crypto.randomUUID());

  await db
    .insert(webhookRegistrations)
    .values({
      agentId,
      triggerId: params.trigger.id,
      endpointPath,
      hmacSecretEncrypted,
      isActive: params.isActive,
    });
}

async function deleteWebhookRegistrationsForTrigger(triggerId: string) {
  await db.delete(webhookRegistrations).where(eq(webhookRegistrations.triggerId, triggerId));
}

export async function createWorkflowTrigger(params: {
  workflow: WorkflowRecord;
  triggerType: CreatableTriggerType;
  configuration: unknown;
  isActive?: boolean;
  entryNodeKey?: string | null;
  positionX?: number;
  positionY?: number;
}) {
  const normalizedConfiguration = normalizeTriggerConfiguration(params.triggerType, params.configuration);
  const isActive = params.isActive ?? true;
  const webhookPath = getWebhookPathFromConfiguration(params.triggerType, normalizedConfiguration);
  if (webhookPath) {
    await ensureWebhookPathIsUnique(webhookPath);
  }
  await assertEntryNodeExists(params.workflow.id, params.entryNodeKey);

  const [createdTrigger] = await db.insert(triggers).values({
    workflowId: params.workflow.id,
    triggerType: params.triggerType,
    configuration: normalizedConfiguration,
    runtimeState: {},
    isActive,
    entryNodeKey: params.entryNodeKey ?? null,
    positionX: params.positionX ?? 40,
    positionY: params.positionY ?? 40,
    updatedAt: new Date(),
  }).returning();

  if (params.triggerType === 'webhook') {
    try {
      await syncWebhookRegistration({
        workflow: params.workflow,
        trigger: createdTrigger,
        configuration: normalizedConfiguration,
        isActive,
      });
      return createdTrigger;
    } catch (error) {
      await db.delete(triggers).where(eq(triggers.id, createdTrigger.id));
      throw error;
    }
  }

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
  entryNodeKey?: string | null;
  positionX?: number;
  positionY?: number;
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
  await assertEntryNodeExists(
    params.workflow.id,
    params.entryNodeKey !== undefined ? params.entryNodeKey : params.trigger.entryNodeKey,
  );

  const wasJiraNotification = params.trigger.triggerType === 'jira_changes_notification';
  const willBeJiraNotification = nextTriggerType === 'jira_changes_notification';
  const wasWebhook = params.trigger.triggerType === 'webhook';
  const willBeWebhook = nextTriggerType === 'webhook';
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
      ...(params.entryNodeKey !== undefined ? { entryNodeKey: params.entryNodeKey } : {}),
      ...(params.positionX !== undefined ? { positionX: params.positionX } : {}),
      ...(params.positionY !== undefined ? { positionY: params.positionY } : {}),
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

  if (willBeWebhook) {
    await syncWebhookRegistration({
      workflow: params.workflow,
      trigger: updatedTrigger,
      configuration: nextConfiguration,
      isActive: nextIsActive,
    });
  } else if (wasWebhook) {
    await deleteWebhookRegistrationsForTrigger(params.trigger.id);
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

  await db.transaction(async (tx) => {
    await tx.execute(sql`select id from ${triggers} where ${triggers.id} = ${params.trigger.id} for update`);

    if (params.trigger.triggerType === 'webhook') {
      await tx.delete(webhookRegistrations).where(eq(webhookRegistrations.triggerId, params.trigger.id));
    }

    await tx
      .update(workflowExecutions)
      .set({ triggerId: null })
      .where(eq(workflowExecutions.triggerId, params.trigger.id));

    await tx.delete(triggers).where(eq(triggers.id, params.trigger.id));
  });

  if (existingWebhookIds.length > 0) {
    await cleanupSpecificJiraWebhookIds(
      params.workflow,
      params.trigger.configuration as Record<string, unknown>,
      params.trigger.runtimeState,
      existingWebhookIds,
    );
  }
}