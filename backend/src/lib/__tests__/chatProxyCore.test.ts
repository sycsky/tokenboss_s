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
