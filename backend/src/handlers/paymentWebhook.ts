/**
 * Payment webhook receivers — POST /v1/billing/webhook/{channel}.
 *
 * - No session auth: epusdt and xunhupay don't carry our JWT.
 * - The channel client verifies the body signature; on failure we 403.
 * - Settlement uses store.markOrderPaidIfPending which is a conditional
 *   UPDATE — duplicate webhooks (epusdt retries up to N times) become
 *   no-ops, so the credit-grant block runs at most once per order.
 *
 * Response body must match what the channel expects to ack:
 *   epusdt expects literal "ok"
 *   xunhupay expects literal "success"
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

import { epusdtFromEnv } from "../lib/payment/epusdt.js";
import {
  getOrder,
  getUser,
  markOrderPaidIfPending,
  markOrderStatus,
  setUserPlan,
} from "../lib/store.js";
import { PLANS, isPlanId } from "../lib/plans.js";
import { newapi, usdToNewapiQuota, NewapiError } from "../lib/newapi.js";

function newapiUsername(userId: string): string {
  return userId.startsWith("u_") ? userId.slice(2) : userId.slice(0, 20);
}

function textResponse(
  statusCode: number,
  body: string,
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "content-type": "text/plain; charset=utf-8" },
    body,
  };
}

function parseBody(event: APIGatewayProxyEventV2): Record<string, unknown> | null {
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? "", "base64").toString("utf8")
      : (event.body ?? "");
    if (!raw) return null;

    // epusdt sends application/json. Form-encoded fallback is here for
    // future channels (xunhupay's webhook is form-encoded).
    const ct = (
      event.headers?.["content-type"] ??
      event.headers?.["Content-Type"] ??
      ""
    ).toLowerCase();

    if (ct.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(raw);
      const obj: Record<string, unknown> = {};
      for (const [k, v] of params.entries()) obj[k] = v;
      return obj;
    }
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------- POST /v1/billing/webhook/epusdt ----------

export const epusdtWebhookHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const client = epusdtFromEnv();
  if (!client) {
    // Misconfiguration: log loud, fail hard. Returning non-"ok" makes
    // epusdt retry, which is what we want until ops fixes the env.
    console.error("[webhook/epusdt] not configured — refusing");
    return textResponse(503, "epusdt_not_configured");
  }

  const body = parseBody(event);
  if (!body) {
    console.warn("[webhook/epusdt] unparsable body");
    return textResponse(400, "bad_request");
  }

  const verified = client.verifyCallback(body);
  if (!verified) {
    console.warn("[webhook/epusdt] signature verification failed", {
      orderId: body.order_id,
    });
    return textResponse(403, "bad_signature");
  }

  const order = await getOrder(verified.orderId);
  if (!order) {
    console.warn("[webhook/epusdt] unknown order", { orderId: verified.orderId });
    // Returning "ok" tells epusdt to stop retrying; if we 5xx it'll keep
    // hammering us. The order genuinely doesn't exist — nothing to do.
    return textResponse(200, "ok");
  }

  if (verified.status === "expired") {
    await markOrderStatus({ orderId: order.orderId, status: "expired" });
    return textResponse(200, "ok");
  }

  if (verified.status === "paid") {
    const settled = await markOrderPaidIfPending({
      orderId: order.orderId,
      paidAt: new Date().toISOString(),
      amountActual: verified.amountActual,
      blockTxId: verified.blockTxId,
      receiveAddress: verified.receiveAddress,
    });
    if (settled) {
      console.info("[webhook/epusdt] order settled", {
        orderId: order.orderId,
        userId: order.userId,
        planId: order.planId,
        amountActual: verified.amountActual,
      });
      await applyPlanToUser(order.userId, order.planId);
    }
  }

  return textResponse(200, "ok");
};

/**
 * Activate a paid plan for the user:
 *   1. Push the daily $ allowance into newapi as `quota` (units).
 *   2. Move the newapi user into the plan's group.
 *   3. Update users table with plan + start/expiry + dailyQuotaUsd.
 *
 * Idempotent at the caller level (markOrderPaidIfPending guards against
 * duplicate webhook deliveries). Failures here are logged but NOT thrown,
 * so a transient newapi outage doesn't block the webhook ack — the next
 * dailyCron run will pick the user up by their `users.plan` row anyway.
 */
async function applyPlanToUser(userId: string, planId: string): Promise<void> {
  if (!isPlanId(planId)) {
    console.error(`[webhook/epusdt] unknown planId on settled order: ${planId}`);
    return;
  }
  const cfg = PLANS[planId];
  const now = Date.now();
  const startedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + cfg.durationDays * 86_400_000).toISOString();
  // First quota reset fires 24h after activation, then every 24h thereafter.
  const quotaNextResetAt = new Date(now + 86_400_000).toISOString();

  setUserPlan(userId, {
    plan: planId,
    subscriptionStartedAt: startedAt,
    subscriptionExpiresAt: expiresAt,
    dailyQuotaUsd: cfg.dailyQuotaUsd,
    quotaNextResetAt,
  });

  const user = await getUser(userId);
  if (!user || user.newapiUserId == null) {
    console.warn(
      `[webhook/epusdt] user ${userId} has no newapi link — skipping quota push`,
    );
    return;
  }

  try {
    await newapi.updateUser({
      id: user.newapiUserId,
      // newapi PUT requires username — omitting it has bricked rows in the past.
      username: newapiUsername(userId),
      quota: usdToNewapiQuota(cfg.dailyQuotaUsd),
      group: cfg.group,
    });
    console.info(
      `[webhook/epusdt] applied ${planId} to user=${userId}: quota=$${cfg.dailyQuotaUsd}/day group=${cfg.group}`,
    );
  } catch (err) {
    const msg = err instanceof NewapiError ? err.message : (err as Error).message;
    console.error(
      `[webhook/epusdt] newapi.updateUser failed for ${userId}: ${msg}`,
    );
  }
}
