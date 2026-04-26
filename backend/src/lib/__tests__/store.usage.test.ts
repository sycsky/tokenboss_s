import { describe, it, expect, beforeEach } from 'vitest';
import { init, logUsage, getUsageForUser } from '../store.js';

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
});
