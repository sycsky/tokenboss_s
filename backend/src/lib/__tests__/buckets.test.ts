import { describe, it, expect, beforeEach } from 'vitest';
import { init, createBucket } from '../store.js';
import { consumeForRequest } from '../buckets.js';

beforeEach(() => {
  process.env.SQLITE_PATH = ':memory:';
  init();
});

describe('consumeForRequest', () => {
  it('drains 套餐 first then 充值', () => {
    createBucket({
      userId: 'u_1', skuType: 'plan_plus', amountUsd: 840, dailyCapUsd: 30,
      dailyRemainingUsd: 5, totalRemainingUsd: null,
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 28*86400e3).toISOString(),
      modeLock: 'auto_only', modelPool: 'codex_only',
    });
    createBucket({
      userId: 'u_1', skuType: 'topup', amountUsd: 100, dailyCapUsd: null,
      dailyRemainingUsd: null, totalRemainingUsd: 100,
      startedAt: new Date().toISOString(), expiresAt: null,
      modeLock: 'none', modelPool: 'all',
    });

    const result = consumeForRequest({
      userId: 'u_1',
      mode: 'auto',
      modelId: 'gpt-5.5-mini',
      modelTier: 'eco',
      costUsd: 8,
    });

    expect(result.ok).toBe(true);
    expect(result.consumed.length).toBe(2);
    expect(result.consumed[0].bucketSkuType).toBe('plan_plus');
    expect(result.consumed[0].amount).toBe(5);
    expect(result.consumed[1].bucketSkuType).toBe('topup');
    expect(result.consumed[1].amount).toBe(3);
  });

  it('returns model_locked when Plus tries Claude in Manual mode', () => {
    createBucket({
      userId: 'u_2', skuType: 'plan_plus', amountUsd: 840, dailyCapUsd: 30,
      dailyRemainingUsd: 30, totalRemainingUsd: null,
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 28*86400e3).toISOString(),
      modeLock: 'auto_only', modelPool: 'codex_only',
    });
    const result = consumeForRequest({
      userId: 'u_2',
      mode: 'manual',
      modelId: 'claude-4.7-sonnet',
      modelTier: 'premium',
      costUsd: 0.5,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('model_locked');
  });

  it('returns insufficient_balance when no bucket has enough', () => {
    const result = consumeForRequest({
      userId: 'u_3',
      mode: 'auto',
      modelId: 'gpt-5.5',
      modelTier: 'standard',
      costUsd: 0.1,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('insufficient_balance');
  });
});
