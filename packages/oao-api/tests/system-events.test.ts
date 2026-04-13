import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// ─── Mock database ──────────────────────────────────────────────────
const mockInsertReturning = vi.fn().mockResolvedValue([{ id: 'event-001' }]);
const mockDb = {
  insert: vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: mockInsertReturning,
    }),
  }),
};

vi.mock('../src/database/index.js', () => ({
  db: mockDb,
}));

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-key-must-be-at-least-32-chars-long!!';
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
});

beforeEach(() => {
  vi.clearAllMocks();
  mockInsertReturning.mockResolvedValue([{ id: 'event-001' }]);
});

describe('EVENT_NAMES', () => {
  it('exports all expected event names', async () => {
    const { EVENT_NAMES } = await import('../src/services/system-events.js');

    expect(EVENT_NAMES.AGENT_CREATED).toBe('agent.created');
    expect(EVENT_NAMES.AGENT_UPDATED).toBe('agent.updated');
    expect(EVENT_NAMES.AGENT_DELETED).toBe('agent.deleted');
    expect(EVENT_NAMES.AGENT_STATUS_CHANGED).toBe('agent.status_changed');
    expect(EVENT_NAMES.WORKFLOW_CREATED).toBe('workflow.created');
    expect(EVENT_NAMES.WORKFLOW_UPDATED).toBe('workflow.updated');
    expect(EVENT_NAMES.WORKFLOW_DELETED).toBe('workflow.deleted');
    expect(EVENT_NAMES.EXECUTION_STARTED).toBe('execution.started');
    expect(EVENT_NAMES.EXECUTION_COMPLETED).toBe('execution.completed');
    expect(EVENT_NAMES.EXECUTION_FAILED).toBe('execution.failed');
    expect(EVENT_NAMES.EXECUTION_CANCELLED).toBe('execution.cancelled');
    expect(EVENT_NAMES.STEP_COMPLETED).toBe('step.completed');
    expect(EVENT_NAMES.STEP_FAILED).toBe('step.failed');
    expect(EVENT_NAMES.TRIGGER_FIRED).toBe('trigger.fired');
    expect(EVENT_NAMES.WEBHOOK_RECEIVED).toBe('webhook.received');
    expect(EVENT_NAMES.USER_LOGIN).toBe('user.login');
    expect(EVENT_NAMES.USER_REGISTERED).toBe('user.registered');
    expect(EVENT_NAMES.VARIABLE_CREATED).toBe('variable.created');
    expect(EVENT_NAMES.VARIABLE_UPDATED).toBe('variable.updated');
    expect(EVENT_NAMES.VARIABLE_DELETED).toBe('variable.deleted');
  });
});

describe('emitEvent', () => {
  it('inserts a system event and returns event ID', async () => {
    const { emitEvent, EVENT_NAMES } = await import('../src/services/system-events.js');

    const eventId = await emitEvent({
      eventScope: 'workspace',
      scopeId: 'ws-001',
      eventName: EVENT_NAMES.AGENT_CREATED,
      eventData: { agentId: 'agent-001', agentName: 'Test' },
      actorId: 'user-001',
    });

    expect(eventId).toBe('event-001');
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('handles missing eventData gracefully', async () => {
    const { emitEvent, EVENT_NAMES } = await import('../src/services/system-events.js');

    const eventId = await emitEvent({
      eventScope: 'user',
      scopeId: 'user-001',
      eventName: EVENT_NAMES.USER_LOGIN,
    });

    expect(eventId).toBe('event-001');
  });

  it('returns null when database insert fails', async () => {
    mockInsertReturning.mockRejectedValueOnce(new Error('DB connection lost'));

    const { emitEvent, EVENT_NAMES } = await import('../src/services/system-events.js');

    const eventId = await emitEvent({
      eventScope: 'workspace',
      scopeId: 'ws-001',
      eventName: EVENT_NAMES.EXECUTION_FAILED,
    });

    expect(eventId).toBeNull();
  });

  it('handles null actorId', async () => {
    const { emitEvent, EVENT_NAMES } = await import('../src/services/system-events.js');

    const eventId = await emitEvent({
      eventScope: 'workspace',
      scopeId: 'ws-001',
      eventName: EVENT_NAMES.TRIGGER_FIRED,
      actorId: null,
    });

    expect(eventId).toBe('event-001');
  });
});
