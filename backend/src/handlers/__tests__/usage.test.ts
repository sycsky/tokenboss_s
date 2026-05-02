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

import { init, putUser, insertAttribution, db } from '../../lib/store.js';
import { usageHandler, _clearConsumeLogCacheForTests } from '../usageHandlers.js';
import { newapi } from '../../lib/newapi.js';
import { signSession } from '../../lib/authTokens.js';

const getLogsMock = newapi.getLogs as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.SQLITE_PATH = ':memory:';
  process.env.SESSION_SECRET = 'usage-test-session-secret-32bytes-minimum';
  init();
  putUser({
    userId: 'u_1',
    email: 'a@x.com',
    createdAt: new Date().toISOString(),
    plan: 'trial',
    newapiUserId: 42,
  });
  getLogsMock.mockReset();
  _clearConsumeLogCacheForTests();
});

function bearerFor(userId: string): string {
  return `Bearer ${signSession(userId, 0)}`;
}

function makeEvt(qs: Record<string, string> = {}, headers: Record<string, string> = {}) {
  return {
    headers: { authorization: bearerFor('u_1'), ...headers },
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
      makeEvt({}, { authorization: bearerFor('u_unlinked') }),
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

  // Default window = rolling 30d for every user (sub or not). Same
  // logic for everyone — keeps server load bounded and gives a stable
  // "近 30 天" trend that doesn't jump on sub reset.
  it('defaults to rolling 30d when no `from` is provided', async () => {
    getLogsMock.mockResolvedValue({ items: [], total: 0, page: 0, page_size: 100 });
    await usageHandler(makeEvt());

    const expectedMin = Math.floor((Date.now() - 30 * 86400 * 1000) / 1000);
    for (const call of getLogsMock.mock.calls) {
      const ts = call[0].start_timestamp as number;
      // Allow ±2s for clock skew between handler call and assertion.
      expect(ts).toBeGreaterThanOrEqual(expectedMin - 2);
      expect(ts).toBeLessThanOrEqual(expectedMin + 2);
    }
  });

  // Explicit `from` from the client (e.g. UsageHistory's 24h window)
  // must override the 30d default.
  it('respects explicit `from` and skips the 30d default', async () => {
    getLogsMock.mockResolvedValue({ items: [], total: 0, page: 0, page_size: 100 });

    const explicitFrom = '2026-05-01T00:00:00.000Z';
    await usageHandler(makeEvt({ from: explicitFrom }));
    const expectedTs = Math.floor(new Date(explicitFrom).getTime() / 1000);
    for (const call of getLogsMock.mock.calls) {
      expect(call[0].start_timestamp).toBe(expectedTs);
    }
  });

  // 60s in-memory cache: a single dashboard load fires fetchAllConsumeLogs
  // twice (once for totals/hourly, once for keyHint aggregation) — same
  // window, same user, so the second call must hit the cache.
  it('caches fetchAll results so the second handler call in the same window reuses them', async () => {
    let callCount = 0;
    getLogsMock.mockImplementation(async () => {
      callCount++;
      return { items: [logEntry({ id: callCount, quota: 50_000 })], total: 1, page: 0, page_size: 100 };
    });

    // First call: cache miss. Records mode triggers TWO getLogs calls
    // (one for the records page, one inside fetchAll for totals).
    await usageHandler(makeEvt());
    const callsAfterFirst = callCount;
    expect(callsAfterFirst).toBeGreaterThanOrEqual(2);

    // Second call within TTL: records-page call still goes through (not
    // cached), but the fetchAll call should be served from cache.
    await usageHandler(makeEvt());
    expect(callCount).toBe(callsAfterFirst + 1); // only +1, not +2
  });

  // Different windows must NOT share a cache slot — explicit `from`
  // creates a different cache key from the default 30d window.
  it('does not share cache across different `from` windows', async () => {
    let callCount = 0;
    getLogsMock.mockImplementation(async () => {
      callCount++;
      return { items: [], total: 0, page: 0, page_size: 100 };
    });

    await usageHandler(makeEvt());
    const after30d = callCount;
    await usageHandler(makeEvt({ from: '2026-04-01T00:00:00.000Z' }));
    // Different window ⇒ different key ⇒ fetchAll re-runs.
    expect(callCount).toBeGreaterThan(after30d + 1);
  });

  // Regression: newapi caps `size` at 100 server-side regardless of what
  // we ask for. The old loop's "items.length < requestedPerPage" EOF
  // check tripped on page 0 (100 < 1000), freezing totals at 100.
  // Make sure we now paginate until res.total is satisfied.
  it('totals.calls follows newapi total even when server caps page size at 100', async () => {
    // Simulate a user with 250 entries while newapi caps each page at 100.
    const TOTAL = 250;
    const SERVER_CAP = 100;
    const allEntries = Array.from({ length: TOTAL }, (_, i) =>
      logEntry({ id: i + 1, quota: 10_000 }),
    );
    getLogsMock.mockImplementation(async (q: { page?: number; per_page?: number }) => {
      const page = q.page ?? 0;
      // newapi ignores per_page > 100 — clamp like the real server.
      const size = Math.min(q.per_page ?? 50, SERVER_CAP);
      const start = page * size;
      const items = allEntries.slice(start, start + size);
      return { items, total: TOTAL, page, page_size: size };
    });

    const res = (await usageHandler(makeEvt())) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.totals.calls).toBe(TOTAL);
    // 250 entries × 10_000 quota × $1 / 500_000 = $5.00
    expect(body.totals.consumed).toBeCloseTo(250 * (10_000 / 500_000), 3);
  });
});

