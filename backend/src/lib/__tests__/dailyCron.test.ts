import { describe, it, expect, beforeEach } from 'vitest';
import { init, createBucket, getActiveBucketsForUser, getUsageForUser } from '../store.js';
import { runDailyExpireAndReset } from '../dailyCron.js';

beforeEach(() => {
  process.env.SQLITE_PATH = ':memory:';
  init();
});

describe('runDailyExpireAndReset', () => {
  it('expires (−剩余) then resets (+cap) for plan_plus with leftover', () => {
    createBucket({
      userId: 'u_1', skuType: 'plan_plus', amountUsd: 840, dailyCapUsd: 30,
      dailyRemainingUsd: 4.57, totalRemainingUsd: null,
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 28*86400e3).toISOString(),
      modeLock: 'auto_only', modelPool: 'codex_only',
    });
    runDailyExpireAndReset();

    const buckets = getActiveBucketsForUser('u_1');
    expect(buckets[0].dailyRemainingUsd).toBe(30);

    const events = getUsageForUser('u_1', { limit: 10 });
    const eventTypes = events.map(e => e.eventType);
    expect(eventTypes).toContain('expire');
    expect(eventTypes).toContain('reset');
    const expire = events.find(e => e.eventType === 'expire')!;
    expect(expire.amountUsd).toBeCloseTo(-4.57);
    const reset = events.find(e => e.eventType === 'reset')!;
    expect(reset.amountUsd).toBe(30);
  });

  it('skips expire when remaining = 0 (yesterday used full cap)', () => {
    createBucket({
      userId: 'u_2', skuType: 'plan_plus', amountUsd: 840, dailyCapUsd: 30,
      dailyRemainingUsd: 0, totalRemainingUsd: null,
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 28*86400e3).toISOString(),
      modeLock: 'auto_only', modelPool: 'codex_only',
    });
    runDailyExpireAndReset();
    const events = getUsageForUser('u_2', { limit: 10 });
    expect(events.filter(e => e.eventType === 'expire')).toHaveLength(0);
    expect(events.filter(e => e.eventType === 'reset')).toHaveLength(1);
  });

  it('does not touch topup buckets', () => {
    createBucket({
      userId: 'u_3', skuType: 'topup', amountUsd: 100, dailyCapUsd: null,
      dailyRemainingUsd: null, totalRemainingUsd: 50,
      startedAt: new Date().toISOString(), expiresAt: null,
      modeLock: 'none', modelPool: 'all',
    });
    runDailyExpireAndReset();
    const events = getUsageForUser('u_3', { limit: 10 });
    expect(events).toHaveLength(0);
  });

  it('does not touch expired subscriptions', () => {
    createBucket({
      userId: 'u_4', skuType: 'plan_plus', amountUsd: 840, dailyCapUsd: 30,
      dailyRemainingUsd: 5, totalRemainingUsd: null,
      startedAt: new Date(Date.now() - 30*86400e3).toISOString(),
      expiresAt: new Date(Date.now() - 1).toISOString(),
      modeLock: 'auto_only', modelPool: 'codex_only',
    });
    runDailyExpireAndReset();
    const events = getUsageForUser('u_4', { limit: 10 });
    expect(events).toHaveLength(0);
  });
});
