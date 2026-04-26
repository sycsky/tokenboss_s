import { describe, it, expect, beforeEach } from 'vitest';
import { init, saveVerificationCode, consumeVerificationCode } from '../store.js';

beforeEach(() => {
  process.env.SQLITE_PATH = ':memory:';
  init();
});

describe('verification_codes', () => {
  it('saves and consumes a 6-digit code', () => {
    saveVerificationCode('a@b.com', '123456', 300);
    expect(consumeVerificationCode('a@b.com', '123456')).toBe(true);
    expect(consumeVerificationCode('a@b.com', '123456')).toBe(false); // single-use
  });
  it('rejects expired codes', () => {
    saveVerificationCode('a@b.com', '111111', -1);
    expect(consumeVerificationCode('a@b.com', '111111')).toBe(false);
  });
  it('rejects wrong code', () => {
    saveVerificationCode('a@b.com', '222222', 300);
    expect(consumeVerificationCode('a@b.com', '999999')).toBe(false);
  });
});
