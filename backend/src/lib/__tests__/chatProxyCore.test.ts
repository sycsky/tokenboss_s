/**
 * Tests for chat proxy bucket gating helpers.
 *
 * We test the pure helper functions (inferTierFromModelId, estimateCost,
 * computeActualCost, gateRequest) in isolation rather than the full
 * streamChatCore pipeline, which requires a live upstream and is covered by
 * integration / e2e tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { init, createBucket } from '../store.js';
import {
  inferTierFromModelId,
  estimateCost,
  computeActualCost,
  gateRequest,
} from '../chatProxyCore.js';

/** Internal secret used across gating tests. */
const TEST_SECRET = 'test-internal-secret-1234';

/** Helper: build headers that include the internal secret + user id. */
function internalHeaders(userId: string): Record<string, string | undefined> {
  return {
    'x-tb-user-id': userId,
    'x-tb-internal-secret': TEST_SECRET,
  };
}

beforeEach(() => {
  process.env.SQLITE_PATH = ':memory:';
  process.env.TB_INTERNAL_SECRET = TEST_SECRET;
  init();
});

afterEach(() => {
  delete process.env.TB_INTERNAL_SECRET;
});

// ---------- inferTierFromModelId ----------

describe('inferTierFromModelId', () => {
  it('maps haiku → eco', () => {
    expect(inferTierFromModelId('claude-haiku-4.5')).toBe('eco');
    expect(inferTierFromModelId('anthropic/claude-haiku-4.5')).toBe('eco');
  });

  it('maps gpt-5-mini → eco', () => {
    expect(inferTierFromModelId('gpt-5.5-mini')).toBe('eco');
  });

  it('maps sonnet → standard', () => {
    expect(inferTierFromModelId('claude-4.7-sonnet')).toBe('standard');
  });

  it('maps opus → premium', () => {
    expect(inferTierFromModelId('claude-opus-4.6')).toBe('premium');
  });

  it('maps o1 / o3 → reasoning', () => {
    expect(inferTierFromModelId('o1')).toBe('reasoning');
    expect(inferTierFromModelId('o3')).toBe('reasoning');
  });

  it('maps gpt-5 (non-mini) → reasoning', () => {
    expect(inferTierFromModelId('gpt-5')).toBe('reasoning');
  });

  it('maps auto / virtual profiles → eco', () => {
    expect(inferTierFromModelId('auto')).toBe('eco');
    expect(inferTierFromModelId('eco')).toBe('eco');
    expect(inferTierFromModelId('premium')).toBe('eco'); // virtual → eco fallback
  });
});

// ---------- estimateCost ----------

describe('estimateCost', () => {
  it('returns a positive number for any input', () => {
    const cost = estimateCost('gpt-5.5-mini', [{ role: 'user', content: 'Hello' }]);
    expect(cost).toBeGreaterThan(0);
  });

  it('returns at least 0.0001 even for empty messages', () => {
    expect(estimateCost('auto', [])).toBeGreaterThanOrEqual(0.0001);
  });

  it('opus costs more than haiku for same messages', () => {
    const msgs = [{ role: 'user', content: 'Write me a detailed essay about quantum computing.' }];
    const opus = estimateCost('claude-opus-4.6', msgs);
    const haiku = estimateCost('claude-haiku-4.5', msgs);
    expect(opus).toBeGreaterThan(haiku);
  });

  it('longer messages cost more than shorter ones', () => {
    const shortMsg = [{ role: 'user', content: 'Hi' }];
    const longMsg = [{ role: 'user', content: 'x'.repeat(1000) }];
    const short = estimateCost('claude-opus-4.6', shortMsg);
    const long = estimateCost('claude-opus-4.6', longMsg);
    expect(long).toBeGreaterThan(short);
  });
});

// ---------- computeActualCost ----------

