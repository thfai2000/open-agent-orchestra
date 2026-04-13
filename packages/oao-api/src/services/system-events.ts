import { db } from '../database/index.js';
import { systemEvents } from '../database/schema.js';
import { createLogger } from '@oao/shared';

const logger = createLogger('system-events');

// ─── Predefined Event Names ─────────────────────────────────────────

export const EVENT_NAMES = {
  // Agent events
  AGENT_CREATED: 'agent.created',
  AGENT_UPDATED: 'agent.updated',
  AGENT_DELETED: 'agent.deleted',
  AGENT_STATUS_CHANGED: 'agent.status_changed',

  // Workflow events
  WORKFLOW_CREATED: 'workflow.created',
  WORKFLOW_UPDATED: 'workflow.updated',
  WORKFLOW_DELETED: 'workflow.deleted',

  // Execution events
  EXECUTION_STARTED: 'execution.started',
  EXECUTION_COMPLETED: 'execution.completed',
  EXECUTION_FAILED: 'execution.failed',
  EXECUTION_CANCELLED: 'execution.cancelled',
  STEP_COMPLETED: 'step.completed',
  STEP_FAILED: 'step.failed',

  // Trigger events
  TRIGGER_FIRED: 'trigger.fired',

  // Webhook events
  WEBHOOK_RECEIVED: 'webhook.received',

  // User events
  USER_LOGIN: 'user.login',
  USER_REGISTERED: 'user.registered',

  // Variable events
  VARIABLE_CREATED: 'variable.created',
  VARIABLE_UPDATED: 'variable.updated',
  VARIABLE_DELETED: 'variable.deleted',
} as const;

export type EventName = (typeof EVENT_NAMES)[keyof typeof EVENT_NAMES];

// ─── Emit Event ──────────────────────────────────────────────────────

export interface EmitEventParams {
  eventScope: 'workspace' | 'user';
  scopeId: string;          // workspace_id or user_id
  eventName: EventName;
  eventData?: Record<string, unknown>;
  actorId?: string | null;  // user who triggered the action
}

/**
 * Emit a system event (best-effort, non-blocking).
 * Events are persisted for audit and can trigger event-based workflows.
 */
export async function emitEvent(params: EmitEventParams): Promise<string | null> {
  try {
    const [event] = await db
      .insert(systemEvents)
      .values({
        eventScope: params.eventScope,
        scopeId: params.scopeId,
        eventName: params.eventName,
        eventData: params.eventData ?? {},
        actorId: params.actorId ?? null,
      })
      .returning({ id: systemEvents.id });

    logger.debug(
      { eventId: event.id, eventName: params.eventName, scope: params.eventScope },
      'System event emitted',
    );

    return event.id;
  } catch (error) {
    logger.error({ error, eventName: params.eventName }, 'Failed to emit system event');
    return null;
  }
}
