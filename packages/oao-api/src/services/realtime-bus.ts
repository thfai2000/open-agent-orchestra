/**
 * Realtime Event Bus — Redis pub/sub bridge for cross-process SSE broadcasting.
 *
 * Workers (agent-worker, workflow-worker, controller) publish execution events
 * to a Redis channel. The API pod subscribes and relays to SSE clients.
 */
import Redis from 'ioredis';
import { createLogger } from '@oao/shared';
import { getRedisConnectionOpts } from './redis.js';

const logger = createLogger('realtime-bus');

const CHANNEL = 'oao:realtime';

// ─── Event Types ──────────────────────────────────────────────────────

export interface RealtimeEvent {
  /** Event category */
  type:
    | 'execution.created'
    | 'execution.started'
    | 'execution.status'
    | 'execution.completed'
    | 'execution.failed'
    | 'execution.cancelled'
    | 'step.started'
    | 'step.progress'
    | 'step.allocation_waiting'
    | 'step.quota_waiting'
    | 'step.completed'
    | 'step.failed'
    | 'conversation.message.started'
    | 'conversation.message.delta'
    | 'conversation.message.reasoning'
    | 'conversation.message.reasoning_delta'
    | 'conversation.message.completed'
    | 'conversation.message.failed'
    | 'conversation.tool.execution_start'
    | 'conversation.tool.execution_complete'
    | 'conversation.tool.ask_questions'
    | 'conversation.tool.ask_questions_resolved'
    | 'conversation.turn.started'
    | 'conversation.turn.completed'
    // ── Unified agent session events (parallel to legacy step.* / conversation.*) ──
    // Carry { contextType: 'conversation' | 'workflow_step', contextId, parentId? }
    // in `data` so the shared frontend stream can be context-agnostic.
    | 'agent.turn.started'
    | 'agent.turn.completed'
    | 'agent.message.started'
    | 'agent.message.delta'
    | 'agent.message.reasoning_delta'
    | 'agent.message.completed'
    | 'agent.message.failed'
    | 'agent.tool.execution_start'
    | 'agent.tool.execution_complete'
    | 'agent.tool.ask_questions'
    | 'agent.tool.ask_questions_resolved'
    // ── Workflow-step granular events (mirror conversation.message.* / .tool.*) ──
    | 'step.tool.ask_questions'
    | 'step.tool.ask_questions_resolved'
    // ── Graph workflow node events ────────────────────────────────────
    | 'node.started'
    | 'node.completed'
    | 'node.skipped'
    | 'node.failed';
  /** Workflow execution ID */
  executionId?: string;
  /** Workflow ID (for listing page filtering) */
  workflowId?: string;
  /** Workspace ID (for access scoping) */
  workspaceId?: string;
  /** Conversation ID (for chat page filtering) */
  conversationId?: string;
  /** Conversation message ID */
  messageId?: string;
  /** Step execution ID (for step-level events) */
  stepExecutionId?: string;
  /** Step order (1-based) */
  stepOrder?: number;
  /** Arbitrary payload */
  data?: Record<string, unknown>;
  /** ISO timestamp */
  timestamp: string;
}

// ─── Publisher (used by workers) ──────────────────────────────────────

let pubClient: Redis | null = null;

function getPubClient(): Redis {
  if (!pubClient) {
    pubClient = new Redis(getRedisConnectionOpts());
    pubClient.on('error', (err) => logger.error({ error: err.message }, 'Redis pub client error'));
  }
  return pubClient;
}

/**
 * Publish a realtime event to Redis pub/sub.
 * Best-effort — errors are logged but not thrown.
 */
export async function publishRealtimeEvent(event: RealtimeEvent): Promise<void> {
  try {
    await getPubClient().publish(CHANNEL, JSON.stringify(event));
  } catch (err) {
    logger.warn({ error: err, type: event.type, executionId: event.executionId }, 'Failed to publish realtime event');
  }
}

// ─── Subscriber (used by API pod) ─────────────────────────────────────

type RealtimeListener = (event: RealtimeEvent) => void;

let subClient: Redis | null = null;
const listeners = new Set<RealtimeListener>();

/**
 * Start the Redis subscriber. Call once during API server startup.
 * All registered listeners will receive every event — they should filter by executionId.
 */
export function startRealtimeSubscriber(): void {
  if (subClient) return;

  subClient = new Redis(getRedisConnectionOpts());
  subClient.on('error', (err) => logger.error({ error: err.message }, 'Redis sub client error'));

  subClient.subscribe(CHANNEL, (err) => {
    if (err) {
      logger.error({ error: err.message }, 'Failed to subscribe to realtime channel');
    } else {
      logger.info('Realtime subscriber connected');
    }
  });

  subClient.on('message', (_channel, message) => {
    try {
      const event = JSON.parse(message) as RealtimeEvent;
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (listenerErr) {
          logger.warn({ error: listenerErr }, 'Realtime listener error');
        }
      }
    } catch (parseErr) {
      logger.warn({ error: parseErr }, 'Failed to parse realtime event');
    }
  });
}

/**
 * Register a listener for realtime events. Returns an unsubscribe function.
 */
export function onRealtimeEvent(listener: RealtimeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Gracefully close the subscriber and publisher.
 */
export async function stopRealtimeBus(): Promise<void> {
  listeners.clear();
  if (subClient) {
    await subClient.unsubscribe(CHANNEL);
    subClient.disconnect();
    subClient = null;
  }
  if (pubClient) {
    pubClient.disconnect();
    pubClient = null;
  }
}
