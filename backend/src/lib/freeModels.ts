/**
 * Free-model discovery — the single source of truth for "which model is
 * free" is newapi's pricing config, so we query it at runtime instead of
 * hardcoding a model name (feedback: 不硬编码 upstream provisioning).
 *
 * Zero-price models pre-consume 0 quota on newapi, so a zero-balance
 * user's own key can call them — that's what makes the free model the
 * escape hatch from the "no balance → agent brain dead → can't pay"
 * deadlock (see chatProxyCore.buildBalanceEmptyBody).
 *
 * FREE_FALLBACK_MODEL env, when set, overrides discovery (ops escape
 * hatch / test determinism). Discovery results (including "none found")
 * are cached for 10 minutes so 402 storms don't hammer newapi.
 */

import { newapi } from "./newapi.js";

/** Pick the free model from raw /api/pricing rows. quota_type 0 charges
 *  by ratio, 1 by fixed price — free means the relevant knob is 0.
 *  Deterministic: sorted by name, first wins. Pure — unit-testable. */
export function pickFreeModelId(
  rows: Record<string, unknown>[],
): string | null {
  const free = rows
    .filter((r) => {
      if (typeof r.model_name !== "string" || r.model_name === "") return false;
      return r.quota_type === 1 ? r.model_price === 0 : r.model_ratio === 0;
    })
    .map((r) => r.model_name as string)
    .sort();
  return free[0] ?? null;
}

const TTL_MS = 10 * 60_000;
let cache: { value: string | null; at: number } = { value: null, at: 0 };

export async function getFreeModelId(): Promise<string | null> {
  const override = process.env.FREE_FALLBACK_MODEL;
  if (override) return override;
  if (!process.env.NEWAPI_BASE_URL) return null;
  if (Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    cache = { value: pickFreeModelId(await newapi.getPricing()), at: Date.now() };
  } catch (err) {
    // Fail soft AND stamp the TTL — a broken upstream must not turn
    // every insufficient-balance 402 into an extra newapi round-trip.
    console.warn(`[free-model] discovery failed: ${(err as Error).message}`);
    cache = { value: cache.value, at: Date.now() };
  }
  return cache.value;
}
