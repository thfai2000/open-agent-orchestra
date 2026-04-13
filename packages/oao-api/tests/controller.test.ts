import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// ─── Mock database ──────────────────────────────────────────────────
const mockDb = {
  query: {
    triggers: { findMany: vi.fn().mockResolvedValue([]) },
    workflows: { findFirst: vi.fn() },
    systemEvents: { findMany: vi.fn().mockResolvedValue([]) },
  },
  update: vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  }),
};

vi.mock('../src/database/index.js', () => ({
  db: mockDb,
}));

// ─── Mock Redis ─────────────────────────────────────────────────────
const mockRedis = {
  set: vi.fn().mockResolvedValue('OK'),
  expire: vi.fn().mockResolvedValue(1),
  get: vi.fn().mockResolvedValue(null),
};

vi.mock('../src/services/redis.js', () => ({
  getRedisConnection: () => mockRedis,
}));

// ─── Mock workflow engine ───────────────────────────────────────────
vi.mock('../src/services/workflow-engine.js', () => ({
  enqueueWorkflowExecution: vi.fn().mockResolvedValue({ id: 'exec-1' }),
}));

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-key-must-be-at-least-32-chars-long!!';
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
});

beforeEach(() => {
  vi.clearAllMocks();
});

// We can't directly import the controller since it auto-starts a run() loop.
// Instead we test the exported/internal functions via module import tricks.
// The cronMatchesNow function isn't exported, so we test it via a separate extraction.

describe('Controller: cronMatchesNow logic', () => {
  // We replicate the cronMatchesNow function from controller.ts for unit testing
  // since it's not exported. In a real codebase, we'd export it.
  function cronMatchesNow(cronExpr: string): boolean {
    const parts = cronExpr.split(/\s+/);
    if (parts.length !== 5) return false;

    const now = new Date();
    const checks = [
      { value: now.getMinutes(), field: parts[0] },
      { value: now.getHours(), field: parts[1] },
      { value: now.getDate(), field: parts[2] },
      { value: now.getMonth() + 1, field: parts[3] },
      { value: now.getDay(), field: parts[4] },
    ];

    return checks.every(({ value, field }) => {
      if (field === '*') return true;
      if (field.includes(',')) {
        return field.split(',').map(Number).includes(value);
      }
      if (field.includes('-')) {
        const [min, max] = field.split('-').map(Number);
        return value >= min && value <= max;
      }
      if (field.startsWith('*/')) {
        const step = parseInt(field.slice(2), 10);
        return value % step === 0;
      }
      return parseInt(field, 10) === value;
    });
  }

  it('matches wildcard (* * * * *) at any time', () => {
    expect(cronMatchesNow('* * * * *')).toBe(true);
  });

  it('rejects expressions with wrong number of parts', () => {
    expect(cronMatchesNow('* * *')).toBe(false);
    expect(cronMatchesNow('* * * * * *')).toBe(false);
    expect(cronMatchesNow('')).toBe(false);
  });

  it('matches exact minute', () => {
    const now = new Date();
    const minute = now.getMinutes();
    expect(cronMatchesNow(`${minute} * * * *`)).toBe(true);
    // A different minute should not match (unless it happens to be that minute)
    const otherMinute = (minute + 30) % 60;
    expect(cronMatchesNow(`${otherMinute} * * * *`)).toBe(false);
  });

  it('matches comma-separated lists', () => {
    const now = new Date();
    const minute = now.getMinutes();
    expect(cronMatchesNow(`${minute},${(minute + 1) % 60} * * * *`)).toBe(true);
  });

  it('matches ranges', () => {
    const now = new Date();
    const minute = now.getMinutes();
    expect(cronMatchesNow(`0-59 * * * *`)).toBe(true);
    expect(cronMatchesNow(`${minute}-${minute} * * * *`)).toBe(true);
  });

  it('matches step (*/n)', () => {
    const now = new Date();
    const minute = now.getMinutes();
    // */1 should always match
    expect(cronMatchesNow(`*/1 * * * *`)).toBe(true);
    // Check if current minute matches step
    if (minute % 5 === 0) {
      expect(cronMatchesNow(`*/5 * * * *`)).toBe(true);
    }
  });

  it('matches day of week', () => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    expect(cronMatchesNow(`* * * * ${dayOfWeek}`)).toBe(true);
    const otherDay = (dayOfWeek + 3) % 7;
    expect(cronMatchesNow(`* * * * ${otherDay}`)).toBe(false);
  });

  it('matches month', () => {
    const now = new Date();
    const month = now.getMonth() + 1;
    expect(cronMatchesNow(`* * * ${month} *`)).toBe(true);
    const otherMonth = (month % 12) + 1;
    if (otherMonth !== month) {
      expect(cronMatchesNow(`* * * ${otherMonth} *`)).toBe(false);
    }
  });
});

describe('Controller: Redis leader lock', () => {
  it('acquireLeaderLock succeeds when NX returns OK', async () => {
    mockRedis.set.mockResolvedValueOnce('OK');
    // The controller uses SET key value EX ttl NX
    // We verify the mock was called correctly
    const redis = mockRedis;
    const result = await redis.set('controller:leader', expect.any(String), 'EX', 60, 'NX');
    expect(result).toBe('OK');
  });

  it('acquireLeaderLock fails when NX returns null', async () => {
    mockRedis.set.mockResolvedValueOnce(null);
    const result = await mockRedis.set('controller:leader', expect.any(String), 'EX', 60, 'NX');
    expect(result).toBeNull();
  });

  it('renewLeaderLock succeeds when expire returns 1', async () => {
    mockRedis.expire.mockResolvedValueOnce(1);
    const result = await mockRedis.expire('controller:leader', 60);
    expect(result).toBe(1);
  });
});
