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
import { newapi, newapiQuotaToUsd, NewapiError, type NewapiSubscription } from "../lib/newapi.js";
import { getNewapiPlanId } from "../lib/plans.js";

interface SyntheticBucket {
  id: string;
  skuType: "trial" | "plan_plus" | "plan_super" | "plan_ultra";
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
   *  daily/weekly/etc). null for trial (never resets). */
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

  let subs: NewapiSubscription[] = [];
  try {
    subs = await newapi.listUserSubscriptions(user.newapiUserId);
  } catch (err) {
    if (err instanceof NewapiError) {
      console.warn(`[buckets] listUserSubscriptions failed: ${err.message}`);
    } else {
      console.warn(`[buckets] listUserSubscriptions failed: ${(err as Error).message}`);
    }
    return jsonResponse(200, { buckets: [] });
  }

  const planIdMap = buildPlanIdMap();
  const buckets = subs
    .filter((s) => s.status === "active")
    .map((s) => synthesize(s, userId as string, planIdMap, user.createdAt))
    .filter((b): b is SyntheticBucket => b !== null);

  return jsonResponse(200, { buckets });
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
