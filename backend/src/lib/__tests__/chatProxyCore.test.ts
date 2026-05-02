import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
  init,
  putUser,
  putApiKeyIndex,
  setUserPlan,
} from '../store.js';
import {
  inferTierFromModelId,
  extractKeyHint,
  maybeInterceptUpstreamError,
  type StreamWriter,
} from '../chatProxyCore.js';

beforeEach(() => {
  process.env.SQLITE_PATH = ':memory:';
  init();
});

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

// --- inferTierFromModelId is the only signal chatProxyCore uses to decide
// whether a free user's request needs to be silently rewritten. Cover the
// common cases. -----------------------------------------------------------

describe('inferTierFromModelId', () => {
  it('virtual profiles all map to eco (resolved later)', () => {
    expect(inferTierFromModelId('auto')).toBe('eco');
    expect(inferTierFromModelId('eco')).toBe('eco');
    expect(inferTierFromModelId('premium')).toBe('eco');
    expect(inferTierFromModelId('agentic')).toBe('eco');
  });
  it('haiku / mini / flash → eco', () => {
    expect(inferTierFromModelId('claude-haiku-4.5')).toBe('eco');
    expect(inferTierFromModelId('gpt-5-mini')).toBe('eco');
    expect(inferTierFromModelId('gemini-flash')).toBe('eco');
  });
  it('opus → premium', () => {
    expect(inferTierFromModelId('claude-opus-4.7')).toBe('premium');
  });
  it('sonnet / gpt-4o → standard', () => {
    expect(inferTierFromModelId('claude-sonnet-4.6')).toBe('standard');
    expect(inferTierFromModelId('gpt-4o')).toBe('standard');
  });
  it('o1 / o3 / gpt-5 (non-mini) → reasoning', () => {
    expect(inferTierFromModelId('o1')).toBe('reasoning');
    expect(inferTierFromModelId('o3')).toBe('reasoning');
    expect(inferTierFromModelId('gpt-5')).toBe('reasoning');
  });
});

// --- extractKeyHint kept for log attribution. ---------------------------

describe('extractKeyHint', () => {
  it('strips Bearer prefix and returns last 8 chars', () => {
    expect(extractKeyHint('Bearer sk-1234567890abcdef')).toBe('90abcdef');
  });
  it('returns null for missing header', () => {
    expect(extractKeyHint(undefined)).toBeNull();
  });
  it('handles a raw token (no Bearer prefix)', () => {
    expect(extractKeyHint('sk-rawkey12345678')).toBe('12345678');
  });
});

// --- Free-user rewrite end-to-end smoke test (via api_key_index lookup).
// The actual rewrite happens inside streamChatCore which needs a full
// upstream + writer harness; here we only verify that the wiring (store
// helpers + plan check) returns the data chatProxyCore relies on. ------

describe('plan resolution wiring (V3)', () => {
  it('getUserIdByKeyHash resolves a hashed sk-xxx to userId', async () => {
    const { getUserIdByKeyHash, getUser } = await import('../store.js');
    putUser({
      userId: 'u_alice',
      email: 'a@x.com',
      createdAt: new Date().toISOString(),
      plan: 'trial',
    });
    putApiKeyIndex({
      userId: 'u_alice',
      newapiTokenId: 1,
      keyHash: sha256('sk-alice'),
    });

    const uid = getUserIdByKeyHash(sha256('sk-alice'));
    expect(uid).toBe('u_alice');
    const u = await getUser(uid as string);
    expect(u?.plan).toBe('trial');
  });

  it('paid users have a non-trial plan after setUserPlan', async () => {
    const { getUserIdByKeyHash, getUser } = await import('../store.js');
    putUser({
      userId: 'u_bob',
      email: 'b@x.com',
      createdAt: new Date().toISOString(),
      plan: 'trial',
    });
    setUserPlan('u_bob', {
      plan: 'plus',
      subscriptionStartedAt: new Date().toISOString(),
      subscriptionExpiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
      dailyQuotaUsd: 30,
    });
    putApiKeyIndex({
      userId: 'u_bob',
      newapiTokenId: 2,
      keyHash: sha256('sk-bob'),
    });

    const uid = getUserIdByKeyHash(sha256('sk-bob'));
    expect(uid).toBe('u_bob');
    const u = await getUser(uid as string);
    expect(u?.plan).toBe('plus');
    expect(u?.dailyQuotaUsd).toBe(30);
  });

  it('returns null userId for an unknown sk-xxx (anonymous direct caller)', async () => {
    const { getUserIdByKeyHash } = await import('../store.js');
    expect(getUserIdByKeyHash(sha256('sk-stranger'))).toBeNull();
  });
});