describe('computeActualCost', () => {
  it('computes cost proportional to tokens', () => {
    const cost100 = computeActualCost('claude-haiku-4.5', 100, 50);
    const cost200 = computeActualCost('claude-haiku-4.5', 200, 100);
    // Doubling tokens should roughly double cost
    expect(cost200).toBeCloseTo(cost100 * 2, 5);
  });

  it('returns at least 0.0001', () => {
    expect(computeActualCost('claude-haiku-4.5', 0, 0)).toBeGreaterThanOrEqual(0.0001);
  });
});

// ---------- gateRequest (bucket gating integration) ----------

describe('gateRequest', () => {
  it('passes through when x-tb-user-id header is absent', () => {
    const result = gateRequest({}, 'claude-opus-4.6', []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.gate.userId).toBe('');
    }
  });

  it('passes through (ignores x-tb-user-id) when internal secret is wrong', () => {
    // Attacker sends x-tb-user-id without knowing the secret — must be ignored
    const result = gateRequest(
      { 'x-tb-user-id': 'u_attacker', 'x-tb-internal-secret': 'wrong-secret' },
      'claude-opus-4.6',
      [],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // userId must be empty — the spoofed header was rejected
      expect(result.gate.userId).toBe('');
    }
  });

  it('passes through (ignores x-tb-user-id) when internal secret header is absent', () => {
    // No secret at all — header must not be trusted
    const result = gateRequest(
      { 'x-tb-user-id': 'u_attacker' },
      'claude-opus-4.6',
      [],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.gate.userId).toBe('');
    }
  });

  it('rejects request when user has no bucket (valid secret)', () => {
    const result = gateRequest(
      internalHeaders('u_no_bucket'),
      'gpt-5.5-mini',
      [{ role: 'user', content: 'hello' }],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = JSON.parse(result.errorBody) as {
        choices: Array<{ message: { content: string } }>;
      };
      expect(body.choices[0].message.content).toContain('tokenboss.com');
    }
  });

  it('rejects Plus user trying Claude (premium) in manual mode', () => {
    // plan_plus: auto_only lock + codex_only pool → no access to premium manual Claude
    createBucket({
      userId: 'u_plus',
      skuType: 'plan_plus',
      amountUsd: 840,
      dailyCapUsd: 30,
      dailyRemainingUsd: 30,
      totalRemainingUsd: null,
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 28 * 86400e3).toISOString(),
      modeLock: 'auto_only',
      modelPool: 'codex_only',
    });

    const result = gateRequest(
      internalHeaders('u_plus'),
      'claude-opus-4.6', // premium tier, manual mode (explicit model)
      [{ role: 'user', content: 'hello' }],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = JSON.parse(result.errorBody) as {
        choices: Array<{ message: { content: string } }>;
      };
      // model_locked or mode_locked — both mention pricing
      expect(body.choices[0].message.content).toContain('tokenboss.com/pricing');
    }
  });

  it('allows Super user to use Claude opus in manual mode', () => {
    // plan_super: no lock + all pool → full access
    createBucket({
      userId: 'u_super',
      skuType: 'plan_super',
      amountUsd: 2800,
      dailyCapUsd: 100,
      dailyRemainingUsd: 100,
      totalRemainingUsd: null,
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 28 * 86400e3).toISOString(),
      modeLock: 'none',
      modelPool: 'all',
    });

    const result = gateRequest(
      internalHeaders('u_super'),
      'claude-opus-4.6',
      [{ role: 'user', content: 'hello' }],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.gate.userId).toBe('u_super');
      expect(result.gate.modelTier).toBe('premium');
      expect(result.gate.mode).toBe('manual');
      expect(result.gate.estimatedCost).toBeGreaterThan(0);
    }
  });

  it('returns insufficient_balance error body when balance is exhausted', () => {
    // Trial bucket with only $0.00001 remaining — too small for any request
    createBucket({
      userId: 'u_broke',
      skuType: 'trial',
      amountUsd: 1,
      dailyCapUsd: null,
      dailyRemainingUsd: null,
      totalRemainingUsd: 0.00001, // effectively zero
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 86400e3).toISOString(),
      modeLock: 'none',
      modelPool: 'all',
    });

    const result = gateRequest(
      internalHeaders('u_broke'),
      'claude-opus-4.6',
      [{ role: 'user', content: 'x'.repeat(500) }],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = JSON.parse(result.errorBody) as {
        choices: Array<{ message: { content: string } }>;
      };
      expect(body.choices[0].message.content).toContain('tokenboss.com');
    }
  });

  it('auto mode maps to eco tier and is accepted by auto_eco_only bucket', () => {
    // Use a plan bucket with dailyRemainingUsd set (trial uses dailyRemainingUsd
    // rather than totalRemainingUsd per consumeForRequest logic)
    createBucket({
      userId: 'u_trial',
      skuType: 'plan_plus',
      amountUsd: 5,
      dailyCapUsd: 5,
      dailyRemainingUsd: 5,
      totalRemainingUsd: null,
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 86400e3).toISOString(),
      modeLock: 'auto_eco_only',
      modelPool: 'eco_only',
    });

    const result = gateRequest(
      internalHeaders('u_trial'),
      'auto',
      [{ role: 'user', content: 'hi' }],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.gate.mode).toBe('auto');
      expect(result.gate.modelTier).toBe('eco');
    }
  });
});

