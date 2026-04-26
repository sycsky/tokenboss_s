import { describe, it, expect, beforeEach } from 'vitest';
import { init, createBucket, getActiveBucketsForUser } from '../store.js';

beforeEach(() => {
  process.env.SQLITE_PATH = ':memory:';
  init();
});

describe('credit_bucket', () => {
  it('createBucket inserts a plus subscription', () => {
    const b = createBucket({
      userId: 'u_1',
      skuType: 'plan_plus',
      amountUsd: 840,
      dailyCapUsd: 30,
      dailyRemainingUsd: 30,
      totalRemainingUsd: null,
      startedAt: new Date('2026-04-26T00:00:00Z').toISOString(),
      expiresAt: new Date('2026-05-24T00:00:00Z').toISOString(),
      modeLock: 'auto_only',
      modelPool: 'codex_only',
    });
    expect(b.id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('getActiveBucketsForUser returns active buckets in consume priority', () => {
    createBucket({
      userId: 'u_2', skuType: 'topup', amountUsd: 100, dailyCapUsd: null,
      dailyRemainingUsd: null, totalRemainingUsd: 100,
      startedAt: new Date().toISOString(), expiresAt: null,
      modeLock: 'none', modelPool: 'all',
    });
    createBucket({
      userId: 'u_2', skuType: 'plan_plus', amountUsd: 840, dailyCapUsd: 30,
      dailyRemainingUsd: 30, totalRemainingUsd: null,
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 28 * 86400e3).toISOString(),
      modeLock: 'auto_only', modelPool: 'codex_only',
    });
    const list = getActiveBucketsForUser('u_2');
    // 套餐 first (套餐 → 充值)
    expect(list[0].skuType).toBe('plan_plus');
    expect(list[1].skuType).toBe('topup');
  });
});
