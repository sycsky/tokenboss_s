import { describe, it, expect, beforeEach } from 'vitest';
import {
  init,
  createBucket,
  getActiveBucketsForUser,
  consumeBucket,
  resetBucketDaily,
  expireBucketDaily,
} from '../store.js';

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

  it('excludes expired subscriptions from getActiveBucketsForUser', () => {
    createBucket({
      userId: 'u_expired', skuType: 'plan_plus', amountUsd: 840, dailyCapUsd: 30,
      dailyRemainingUsd: 5, totalRemainingUsd: null,
      startedAt: new Date(Date.now() - 30*86400e3).toISOString(),
      expiresAt: new Date(Date.now() - 1000).toISOString(), // already expired
      modeLock: 'auto_only', modelPool: 'codex_only',
    });
    expect(getActiveBucketsForUser('u_expired')).toHaveLength(0);
  });
});

describe('credit_bucket mutators', () => {
  it('consumeBucket decrements dailyRemainingUsd for plan bucket', () => {
    const b = createBucket({
      userId: 'u_c1', skuType: 'plan_plus', amountUsd: 840, dailyCapUsd: 30,
      dailyRemainingUsd: 30, totalRemainingUsd: null,
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 28 * 86400e3).toISOString(),
      modeLock: 'auto_only', modelPool: 'codex_only',
    });
    consumeBucket(b.id, 5);
    const after = getActiveBucketsForUser('u_c1')[0];
    expect(after.dailyRemainingUsd).toBe(25);
  });

  it('consumeBucket decrements totalRemainingUsd for topup bucket', () => {
    const b = createBucket({
      userId: 'u_c2', skuType: 'topup', amountUsd: 100, dailyCapUsd: null,
      dailyRemainingUsd: null, totalRemainingUsd: 100,
      startedAt: new Date().toISOString(), expiresAt: null,
      modeLock: 'none', modelPool: 'all',
    });
    consumeBucket(b.id, 30);
    const after = getActiveBucketsForUser('u_c2')[0];
    expect(after.totalRemainingUsd).toBe(70);
  });

  it('resetBucketDaily sets dailyRemainingUsd to cap', () => {
    const b = createBucket({
      userId: 'u_r', skuType: 'plan_plus', amountUsd: 840, dailyCapUsd: 30,
      dailyRemainingUsd: 4.57, totalRemainingUsd: null,
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 28 * 86400e3).toISOString(),
      modeLock: 'auto_only', modelPool: 'codex_only',
    });
    resetBucketDaily(b.id, 30);
    const after = getActiveBucketsForUser('u_r')[0];
    expect(after.dailyRemainingUsd).toBe(30);
  });

  it('expireBucketDaily returns leftover and zeroes remaining', () => {
    const b = createBucket({
      userId: 'u_e', skuType: 'plan_plus', amountUsd: 840, dailyCapUsd: 30,
      dailyRemainingUsd: 4.57, totalRemainingUsd: null,
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 28 * 86400e3).toISOString(),
      modeLock: 'auto_only', modelPool: 'codex_only',
    });
    const leftover = expireBucketDaily(b.id);
    expect(leftover).toBeCloseTo(4.57);
    // After expire, dailyRemainingUsd = 0 → bucket drops out of active list
    expect(getActiveBucketsForUser('u_e')).toHaveLength(0);
  });
});
