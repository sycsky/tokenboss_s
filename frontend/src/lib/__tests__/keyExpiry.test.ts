import { describe, it, expect, vi, afterEach } from 'vitest';
import { isExpired, expiryLabel } from '../keyExpiry';

afterEach(() => vi.useRealTimers());

describe('isExpired', () => {
  it('returns false when expiresAt is null', () => {
    expect(isExpired({ expiresAt: null })).toBe(false);
  });

  it('returns false when expiresAt is in the future', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(isExpired({ expiresAt: future })).toBe(false);
  });

  it('returns true when expiresAt is in the past', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(isExpired({ expiresAt: past })).toBe(true);
  });
});

describe('expiryLabel', () => {
  it('returns "永久" when expiresAt is null', () => {
    expect(expiryLabel({ expiresAt: null })).toBe('永久');
  });

  it('returns "X 天后过期" when in the future (>= 1 day)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-02T12:00:00Z'));
    const in23Days = new Date('2026-05-25T12:00:00Z').toISOString();
    expect(expiryLabel({ expiresAt: in23Days })).toBe('23 天后过期');
  });

  it('returns "今天到期" when expires today (within 24h, not yet expired)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-02T12:00:00Z'));
    const in6Hours = new Date('2026-05-02T18:00:00Z').toISOString();
    expect(expiryLabel({ expiresAt: in6Hours })).toBe('今天到期');
  });

  it('returns "已过期 N 天" when in the past', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-13T12:00:00Z'));
    const days12Ago = new Date('2026-05-01T12:00:00Z').toISOString();
    expect(expiryLabel({ expiresAt: days12Ago })).toBe('已过期 12 天');
  });
});
