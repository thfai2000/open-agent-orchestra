import { describe, it, expect } from 'vitest';
import { emailSchema, passwordSchema, uuidSchema, paginationSchema } from '../../src/utils/validation.js';

describe('emailSchema', () => {
  it('accepts valid email addresses', () => {
    expect(emailSchema.parse('user@example.com')).toBe('user@example.com');
    expect(emailSchema.parse('a.b+tag@test.co.uk')).toBe('a.b+tag@test.co.uk');
    expect(emailSchema.parse('name@sub.domain.org')).toBe('name@sub.domain.org');
  });

  it('rejects empty string', () => {
    expect(() => emailSchema.parse('')).toThrow();
  });

  it('rejects missing @ symbol', () => {
    expect(() => emailSchema.parse('not-an-email')).toThrow();
  });

  it('rejects missing local part', () => {
    expect(() => emailSchema.parse('@example.com')).toThrow();
  });

  it('rejects emails exceeding max length', () => {
    expect(() => emailSchema.parse('a'.repeat(250) + '@b.com')).toThrow();
  });
});

describe('passwordSchema', () => {
  it('accepts password at minimum length (8 chars)', () => {
    expect(passwordSchema.parse('12345678')).toBe('12345678');
  });

  it('accepts password at maximum length (100 chars)', () => {
    const pw = 'x'.repeat(100);
    expect(passwordSchema.parse(pw)).toBe(pw);
  });

  it('rejects password shorter than 8 chars', () => {
    expect(() => passwordSchema.parse('1234567')).toThrow();
  });

  it('rejects password longer than 100 chars', () => {
    expect(() => passwordSchema.parse('x'.repeat(101))).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => passwordSchema.parse('')).toThrow();
  });
});

describe('uuidSchema', () => {
  it('accepts a valid v4 UUID', () => {
    expect(uuidSchema.parse('550e8400-e29b-41d4-a716-446655440000')).toBeTruthy();
  });

  it('rejects a non-UUID string', () => {
    expect(() => uuidSchema.parse('not-a-uuid')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => uuidSchema.parse('')).toThrow();
  });

  it('rejects UUID with missing segment', () => {
    expect(() => uuidSchema.parse('550e8400-e29b-41d4-a716')).toThrow();
  });
});

describe('paginationSchema', () => {
  it('applies default page=1 and limit=50', () => {
    const result = paginationSchema.parse({});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(50);
  });

  it('parses string values to numbers', () => {
    const result = paginationSchema.parse({ page: '3', limit: '25' });
    expect(result.page).toBe(3);
    expect(result.limit).toBe(25);
  });

  it('rejects limit below 1', () => {
    expect(() => paginationSchema.parse({ limit: '0' })).toThrow();
  });

  it('rejects limit above 200', () => {
    expect(() => paginationSchema.parse({ limit: '201' })).toThrow();
  });

  it('rejects non-positive page', () => {
    expect(() => paginationSchema.parse({ page: '0' })).toThrow();
    expect(() => paginationSchema.parse({ page: '-1' })).toThrow();
  });

  it('accepts boundary values', () => {
    const min = paginationSchema.parse({ page: '1', limit: '1' });
    expect(min.page).toBe(1);
    expect(min.limit).toBe(1);

    const max = paginationSchema.parse({ limit: '200' });
    expect(max.limit).toBe(200);
  });
});
