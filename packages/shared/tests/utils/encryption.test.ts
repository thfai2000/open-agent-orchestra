import { describe, it, expect, beforeAll } from 'vitest';
import { encrypt, decrypt } from '../../src/utils/encryption.js';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
});

describe('encrypt / decrypt', () => {
  it('round-trips a plaintext string', () => {
    const plaintext = 'my-secret-api-key-12345';
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it('produces different ciphertext for the same input (random IV)', () => {
    const a = encrypt('same-input');
    const b = encrypt('same-input');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe('same-input');
    expect(decrypt(b)).toBe('same-input');
  });

  it('handles empty string', () => {
    expect(decrypt(encrypt(''))).toBe('');
  });

  it('handles unicode characters', () => {
    const text = '你好世界 🌍';
    expect(decrypt(encrypt(text))).toBe(text);
  });

  it('handles long strings', () => {
    const text = 'x'.repeat(10000);
    expect(decrypt(encrypt(text))).toBe(text);
  });

  it('fails on tampered ciphertext', () => {
    const enc = encrypt('test');
    const tampered = enc.slice(0, -4) + 'AAAA';
    expect(() => decrypt(tampered)).toThrow();
  });

  it('throws without ENCRYPTION_KEY', () => {
    const orig = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY');
    process.env.ENCRYPTION_KEY = orig;
  });
});
