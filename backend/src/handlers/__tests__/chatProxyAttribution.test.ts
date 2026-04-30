import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';

process.env.SESSION_SECRET = 'test-secret-32bytes-min-aaaaaaaaaaa';
process.env.SQLITE_PATH = ':memory:';
process.env.MOCK_UPSTREAM = '1';            // chatProxyCore synthesizes a fake response
process.env.UPSTREAM_API_URL = 'http://upstream.test.local';
process.env.NEWAPI_BASE_URL = 'http://newapi.test.local';

import { init, db, putUser, putApiKeyIndex } from '../../lib/store.js';
import { streamChatCore } from '../../lib/chatProxyCore.js';

const userId = 'u_proxy_test';
const rawKey = 'sk-test-12345678';
const keyHash = createHash('sha256').update(rawKey).digest('hex');

beforeAll(() => {
  init();
  putUser({
    userId,
    email: 'proxy@test.local',
    createdAt: new Date().toISOString(),
    newapiUserId: 100,
    newapiPassword: 'pwd',
  });
  putApiKeyIndex({ userId, newapiTokenId: 1, keyHash });
});

function captureWriter() {
  let status = 0;
  const headers: Record<string, string> = {};
  const chunks: string[] = [];
  return {
    writer: {
      writeHead(s: number, h: Record<string, string>) { status = s; Object.assign(headers, h); },
      write(c: Uint8Array | string) {
        chunks.push(typeof c === 'string' ? c : new TextDecoder().decode(c));
      },
      end() {},
    },
    get status() { return status; },
    get headers() { return headers; },
    get capturedHeader() {
      return headers['x-request-id'] ?? null;
    },
  };
}

function chatEvent(extraHeaders: Record<string, string> = {}, model = 'gpt-4o-mini') {
  return {
    headers: { authorization: `Bearer ${rawKey}`, ...extraHeaders },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
    isBase64Encoded: false,
  } as any;
}

beforeEach(() => {
  // Clear attribution rows between tests so assertions are deterministic.
  db.exec(`DELETE FROM usage_attribution`);
});

describe('chatProxy — attribution capture', () => {
  it('writes attribution row with source=openclaw / method=header when X-Source set', async () => {
    const cap = captureWriter();
    await streamChatCore(chatEvent({ 'x-source': 'openclaw' }), cap.writer);
    const rows = db.prepare(`SELECT * FROM usage_attribution`).all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(userId);
    expect(rows[0].source).toBe('openclaw');
    expect(rows[0].sourceMethod).toBe('header');
    expect(rows[0].model).toBe('gpt-4o-mini');
    expect(rows[0].requestId).toMatch(/^tb-[0-9a-f]{8}$/);
  });

  it('falls back to UA when no X-Source', async () => {
    const cap = captureWriter();
    await streamChatCore(chatEvent({ 'user-agent': 'hermes-cli/1.0' }), cap.writer);
    const rows = db.prepare(`SELECT * FROM usage_attribution`).all() as any[];
    expect(rows[0].source).toBe('hermes');
    expect(rows[0].sourceMethod).toBe('ua');
  });

  it("falls back to 'other' when neither X-Source nor UA matches", async () => {
    const cap = captureWriter();
    await streamChatCore(chatEvent({ 'user-agent': 'curl/8.0' }), cap.writer);
    const rows = db.prepare(`SELECT * FROM usage_attribution`).all() as any[];
    expect(rows[0].source).toBe('other');
    expect(rows[0].sourceMethod).toBe('fallback');
  });

  it('skips attribution when bearer key is unknown (no api_key_index entry)', async () => {
    const cap = captureWriter();
    const evt = {
      headers: { authorization: 'Bearer sk-unknown-99999999', 'x-source': 'openclaw' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }),
      isBase64Encoded: false,
    } as any;
    await streamChatCore(evt, cap.writer);
    const rows = db.prepare(`SELECT * FROM usage_attribution`).all() as any[];
    expect(rows).toHaveLength(0);
  });

  it('respects SOURCE_ATTRIBUTION=off env (no row written)', async () => {
    process.env.SOURCE_ATTRIBUTION = 'off';
    const cap = captureWriter();
    await streamChatCore(chatEvent({ 'x-source': 'openclaw' }), cap.writer);
    const rows = db.prepare(`SELECT * FROM usage_attribution`).all() as any[];
    expect(rows).toHaveLength(0);
    delete process.env.SOURCE_ATTRIBUTION;
  });

  it('attribution write failure does not block the chat response', async () => {
    const spy = vi.spyOn(await import('../../lib/store.js'), 'insertAttribution').mockImplementation(() => {
      throw new Error('synthetic SQLite failure');
    });
    const cap = captureWriter();
    await streamChatCore(chatEvent({ 'x-source': 'openclaw' }), cap.writer);
    expect(cap.status).toBeGreaterThanOrEqual(200);
    expect(cap.status).toBeLessThan(500);
    spy.mockRestore();
  });
});