// --- maybeInterceptUpstreamError covers the "out of credits" UX. The
// upstream (newapi) returns a Chinese 403 body that Codex CLI / Claude Code
// cannot interpret as a payment issue, so they retry as if it were a network
// error. The intercept rewrites it to a 402 with a friendly top-up message.

interface FakeWriter extends StreamWriter {
  status?: number;
  headers?: Record<string, string>;
  body: string;
  ended: boolean;
}

function makeFakeWriter(): FakeWriter {
  const w: FakeWriter = {
    body: '',
    ended: false,
    writeHead(statusCode, headers) {
      w.status = statusCode;
      w.headers = headers;
    },
    write(chunk) {
      w.body += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    },
    end() {
      w.ended = true;
    },
  };
  return w;
}

describe('maybeInterceptUpstreamError', () => {
  it('rewrites Chinese newapi 用户额度不足 403 to 402 + friendly top-up message', async () => {
    const upstream = new Response(
      JSON.stringify({
        error:
          '用户额度不足, 剩余额度: ＄0.000000 (request id: 202605010622449630926638268d9d6Glf56mdI)',
      }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    );
    const writer = makeFakeWriter();
    const handled = await maybeInterceptUpstreamError(upstream, writer);
    expect(handled).toBe(true);
    expect(writer.status).toBe(402);
    expect(writer.ended).toBe(true);
    const parsed = JSON.parse(writer.body);
    expect(parsed.error.type).toBe('insufficient_balance');
    expect(parsed.error.message).toBe(
      '余额已用完，充值后继续 → https://tokenboss.co/console',
    );
  });

  it('rewrites English "insufficient balance" 402 to friendly message too', async () => {
    const upstream = new Response(
      JSON.stringify({ error: { message: 'insufficient balance for request' } }),
      { status: 402, headers: { 'content-type': 'application/json' } },
    );
    const writer = makeFakeWriter();
    const handled = await maybeInterceptUpstreamError(upstream, writer);
    expect(handled).toBe(true);
    expect(writer.status).toBe(402);
    expect(JSON.parse(writer.body).error.type).toBe('insufficient_balance');
  });

  it.each([
    ['余额已用完', '账户余额已用完，请充值'],
    ['余额耗尽', '余额耗尽，无法继续请求'],
    ['配额已用完', '本月配额已用完'],
    ['配额不足', '配额不足'],
    ['欠费', '账户欠费，请补缴'],
    ['OpenAI insufficient_quota', '{"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}'],
    ['Anthropic credit balance low', 'Your credit balance is too low to access the API'],
  ])('rewrites %s body to friendly message', async (_label, body) => {
    const upstream = new Response(body, {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
    const writer = makeFakeWriter();
    const handled = await maybeInterceptUpstreamError(upstream, writer);
    expect(handled).toBe(true);
    expect(writer.status).toBe(402);
    expect(JSON.parse(writer.body).error.type).toBe('insufficient_balance');
  });

  it('does NOT rewrite a 4xx that only contains 剩余额度 as a status field', async () => {
    // Defensive: 剩余额度 alone (e.g. as a label in an unrelated 4xx body)
    // must not trigger the rewrite — it could be a positive balance hint
    // attached to some other error.
    const upstream = new Response(
      JSON.stringify({ error: 'context length exceeded', 剩余额度: '$50.00' }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
    const writer = makeFakeWriter();
    const handled = await maybeInterceptUpstreamError(upstream, writer);
    expect(handled).toBe(true);
    expect(writer.status).toBe(400); // passed through with original status
    expect(writer.body).toContain('context length exceeded');
  });

  it('passes through non-balance 4xx (e.g. 401 invalid key) with original status', async () => {
    const upstream = new Response(
      JSON.stringify({ error: 'invalid api key' }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    );
    const writer = makeFakeWriter();
    const handled = await maybeInterceptUpstreamError(upstream, writer);
    expect(handled).toBe(true);
    expect(writer.status).toBe(401);
    expect(writer.body).toContain('invalid api key');
  });

  it('does not touch 2xx responses (caller streams normally)', async () => {
    const upstream = new Response('data: ok\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
    const writer = makeFakeWriter();
    const handled = await maybeInterceptUpstreamError(upstream, writer);
    expect(handled).toBe(false);
    expect(writer.ended).toBe(false);
  });

  it('does not touch 5xx responses (caller passes through)', async () => {
    const upstream = new Response('Bad Gateway', { status: 502 });
    const writer = makeFakeWriter();
    const handled = await maybeInterceptUpstreamError(upstream, writer);
    expect(handled).toBe(false);
    expect(writer.ended).toBe(false);
  });
});
