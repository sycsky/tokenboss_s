import { describe, it, expect, beforeEach } from 'vitest';
import { init, logUsage, getUsageForUser, aggregateUsageForUser } from '../store.js';

beforeEach(() => {
  process.env.SQLITE_PATH = ':memory:';
  init();
});

describe('usage_log', () => {
  it('logs consume event with all fields', () => {
    logUsage({
      userId: 'u_1', bucketId: 'b_1', eventType: 'consume',
      amountUsd: 0.027, model: 'claude-4.7-sonnet', source: 'OpenClaw',
      tokensIn: 800, tokensOut: 443,
    });
    const list = getUsageForUser('u_1', { limit: 10 });
    expect(list).toHaveLength(1);
    expect(list[0].eventType).toBe('consume');
    expect(list[0].amountUsd).toBe(0.027);
  });

  it('logs reset and expire events', () => {
    logUsage({ userId: 'u_2', bucketId: 'b_x', eventType: 'reset', amountUsd: 30, model: null, source: null, tokensIn: null, tokensOut: null });
    logUsage({ userId: 'u_2', bucketId: 'b_x', eventType: 'expire', amountUsd: -4.57, model: null, source: null, tokensIn: null, tokensOut: null });
    const list = getUsageForUser('u_2', { limit: 10 });
    expect(list.map(r => r.eventType)).toEqual(['expire', 'reset']); // newest first
  });

  describe('aggregateUsageForUser', () => {
    it('groups consume events by source with totals', () => {
      logUsage({ userId: 'u_3', bucketId: 'b_1', eventType: 'consume', amountUsd: 0.01, model: 'sonnet', source: 'openclaw', tokensIn: 10, tokensOut: 20 });
      logUsage({ userId: 'u_3', bucketId: 'b_1', eventType: 'consume', amountUsd: 0.02, model: 'sonnet', source: 'openclaw', tokensIn: 10, tokensOut: 30 });
      logUsage({ userId: 'u_3', bucketId: 'b_1', eventType: 'consume', amountUsd: 0.05, model: 'opus',   source: 'hermes',   tokensIn: 20, tokensOut: 80 });
      // Reset events must NOT contribute — bookkeeping only.
      logUsage({ userId: 'u_3', bucketId: 'b_1', eventType: 'reset',   amountUsd: 30,  model: null,    source: null,        tokensIn: null, tokensOut: null });

      const groups = aggregateUsageForUser('u_3', 'source');
      const byKey = Object.fromEntries(groups.map(g => [g.groupKey, g]));

      expect(groups).toHaveLength(2);
      expect(byKey.openclaw.callCount).toBe(2);
      expect(byKey.openclaw.totalConsumedUsd).toBeCloseTo(0.03, 6);
      expect(byKey.hermes.callCount).toBe(1);
      expect(byKey.hermes.totalConsumedUsd).toBeCloseTo(0.05, 6);
    });

    it('groups by keyHint and ignores non-consume events', () => {
      logUsage({ userId: 'u_4', bucketId: 'b_1', eventType: 'consume', amountUsd: 0.10, model: 'sonnet', source: 'openclaw', keyHint: 'AAAAbbbb', tokensIn: 1, tokensOut: 1 });
      logUsage({ userId: 'u_4', bucketId: 'b_1', eventType: 'consume', amountUsd: 0.20, model: 'sonnet', source: 'openclaw', keyHint: 'AAAAbbbb', tokensIn: 1, tokensOut: 1 });
      logUsage({ userId: 'u_4', bucketId: 'b_1', eventType: 'consume', amountUsd: 0.30, model: 'opus',   source: 'hermes',   keyHint: 'CCCCdddd', tokensIn: 1, tokensOut: 1 });

      const groups = aggregateUsageForUser('u_4', 'keyHint');
      expect(groups).toHaveLength(2);
      const top = groups[0]; // ORDER BY lastUsedAt DESC, the most recent insert wins
      expect(top.groupKey).toBe('CCCCdddd');
      expect(top.callCount).toBe(1);
      const other = groups.find(g => g.groupKey === 'AAAAbbbb');
      expect(other?.callCount).toBe(2);
      expect(other?.totalConsumedUsd).toBeCloseTo(0.30, 6);
    });
  });
});