// ---------- gateRequest internal-secret auth ----------

describe('gateRequest internal-secret auth', () => {
  beforeEach(() => {
    process.env.SQLITE_PATH = ':memory:';
    delete process.env.TB_INTERNAL_SECRET;
    init();
  });

  it('passes through (no gating) when TB_INTERNAL_SECRET not set', () => {
    // When the env var is absent, bucket gating is skipped entirely for
    // backward-compat with key-only callers — userId is treated as empty.
    const result = gateRequest(
      { 'x-tb-user-id': 'u_anyone' } as Record<string, string | undefined>,
      'auto',
      [],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // userId must be '' — x-tb-user-id was not trusted without the secret
      expect(result.gate.userId).toBe('');
    }
  });

  it('passes when secret matches and user has a valid bucket', () => {
    process.env.TB_INTERNAL_SECRET = 'my-secret';
    // Re-init so the new env var takes effect in this sub-describe
    init();
    createBucket({
      userId: 'u_secret', skuType: 'plan_super', amountUsd: 2240, dailyCapUsd: 80,
      dailyRemainingUsd: 80, totalRemainingUsd: null,
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 28 * 86400e3).toISOString(),
      modeLock: 'none', modelPool: 'all',
    });
    const result = gateRequest(
      { 'x-tb-user-id': 'u_secret', 'x-tb-internal-secret': 'my-secret' } as Record<string, string | undefined>,
      'gpt-5.5',
      [{ role: 'user', content: 'hi' }],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.gate.userId).toBe('u_secret');
    }
  });

  it('ignores x-tb-user-id (pass-through) when secret header is absent', () => {
    process.env.TB_INTERNAL_SECRET = 'my-secret';
    init();
    // No x-tb-internal-secret header — spoofed user id must be ignored
    const result = gateRequest(
      { 'x-tb-user-id': 'u_someone' } as Record<string, string | undefined>,
      'gpt-5.5',
      [{ role: 'user', content: 'hi' }],
    );
    // Secret present in env but not in header → userId not trusted → pass-through
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.gate.userId).toBe('');
    }
  });

  it('ignores x-tb-user-id (pass-through) when secret value mismatches', () => {
    process.env.TB_INTERNAL_SECRET = 'my-secret';
    init();
    const result = gateRequest(
      { 'x-tb-user-id': 'u_someone', 'x-tb-internal-secret': 'wrong-secret' } as Record<string, string | undefined>,
      'gpt-5.5',
      [],
    );
    // Wrong secret → userId not trusted → pass-through (userId '')
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.gate.userId).toBe('');
    }
  });
});