describe('GET /v1/usage — source attribution soft-join', () => {
  // The soft-join uses the user's TokenBoss userId (auth.userId from the
  // Bearer JWT → 'u_1') + model + ±5s window from each newapi entry's
  // created_at. attribution_capturedAt is the 'now' we set when inserting
  // the row in chatProxy; for tests we generate it close to entry.created_at.
  beforeEach(() => {
    db.exec(`DELETE FROM usage_attribution`);
  });

  it('fills source from attribution when match is in the time window', async () => {
    const entryTs = Math.floor(Date.now() / 1000);
    insertAttribution({
      requestId: 'tb-aaaaaaaa11111111',
      userId: 'u_1',  // matches the test user
      source: 'openclaw',
      sourceMethod: 'header',
      model: 'sonnet',
      capturedAt: new Date(entryTs * 1000).toISOString(),
    });
    getLogsMock.mockResolvedValueOnce({
      items: [logEntry({ created_at: entryTs, model_name: 'sonnet' })],
      total: 1, page: 0, page_size: 200,
    });

    const res = await usageHandler(makeEvt({ limit: '50' })) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.records[0].source).toBe('openclaw');
  });

  it("falls back to 'other' when attribution is outside the time window", async () => {
    const entryTs = Math.floor(Date.now() / 1000);
    insertAttribution({
      requestId: 'tb-bbbbbbbb22222222',
      userId: 'u_1',
      source: 'hermes',
      sourceMethod: 'header',
      model: 'sonnet',
      capturedAt: new Date((entryTs - 60) * 1000).toISOString(), // 60s earlier — outside ±5s window
    });
    getLogsMock.mockResolvedValueOnce({
      items: [logEntry({ created_at: entryTs, model_name: 'sonnet' })],
      total: 1, page: 0, page_size: 200,
    });

    const res = await usageHandler(makeEvt({ limit: '50' })) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(res.body!);
    expect(body.records[0].source).toBe('other');
  });

  it("falls back to 'other' when no attribution rows exist (pre-feature data)", async () => {
    // No insertAttribution calls.
    const entryTs = Math.floor(Date.now() / 1000);
    getLogsMock.mockResolvedValueOnce({
      items: [logEntry({ created_at: entryTs, model_name: 'sonnet' })],
      total: 1, page: 0, page_size: 200,
    });

    const res = await usageHandler(makeEvt({ limit: '50' })) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(res.body!);
    expect(body.records[0].source).toBe('other');
  });

  it('picks the closest attribution when multiple are in the window', async () => {
    const entryTs = Math.floor(Date.now() / 1000);
    // 3 attributions in the window; closest by capturedAt should win.
    insertAttribution({
      requestId: 'tb-cccccccc33333333',
      userId: 'u_1',
      source: 'codex',
      sourceMethod: 'header',
      model: 'sonnet',
      capturedAt: new Date((entryTs - 4) * 1000).toISOString(), // 4s before
    });
    insertAttribution({
      requestId: 'tb-dddddddd44444444',
      userId: 'u_1',
      source: 'openclaw',
      sourceMethod: 'header',
      model: 'sonnet',
      capturedAt: new Date((entryTs + 1) * 1000).toISOString(), // 1s after — closest
    });
    insertAttribution({
      requestId: 'tb-eeeeeeee55555555',
      userId: 'u_1',
      source: 'hermes',
      sourceMethod: 'header',
      model: 'sonnet',
      capturedAt: new Date((entryTs + 4) * 1000).toISOString(), // 4s after
    });
    getLogsMock.mockResolvedValueOnce({
      items: [logEntry({ created_at: entryTs, model_name: 'sonnet' })],
      total: 1, page: 0, page_size: 200,
    });

    const res = await usageHandler(makeEvt({ limit: '50' })) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(res.body!);
    expect(body.records[0].source).toBe('openclaw'); // 1s delta wins over 4s
  });
});
