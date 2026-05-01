/**
 * GET /v1/buckets — synthesize bucket-shaped objects from the user's
 * newapi subscription records.
 *
 * Source of truth (V3 newapi-as-truth):
 *   - GET /api/subscription/admin/users/{id}/subscriptions
 *     returns the user's full subscription history; each record has
 *     amount_total, amount_used, end_time, next_reset_time, etc.
 *   - We surface ALL active subscriptions (so e.g. a trial visible
 *     alongside a paid sub if both exist), as a list of buckets.
 *   - Trial is a subscription too; it shows as skuType="trial".
 *
 * Returns { buckets: [] } when:
 *   - the user has no newapi link, OR
 *   - newapi call fails (graceful degradation; dashboard renders empty).
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

import { verifySessionHeader, isAuthFailure } from "../lib/auth.js";
import { getUser } from "../lib/store.js";
import {
  newapi,
  newapiQuotaToUsd,
  NewapiError,
  type NewapiSubscription,
  type NewapiUser,
} from "../lib/newapi.js";
import { getNewapiPlanId } from "../lib/plans.js";

interface SyntheticBucket {
  id: string;
  skuType: "trial" | "plan_plus" | "plan_super" | "plan_ultra" | "topup";
  amountUsd: number;
  dailyCapUsd: number | null;
  dailyRemainingUsd: number | null;
  totalRemainingUsd: number | null;
  startedAt: string;
  expiresAt: string | null;
  modeLock: "auto_eco_only" | null;
  modelPool: "eco_only" | "all";
  /** ISO of next 24h quota reset, taken from newapi's subscription
   *  next_reset_time (only set for plans whose quota_reset_period is
   *  daily/weekly/etc). null for trial (never resets) and for topup
   *  (wallet credits don't expire / reset). */
  nextResetAt: string | null;
}

export async function listBucketsHandler(
  evt: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const headerUserId = (evt.headers?.["x-tb-user-id"] as string | undefined) ?? null;
  let userId: string | null = headerUserId;
  if (!userId) {
    const authHeader =
      evt.headers?.authorization ?? evt.headers?.Authorization ?? undefined;
    const session = await verifySessionHeader(authHeader);
    if (isAuthFailure(session)) {
      return jsonResponse(401, { error: "unauthorized" });
    }
    userId = session.userId;
  }

  const user = await getUser(userId);
  if (!user || user.newapiUserId == null) {
    return jsonResponse(200, { buckets: [] });
  }

  // Two newapi calls in parallel — they're independent and the latency is
  // user-facing (every dashboard load). allSettled lets each one fail on
  // its own without nuking the other: a flaky listSubs still surfaces the
  // topup balance, and a flaky getUser still surfaces the active sub.
  const [subsRes, nuRes] = await Promise.allSettled([
    newapi.listUserSubscriptions(user.newapiUserId),
    newapi.getUser(user.newapiUserId),
  ]);

  if (subsRes.status === "rejected") {
    const err = subsRes.reason;
    const msg = err instanceof NewapiError ? err.message : (err as Error).message;
    console.warn(`[buckets] listUserSubscriptions failed: ${msg}`);
  }
  if (nuRes.status === "rejected") {
    const err = nuRes.reason;
    const msg = err instanceof NewapiError ? err.message : (err as Error).message;
    console.warn(`[buckets] getUser failed: ${msg}`);
  }

  const subs: NewapiSubscription[] =
    subsRes.status === "fulfilled" ? subsRes.value : [];
  const nu: NewapiUser | null =
    nuRes.status === "fulfilled" ? nuRes.value : null;

  const planIdMap = buildPlanIdMap();
  const buckets: SyntheticBucket[] = subs
    .filter((s) => s.status === "active")
    .map((s) => synthesize(s, userId as string, planIdMap, user.createdAt))
    .filter((b): b is SyntheticBucket => b !== null);

  // Topup bucket = whatever newapi.user.quota has beyond the sum of active
  // subscription remainings. It's the user's wallet — credits redeemed via
  // /api/user/topup that aren't bound to any subscription. Only emitted
  // when there's an actual positive balance, so dashboards don't flash
  // "$0 充值余额" for users who've never topped up.
  if (nu) {
    const topupBucket = synthesizeTopupBucket(nu, subs, userId, user.createdAt);
    if (topupBucket) buckets.push(topupBucket);
  }

  return jsonResponse(200, { buckets });
}

/**
 * Derive the user's topup wallet remaining by subtracting active-subscription
 * remainings from newapi.user.quota (which aggregates both). Returns null
 * when the residual is ≤ 0 — never emit a 0-balance bucket.
 */
