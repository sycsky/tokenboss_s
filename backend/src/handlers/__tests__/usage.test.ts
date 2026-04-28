import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

// Mock the newapi module before importing the handler so its top-level
// `import { newapi }` picks up our test double.
vi.mock('../../lib/newapi.js', async (orig) => {
  const real = await orig<typeof import('../../lib/newapi.js')>();
  return {
    ...real,
    newapi: {
      getLogs: vi.fn(),
      getUser: vi.fn(),
    },
  };
});

import { init, putUser } from '../../lib/store.js';
import { usageHandler } from '../usageHandlers.js';
import { newapi } from '../../lib/newapi.js';

const getLogsMock = newapi.getLogs as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.SQLITE_PATH = ':memory:';
  init();
  putUser({
    userId: 'u_1',
    email: 'a@x.com',
    createdAt: new Date().toISOString(),
    plan: 'trial',
    newapiUserId: 42,
  });
  getLogsMock.mockReset();
});

function makeEvt(qs: Record<string, string> = {}, headers: Record<string, string> = {}) {
  return {
    headers: { 'x-tb-user-id': 'u_1', ...headers },
    queryStringParameters: qs,
  } as unknown as Parameters<typeof usageHandler>[0];
}

function logEntry(over: Partial<{
  id: number; quota: number; model_name: string; token_name: string;
  prompt_tokens: number; completion_tokens: number; created_at: number;
}> = {}) {
  return {
    id: over.id ?? 1,
    user_id: 42,
    created_at: over.created_at ?? Math.floor(Date.now() / 1000),
    type: 2,
    content: '',
    username: 'u_1',
    token_name: over.token_name ?? 'default',
    model_name: over.model_name ?? 'sonnet',
    quota: over.quota ?? 50_000, // 50k units = $0.10
    prompt_tokens: over.prompt_tokens ?? 100,
    completion_tokens: over.completion_tokens ?? 50,
    channel_id: 1,
    request_id: 'r1',
    group: 'default',
  };
}

describe('usageHandler (newapi-backed)', () => {
  it('returns records + totals + hourly24h shape', async () => {
    const items = [
      logEntry({ id: 1, quota: 50_000 }),
      logEntry({ id: 2, quota: 25_000, model_name: 'gpt-mini' }),
    ];
    getLogsMock.mockResolvedValue({ items, total: 2, page: 0, page_size: 50 });

    const res = (await usageHandler(makeEvt())) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.records).toHaveLength(2);
    expect(body.records[0].amountUsd).toBeCloseTo(0.1, 3);
    expect(body.records[0].eventType).toBe('consume');
    expect(body.totals.consumed).toBeCloseTo(0.15, 3);
    expect(body.totals.calls).toBe(2);
    expect(body.hourly24h).toHaveLength(24);
  });

  it('returns 400 for invalid eventType', async () => {
    getLogsMock.mockResolvedValue({ items: [], total: 0, page: 0, page_size: 50 });
    const res = (await usageHandler(makeEvt({ eventType: 'invalid_type' }))) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body!);
    expect(body.error.code).toBe('invalid_event_type');
  });

  it('non-consume eventType returns empty (newapi only knows consumes)', async () => {
    const res = (await usageHandler(makeEvt({ eventType: 'reset' }))) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.records).toEqual([]);
    expect(body.totals.calls).toBe(0);
  });

  it('returns empty bucket for users without a newapi link', async () => {
    putUser({
      userId: 'u_unlinked',
      email: 'b@x.com',
      createdAt: new Date().toISOString(),
      plan: 'trial',
    });
    const res = (await usageHandler(
      makeEvt({}, { 'x-tb-user-id': 'u_unlinked' }),
    )) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(res.body!);
    expect(body.records).toEqual([]);
    expect(body.totals.calls).toBe(0);
    expect(body.hourly24h).toHaveLength(24);
  });

  it('aggregateBy=keyHint groups by token_name', async () => {
    getLogsMock.mockResolvedValue({
      items: [
        logEntry({ id: 1, token_name: 'cursor', quota: 100_000 }),
        logEntry({ id: 2, token_name: 'cursor', quota: 50_000 }),
        logEntry({ id: 3, token_name: 'mac', quota: 200_000 }),
      ],
      total: 3, page: 0, page_size: 1000,
    });
    const res = (await usageHandler(makeEvt({ aggregateBy: 'keyHint' }))) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(res.body!);
    expect(body.groups).toHaveLength(2);
    const cursor = body.groups.find((g: { groupKey: string }) => g.groupKey === 'cursor');
    expect(cursor.callCount).toBe(2);
    expect(cursor.totalConsumedUsd).toBeCloseTo(0.3, 3);
  });

  it('aggregateBy=source returns single null-keyed group (newapi has no source)', async () => {
    getLogsMock.mockResolvedValue({
      items: [
        logEntry({ id: 1, quota: 50_000 }),
        logEntry({ id: 2, quota: 25_000 }),
      ],
      total: 2, page: 0, page_size: 1000,
    });
    const res = (await usageHandler(makeEvt({ aggregateBy: 'source' }))) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(res.body!);
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0].groupKey).toBeNull();
    expect(body.groups[0].callCount).toBe(2);
  });
});
