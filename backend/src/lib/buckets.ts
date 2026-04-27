import { getActiveBucketsForUser, consumeBucket, logUsage, ModelPool, ModeLock } from './store.js';

export type ChatMode = 'auto' | 'manual';
export type ModelTier = 'eco' | 'standard' | 'premium' | 'reasoning';

export interface BucketRequest {
  userId: string;
  mode: ChatMode;
  modelId: string;
  modelTier: ModelTier;
  costUsd: number;
  source?: string;
  /** Last 8 chars of the bearer token used. Lets the dashboard attribute
   * each call to one of the user's API keys. */
  keyHint?: string;
  tokensIn?: number;
  tokensOut?: number;
}

export type ConsumeError = 'insufficient_balance' | 'mode_locked' | 'model_locked';

export interface ConsumeResult {
  ok: boolean;
  error?: ConsumeError;
  consumed: Array<{ bucketId: string; bucketSkuType: string; amount: number }>;
}

function modeAllowed(mode: ChatMode, lock: ModeLock): boolean {
  if (lock === 'none') return true;
  if (lock === 'auto_only' || lock === 'auto_eco_only') return mode === 'auto';
  return false;
}

function modelInPool(tier: ModelTier, pool: ModelPool): boolean {
  if (pool === 'all') return true;
  if (pool === 'codex_only') return tier === 'eco' || tier === 'standard';
  if (pool === 'eco_only') return tier === 'eco';
  return false;
}

export function consumeForRequest(req: BucketRequest): ConsumeResult {
  const buckets = getActiveBucketsForUser(req.userId);

  const eligible = buckets.filter(
    b => modeAllowed(req.mode, b.modeLock) && modelInPool(req.modelTier, b.modelPool)
  );

  if (eligible.length === 0) {
    // Distinguish mode_locked vs model_locked:
    // mode_locked: a bucket's model pool accepts this model tier, but the mode is restricted.
    // model_locked: no bucket accepts this model tier at all (or no buckets exist).
    if (
      buckets.length > 0 &&
      buckets.some(b => modelInPool(req.modelTier, b.modelPool) && !modeAllowed(req.mode, b.modeLock))
    ) {
      return { ok: false, error: 'mode_locked', consumed: [] };
    }
    // No bucket matches the model pool (or no buckets at all) → model_locked if buckets exist,
    // insufficient_balance if no buckets exist (nothing to spend from).
    if (buckets.length === 0) {
      return { ok: false, error: 'insufficient_balance', consumed: [] };
    }
    return { ok: false, error: 'model_locked', consumed: [] };
  }

  // trial + topup buckets use totalRemainingUsd; subscription buckets use dailyRemainingUsd
  const balanceOf = (b: typeof eligible[0]): number =>
    (b.skuType === 'topup' || b.skuType === 'trial')
      ? (b.totalRemainingUsd ?? 0)
      : (b.dailyRemainingUsd ?? 0);

  const available = eligible.reduce((sum, b) => sum + balanceOf(b), 0);

  if (available < req.costUsd) {
    return { ok: false, error: 'insufficient_balance', consumed: [] };
  }

  let remaining = req.costUsd;
  const consumed: ConsumeResult['consumed'] = [];

  for (const b of eligible) {
    if (remaining <= 0) break;
    const have = balanceOf(b);
    const take = Math.min(have, remaining);
    if (take > 0) {
      consumeBucket(b.id, take);
      logUsage({
        userId: req.userId,
        bucketId: b.id,
        eventType: 'consume',
        amountUsd: take,
        model: req.modelId,
        source: req.source ?? null,
        keyHint: req.keyHint ?? null,
        tokensIn: req.tokensIn ?? null,
        tokensOut: req.tokensOut ?? null,
      });
      consumed.push({ bucketId: b.id, bucketSkuType: b.skuType, amount: take });
      remaining -= take;
    }
  }

  return { ok: true, consumed };
}
