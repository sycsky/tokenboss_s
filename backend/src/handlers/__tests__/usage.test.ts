import { describe, it, expect, beforeEach } from 'vitest';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { init, logUsage, getHourlyUsage24h } from '../../lib/store.js';
import { usageHandler } from '../usageHandlers.js';

beforeEach(() => {
  process.env.SQLITE_PATH = ':memory:';
  init();
});

describe('usageHandler', () => {
  it('returns records + totals + hourly24h', async () => {
    logUsage({ userId: 'u_1', bucketId: null, eventType: 'consume', amountUsd: 0.027, model: 'sonnet', source: 'OpenClaw', tokensIn: 100, tokensOut: 50 });
    logUsage({ userId: 'u_1', bucketId: null, eventType: 'consume', amountUsd: 0.011, model: 'gpt-mini', source: 'OpenClaw', tokensIn: 80, tokensOut: 40 });
    logUsage({ userId: 'u_1', bucketId: null, eventType: 'reset', amountUsd: 30, model: null, source: null, tokensIn: null, tokensOut: null });

    const evt = {
      headers: { 'x-tb-user-id': 'u_1' },
      queryStringParameters: {},
    } as any;
    const res = await usageHandler(evt) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.records.length).toBeGreaterThan(0);
    expect(body.totals.consumed).toBeCloseTo(0.038, 3);
    expect(body.totals.calls).toBe(2);
    expect(body.hourly24h).toHaveLength(24);
  });

  it('filters by eventType', async () => {
    logUsage({ userId: 'u_2', bucketId: null, eventType: 'consume', amountUsd: 0.5, model: 'sonnet', source: null, tokensIn: 100, tokensOut: 50 });
    logUsage({ userId: 'u_2', bucketId: null, eventType: 'reset', amountUsd: 30, model: null, source: null, tokensIn: null, tokensOut: null });

    const evt = {
      headers: { 'x-tb-user-id': 'u_2' },
      queryStringParameters: { eventType: 'consume' },
    } as any;
    const res = await usageHandler(evt) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(res.body!);
    expect(body.records.every((r: any) => r.eventType === 'consume')).toBe(true);
  });

  it('hourly24h always has 24 buckets with HH:00 format', async () => {
    const evt = {
      headers: { 'x-tb-user-id': 'u_3' },
      queryStringParameters: {},
    } as any;
    const res = await usageHandler(evt) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(res.body!);
    expect(body.hourly24h).toHaveLength(24);
    for (const bucket of body.hourly24h) {
      expect(bucket.hour).toMatch(/^\d{2}:00$/);
      expect(typeof bucket.consumed).toBe('number');
    }
  });

  it('returns 400 for invalid eventType', async () => {
    const evt = {
      headers: { 'x-tb-user-id': 'u_4' },
      queryStringParameters: { eventType: 'invalid_type' },
    } as any;
    const res = await usageHandler(evt) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body!);
    expect(body.error.code).toBe('invalid_event_type');
  });

  it('totals reflect only consume events regardless of filter', async () => {
    logUsage({ userId: 'u_5', bucketId: null, eventType: 'consume', amountUsd: 1.0, model: 'sonnet', source: null, tokensIn: 100, tokensOut: 50 });
    logUsage({ userId: 'u_5', bucketId: null, eventType: 'consume', amountUsd: 2.0, model: 'sonnet', source: null, tokensIn: 200, tokensOut: 100 });
    logUsage({ userId: 'u_5', bucketId: null, eventType: 'reset', amountUsd: 30, model: null, source: null, tokensIn: null, tokensOut: null });

    // Query with reset filter — totals should still reflect consume events
    const evt = {
      headers: { 'x-tb-user-id': 'u_5' },
      queryStringParameters: { eventType: 'reset' },
    } as any;
    const res = await usageHandler(evt) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(res.body!);
    expect(body.records.every((r: any) => r.eventType === 'reset')).toBe(true);
    expect(body.totals.consumed).toBeCloseTo(3.0, 3);
    expect(body.totals.calls).toBe(2);
  });

  it('getHourlyUsage24h returns 24 zero-filled buckets for new user', () => {
    const buckets = getHourlyUsage24h('nobody');
    expect(buckets).toHaveLength(24);
    expect(buckets.every(b => b.consumed === 0)).toBe(true);
  });
});
