/**
 * GET /v1/buckets — synthesize a single bucket-shaped object from
 * `users.plan` + `newapi.getUser`'s remaining quota.
 *
 * Local `credit_bucket` is gone. The frontend (Dashboard / UsageHistory /
 * Settings) reads bucket-shaped data so we keep the response shape and
 * compute the fields on the fly. Source of truth:
 *   - plan / dailyQuotaUsd / subscriptionExpiresAt → users table
 *   - quota / used_quota                            → newapi.getUser
 *
 * Returns { buckets: [] } when:
 *   - the user has no plan (newly seeded row), OR
 *   - the user has no newapi link, OR
 *   - newapi.getUser fails (graceful degradation; dashboard renders
 *     "no active credit").
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

import { verifySessionHeader, isAuthFailure } from "../lib/auth.js";
import { getUser } from "../lib/store.js";
import { newapi, newapiQuotaToUsd, NewapiError } from "../lib/newapi.js";

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
  /** ISO of next 24h quota reset; null for free users (no daily reset). */
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
  if (!user || !user.plan || user.newapiUserId == null) {
    return jsonResponse(200, { buckets: [] });
  }

  let remainingUsd = 0;
  try {
    const u = await newapi.getUser(user.newapiUserId);
    // newapi exposes `quota` (remaining) directly. Some forks alias it as
    // `remain_quota`; getUser returns NewapiUser whose `quota` field is the
    // remaining balance, NOT the cap.
    const remainingQuota = (u as unknown as { quota?: number; remain_quota?: number }).quota
      ?? (u as unknown as { remain_quota?: number }).remain_quota
      ?? 0;
    remainingUsd = newapiQuotaToUsd(Number(remainingQuota) || 0);
  } catch (err) {
    // Don't 500 the dashboard — log and return empty.
    if (err instanceof NewapiError) {
      console.warn(`[buckets] newapi.getUser failed: ${err.message}`);
    } else {
      console.warn(`[buckets] newapi.getUser failed: ${(err as Error).message}`);
    }
    return jsonResponse(200, { buckets: [] });
  }

  const bucket = synthesize(user.plan, {
    userId,
    dailyQuotaUsd: user.dailyQuotaUsd ?? null,
    subscriptionStartedAt: user.subscriptionStartedAt ?? null,
    subscriptionExpiresAt: user.subscriptionExpiresAt ?? null,
    quotaNextResetAt: user.quotaNextResetAt ?? null,
    createdAt: user.createdAt,
    remainingUsd,
  });

  return jsonResponse(200, { buckets: [bucket] });
}

function synthesize(
  plan: string,
  ctx: {
    userId: string;
    dailyQuotaUsd: number | null;
    subscriptionStartedAt: string | null;
    subscriptionExpiresAt: string | null;
    quotaNextResetAt: string | null;
    createdAt: string;
    remainingUsd: number;
  },
): SyntheticBucket {
  if (plan === "free") {
    // Free users get $10 one-shot. No daily reset, no expiry countdown.
    return {
      id: `bk_free_${ctx.userId}`,
      skuType: "trial",
      amountUsd: 10,
      dailyCapUsd: null,
      dailyRemainingUsd: null,
      totalRemainingUsd: ctx.remainingUsd,
      startedAt: ctx.subscriptionStartedAt ?? ctx.createdAt,
      expiresAt: null,
      modeLock: "auto_eco_only",
      modelPool: "eco_only",
      nextResetAt: null,
    };
  }

  // Paid plans: dailyQuotaUsd is the daily cap; remaining is what newapi
  // currently shows. Each user has their own 24h reset window.
  const sku =
    plan === "plus" ? "plan_plus" :
    plan === "super" ? "plan_super" :
    plan === "ultra" ? "plan_ultra" :
    "plan_plus";
  return {
    id: `bk_${plan}_${ctx.userId}`,
    skuType: sku as SyntheticBucket["skuType"],
    amountUsd: ctx.dailyQuotaUsd ?? 0,
    dailyCapUsd: ctx.dailyQuotaUsd,
    dailyRemainingUsd: ctx.remainingUsd,
    totalRemainingUsd: ctx.remainingUsd,
    startedAt: ctx.subscriptionStartedAt ?? ctx.createdAt,
    expiresAt: ctx.subscriptionExpiresAt,
    modeLock: null,
    modelPool: "all",
    nextResetAt: ctx.quotaNextResetAt,
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
