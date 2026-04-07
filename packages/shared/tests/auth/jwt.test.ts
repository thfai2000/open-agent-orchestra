import { describe, it, expect, beforeAll } from 'vitest';
import { createJwt, verifyJwt } from '../../src/auth/jwt.js';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-key-must-be-at-least-32-chars-long!!';
});

const testUser = {
  userId: '550e8400-e29b-41d4-a716-446655440000',
  email: 'test@example.com',
  name: 'Test User',
  role: 'user',
};

describe('createJwt', () => {
  it('produces a three-segment JWT string', async () => {
    const token = await createJwt(testUser);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('throws when JWT_SECRET is missing', async () => {
    const orig = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    await expect(createJwt(testUser)).rejects.toThrow('JWT_SECRET');
    process.env.JWT_SECRET = orig;
  });
});

describe('verifyJwt', () => {
  it('returns the original payload fields', async () => {
    const token = await createJwt(testUser);
    const payload = await verifyJwt(token);
    expect(payload.userId).toBe(testUser.userId);
    expect(payload.email).toBe(testUser.email);
    expect(payload.name).toBe(testUser.name);
  });

  it('includes iat and exp claims', async () => {
    const token = await createJwt(testUser);
    const payload = await verifyJwt(token);
    expect(payload.iat).toBeDefined();
    expect(payload.exp).toBeDefined();
    expect(payload.exp).toBeGreaterThan(payload.iat!);
  });

  it('rejects an invalid token string', async () => {
    await expect(verifyJwt('invalid.token.value')).rejects.toThrow();
  });

  it('rejects a tampered token', async () => {
    const token = await createJwt(testUser);
    const tampered = token.slice(0, -5) + 'XXXXX';
    await expect(verifyJwt(tampered)).rejects.toThrow();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await createJwt(testUser);
    const origSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'different-secret-key-must-be-at-least-32-chars-long!!';
    await expect(verifyJwt(token)).rejects.toThrow();
    process.env.JWT_SECRET = origSecret;
  });
});