function synthesizeTopupBucket(
  nu: NewapiUser,
  subs: NewapiSubscription[],
  userId: string,
  userCreatedAt: string,
): SyntheticBucket | null {
  const totalBalanceUsd = newapiQuotaToUsd(Math.max(0, nu.quota));
  const activeSubRemainingUsd = subs
    .filter((s) => s.status === "active")
    .reduce((sum, s) => {
      const total = newapiQuotaToUsd(s.amount_total);
      const used = newapiQuotaToUsd(s.amount_used);
      return sum + Math.max(0, total - used);
    }, 0);

  // Floating-point slop guard: newapiQuotaToUsd does integer / 500_000, so
  // exact-equality residuals can land at ~1e-12. Treat anything below 1¢ as
  // zero — wallet credits less than that aren't worth surfacing in the UI.
  const topupRemainingUsd = totalBalanceUsd - activeSubRemainingUsd;
  if (topupRemainingUsd < 0.01) return null;

  return {
    id: `bk_topup_${nu.id}_${userId}`,
    skuType: "topup",
    amountUsd: topupRemainingUsd,
    // Wallet credits don't have a daily cap / reset; the whole balance is
    // available indefinitely until consumed.
    dailyCapUsd: null,
    dailyRemainingUsd: null,
    totalRemainingUsd: topupRemainingUsd,
    // No single "started at" — topup is cumulative. Use account creation as
    // a stable, monotonic anchor so the UI can still render a date.
    startedAt: userCreatedAt,
    // Never expires — credits sit in newapi.user.quota until spent.
    expiresAt: null,
    modeLock: null,
    modelPool: "all",
    nextResetAt: null,
  };
}

/**
 * Build a reverse map from newapi plan_id → TokenBoss label so we can
 * skuType the bucket correctly. NEWAPI_PLAN_ID_<TIER> envs already give
 * us the forward map; invert at request time (cheap — 4 entries).
 */
function buildPlanIdMap(): Map<number, "trial" | "plus" | "super" | "ultra"> {
  const map = new Map<number, "trial" | "plus" | "super" | "ultra">();
  for (const tier of ["trial", "plus", "super", "ultra"] as const) {
    const id = getNewapiPlanId(tier);
    if (id !== null) map.set(id, tier);
  }
  return map;
}

function synthesize(
  sub: NewapiSubscription,
  userId: string,
  planIdMap: Map<number, "trial" | "plus" | "super" | "ultra">,
  userCreatedAt: string,
): SyntheticBucket | null {
  const tier = planIdMap.get(sub.plan_id);
  if (!tier) return null; // Unknown plan id (shouldn't happen if env is configured).

  const totalUsd = newapiQuotaToUsd(sub.amount_total);
  const usedUsd = newapiQuotaToUsd(sub.amount_used);
  const remainingUsd = Math.max(0, totalUsd - usedUsd);
  const startedAt = sub.start_time
    ? new Date(sub.start_time * 1000).toISOString()
    : userCreatedAt;
  const expiresAt = sub.end_time
    ? new Date(sub.end_time * 1000).toISOString()
    : null;
  const nextResetAt = sub.next_reset_time
    ? new Date(sub.next_reset_time * 1000).toISOString()
    : null;

  if (tier === "trial") {
    return {
      id: `bk_trial_${sub.id}_${userId}`,
      skuType: "trial",
      amountUsd: totalUsd,
      dailyCapUsd: null,
      dailyRemainingUsd: null,
      totalRemainingUsd: remainingUsd,
      startedAt,
      expiresAt,
      modeLock: "auto_eco_only",
      modelPool: "eco_only",
      nextResetAt,
    };
  }

  const sku =
    tier === "plus" ? "plan_plus" :
    tier === "super" ? "plan_super" :
    "plan_ultra";

  // For paid plans, totalUsd is the per-period budget (e.g. $30 for Plus
  // when quota_reset_period=daily). Treat amountTotal as both the cap
  // and the period budget; remaining is what's left in the current
  // window (newapi resets it on next_reset_time).
  return {
    id: `bk_${tier}_${sub.id}_${userId}`,
    skuType: sku,
    amountUsd: totalUsd,
    dailyCapUsd: totalUsd,
    dailyRemainingUsd: remainingUsd,
    totalRemainingUsd: remainingUsd,
    startedAt,
    expiresAt,
    modeLock: null,
    modelPool: "all",
    nextResetAt,
  };
}

function jsonResponse(
  statusCode: number,
  body: unknown,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
