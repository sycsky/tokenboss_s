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
import { xunhupayFromEnv } from "../lib/payment/xunhupay.js";
import { dodoFromEnv } from "../lib/payment/dodo.js";
import type {
  OrderRecord,
  PaymentChannelClient,
  WebhookEvent,
} from "../lib/payment/types.js";
import {
  getOrder,
  getUser,
  markOrderPaidIfPending,
  markOrderStatus,
  markOrderSettleStatus,
  setOrderRedemptionCode,
} from "../lib/store.js";
import { getNewapiPlanId, skuTypeToPlanId } from "../lib/plans.js";
import { newapi, NewapiError } from "../lib/newapi.js";
import { newapiUsername } from "../lib/newapiIdentity.js";
import * as Sentry from "@sentry/node";

/** Settle-failure reporter — pushes to Sentry as a high-severity event
 *  with structured tags so it's filterable in the dashboard. We log
 *  console.error too so on-call still sees it inline in zeabur logs.
 *  Message is generic ("settle failed at <stage>") and orderId is a
 *  tag (not in the message) so Sentry groups by failure mode, not
 *  by per-order noise. */
function reportSettleFailure(opts: {
  stage: 'plan_bind' | 'topup_mint' | 'topup_redeem' | 'topup_user_link' | 'topup_amount_missing' | 'amount_mismatch' | 'unknown_skuType';
  channel: string;
  orderId: string;
  userId: string;
  err?: unknown;
  extra?: Record<string, unknown>;
}): void {
  const errMsg = opts.err
    ? (opts.err instanceof NewapiError ? opts.err.message : (opts.err as Error).message)
    : null;
  console.error(
    `[webhook/${opts.channel}] settle-failure stage=${opts.stage} order=${opts.orderId}`,
    { userId: opts.userId, errMsg, ...opts.extra },
  );
  Sentry.captureMessage(`webhook settle failed: ${opts.stage}`, {
    level: 'error',
    tags: {
      kind: 'settle_failure',
      stage: opts.stage,
      channel: opts.channel,
    },
    extra: {
      orderId: opts.orderId,
      userId: opts.userId,
      errMsg,
      ...opts.extra,
    },
  });
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

    // epusdt sends application/json. Form-encoded fallback is here for
    // future channels (xunhupay's webhook is form-encoded).
    const ct = (
      event.headers?.["content-type"] ??
      event.headers?.["Content-Type"] ??
      ""
    ).toLowerCase();

    if (ct.includes("application/x-www-form-urlencoded")) {
      // Empty body is valid for form-encoded (no parameters) — return {}
      // rather than null so downstream verifyCallback can still run.
      const params = new URLSearchParams(raw);
      const obj: Record<string, unknown> = {};
      for (const [k, v] of params.entries()) obj[k] = v;
      return obj;
    }

    if (!raw) return null;
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------- shared core ----------

/**
 * Core webhook flow shared by all channels: parse body, verify signature,
 * settle the order, kick the plan into newapi. The only per-channel things
 * are the client used for verification and the literal ack string the
 * gateway expects.
 */
async function processWebhook(
  event: APIGatewayProxyEventV2,
  client: PaymentChannelClient | null,
  channel: string,
  ack: string,
): Promise<APIGatewayProxyResultV2> {
  const tag = `[webhook/${channel}]`;

  if (!client) {
    // Misconfiguration: log loud, fail hard. Returning a non-ack body makes
    // the gateway retry, which is what we want until ops fixes the env.
    console.error(`${tag} not configured — refusing`);
    return textResponse(503, `${channel}_not_configured`);
  }

  const body = parseBody(event);
  if (!body) {
    console.warn(`${tag} unparsable body`);
    return textResponse(400, "bad_request");
  }

  const verified = client.verifyCallback(body);
  if (!verified) {
    console.warn(`${tag} signature verification failed`, {
      orderId: body.order_id ?? body.trade_order_id,
    });
    return textResponse(403, "bad_signature");
  }

  await settleWebhookEvent(verified, channel);
  return textResponse(200, ack);
}

/**
 * Channel-agnostic settlement: look up the order and apply the verified
 * event to it. Shared by the body-signature channels (via processWebhook)
 * and header-signature channels (dodo) that verify on their own.
 */
async function settleWebhookEvent(
  verified: WebhookEvent,
  channel: string,
): Promise<void> {
  const tag = `[webhook/${channel}]`;

  const order = await getOrder(verified.orderId);
  if (!order) {
    // Acked upstream regardless; the order genuinely doesn't exist on our
    // side — nothing to do.
    console.warn(`${tag} unknown order`, { orderId: verified.orderId });
    return;
  }

  // Cross-channel guard: an event from channel X must not settle an order
  // created on channel Y, even with a valid signature (codex review P1).
  if (order.channel !== channel) {
    console.warn(`${tag} channel mismatch — refusing to settle`, {
      orderId: order.orderId,
      orderChannel: order.channel,
      eventChannel: channel,
    });
    return;
  }

  if (verified.status === "expired") {
    await markOrderStatus({ orderId: order.orderId, status: "expired" });
    return;
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
      console.info(`${tag} order settled`, {
        orderId: order.orderId,
        userId: order.userId,
        skuType: order.skuType,
        amountActual: verified.amountActual,
      });
      // Amount-integrity guard: only grant credit when the amount the
      // gateway actually collected matches the order. We can only compare
      // safely when the event's settlement currency equals the order's own
      // currency — adaptive currency (Dodo) can report a presentment
      // currency we can't FX-compare here, so those skip the numeric check
      // (the order amount is one we set server-side and gateways don't let
      // buyers lower it without a discount code, which we don't enable).
      // A same-currency shortfall (e.g. an unexpected discount) must NOT
      // receive full credits: hold as settleStatus='failed' + alert ops.
      if (
        verified.currency &&
        verified.currency === order.currency &&
        verified.amountActual > 0 &&
        verified.amountActual < order.amount - 0.01
      ) {
        await markOrderSettleStatus({ orderId: order.orderId, settleStatus: 'failed' });
        reportSettleFailure({
          stage: 'amount_mismatch',
          channel,
          orderId: order.orderId,
          userId: order.userId,
          extra: {
            expectedAmount: order.amount,
            paidAmount: verified.amountActual,
            currency: verified.currency,
          },
        });
        return;
      }
      if (order.skuType === 'topup') {
        await applyTopupToUser(order, channel);
      } else {
        const planId = skuTypeToPlanId(order.skuType);
        if (planId) {
          await applyPlanToUser(order.userId, planId, channel);
        } else {
          reportSettleFailure({
            stage: 'unknown_skuType',
            channel,
            orderId: order.orderId,
            userId: order.userId,
            extra: { skuType: order.skuType },
          });
        }
      }
    }
  }
}

// ---------- POST /v1/billing/webhook/epusdt ----------

export const epusdtWebhookHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  return processWebhook(event, epusdtFromEnv(), "epusdt", "ok");
};

// ---------- POST /v1/billing/webhook/xunhupay ----------

export const xunhupayWebhookHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  return processWebhook(event, xunhupayFromEnv(), "xunhupay", "success");
};

// ---------- POST /v1/billing/webhook/dodo ----------

/**
 * Dodo signs headers + RAW body (Standard Webhooks), so it can't go
 * through processWebhook's parse-then-verify flow — order matters: the
 * HMAC must be computed over the exact bytes received.
 */
export const dodoWebhookHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const tag = "[webhook/dodo]";
  const client = dodoFromEnv();
  if (!client) {
    console.error(`${tag} not configured — refusing`);
    return textResponse(503, "dodo_not_configured");
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64").toString("utf8")
    : (event.body ?? "");

  // Header names are case-insensitive; normalize once.
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(event.headers ?? {})) {
    headers[k.toLowerCase()] = v;
  }

  const evt = client.verifyWebhook(headers, rawBody);
  if (!evt) {
    console.warn(`${tag} signature verification failed`);
    return textResponse(403, "bad_signature");
  }

  if (evt.type === "payment.succeeded") {
    await settleWebhookEvent(
      {
        orderId: evt.orderId,
        upstreamTradeId: evt.upstreamTradeId,
        amountActual: evt.amountActual,
        currency: evt.currency,
        status: "paid",
      },
      "dodo",
    );
  } else if (/^(refund|dispute)\./.test(evt.type)) {
    // Money is moving back while the credits stay spendable. No automated
    // claw-back yet (needs a newapi debit flow) — page ops loudly through
    // Sentry so每一笔都有人工跟进 (codex review P1). Ack 200 so Dodo stops
    // retrying: the alert, not the redelivery, is the durable record.
    console.error(`${tag} refund/dispute received — manual claw-back needed`, {
      type: evt.type,
      orderId: evt.orderId,
      upstreamTradeId: evt.upstreamTradeId,
      amountActual: evt.amountActual,
    });
    Sentry.captureMessage(`dodo ${evt.type} needs manual claw-back`, {
      level: "error",
      tags: { kind: "refund_dispute", channel: "dodo", eventType: evt.type },
      extra: {
        orderId: evt.orderId,
        upstreamTradeId: evt.upstreamTradeId,
        amountActual: evt.amountActual,
      },
    });
  } else {
    // payment.failed and other non-terminal events — log only, do NOT mark
    // the order failed. A Dodo checkout session lets the buyer retry after a
    // declined attempt, so payment.failed is per-ATTEMPT, not per-order: a
    // later payment.succeeded can still arrive for the same orderId. Since
    // markOrderPaidIfPending only transitions pending orders, terminating
    // here would silently drop a retried, genuinely-paid payment (codex
    // review P1). The order stays pending; the checkout's own TTL plus the
    // status page's 30-min poll cap bound the wait on a truly-abandoned one.
    console.info(`${tag} non-terminal event, order stays pending`, {
      type: evt.type,
      orderId: evt.orderId,
    });
  }

  return textResponse(200, "ok");
};

/**
 * Activate a paid plan for the user (V3 newapi-as-truth flow):
 *   1. Invalidate any existing active subscriptions on newapi (so a paid
 *      Plus replaces the trial cleanly instead of stacking).
 *   2. Bind the user to the corresponding newapi subscription plan, which
 *      atomically sets group + quota + daily reset cadence on newapi side.
 *
 * No TokenBoss DB write — newapi is the only source of truth for
 * subscription state. /v1/buckets reads it live each request.
 *
 * Idempotent at the caller level (markOrderPaidIfPending guards against
 * duplicate webhook deliveries). bind / invalidate failures are logged
 * but NOT thrown, so a transient newapi outage doesn't block the webhook
 * ack.
 */
async function applyPlanToUser(
  userId: string,
  planId: import('../lib/plans.js').PlanId,
  channel: string,
): Promise<void> {
  const tag = `[webhook/${channel}]`;

  const user = await getUser(userId);
  if (!user || user.newapiUserId == null) {
    console.warn(
      `${tag} user ${userId} has no newapi link — skipping subscription bind`,
    );
    return;
  }

  const newapiPlanId = getNewapiPlanId(planId);
  if (newapiPlanId === null) {
    console.error(
      `${tag} NEWAPI_PLAN_ID_${planId.toUpperCase()} not configured — user ${userId} has no upstream subscription; ` +
        `set the env var and re-bind manually`,
    );
    return;
  }

  // Invalidate any existing active subscriptions BEFORE binding the new
  // plan. Without this, newapi keeps both records active (e.g., Trial +
  // Plus) and consumes from them in FIFO order — users see "Trial quota
  // shrinking while on Plus" which is confusing. Failure here is logged
  // but not fatal.
  try {
    const existing = await newapi.listUserSubscriptions(user.newapiUserId);
    for (const sub of existing) {
      if (sub.status === "active") {
        try {
          await newapi.invalidateUserSubscription(sub.id);
          console.info(
            `${tag} invalidated stale sub id=${sub.id} (plan_id=${sub.plan_id}) on user ${userId} before binding ${planId}`,
          );
        } catch (innerErr) {
          const innerMsg = innerErr instanceof NewapiError ? innerErr.message : (innerErr as Error).message;
          console.warn(
            `${tag} failed to invalidate sub id=${sub.id} on user ${userId}: ${innerMsg}`,
          );
        }
      }
    }
  } catch (err) {
    const msg = err instanceof NewapiError ? err.message : (err as Error).message;
    console.warn(
      `${tag} could not list existing subs for ${userId}: ${msg} (proceeding with bind anyway)`,
    );
  }

  try {
    await newapi.bindSubscription({
      userId: user.newapiUserId,
      planId: newapiPlanId,
    });
    console.info(
      `${tag} bound ${planId} sub (newapi plan_id=${newapiPlanId}) to user=${userId} (newapi user=${user.newapiUserId})`,
    );
  } catch (err) {
    reportSettleFailure({
      stage: 'plan_bind',
      channel,
      orderId: 'n/a',  // applyPlanToUser doesn't carry order id, only userId
      userId,
      err,
      extra: { planId, newapiPlanId, newapiUserId: user.newapiUserId },
    });
  }
}

/**
 * Credit a settled topup order's $ to the user via newapi.
 *
 * Path: admin-mint a one-shot redemption code worth `topupAmountUsd` →
 * log in as the user → apply the code via newapi's /api/user/topup. Two
 * atomic newapi operations replace a single read-modify-write
 * updateUser, which would race against the user's own consumption.
 *
 * Idempotency: caller (markOrderPaidIfPending) already guarantees one
 * call per order via SQL conditional UPDATE — duplicate webhooks become
 * no-ops at the order layer, so we never enter this function twice for
 * the same order.
 *
 * Failure mode: webhook still acks 200 (the order IS paid), but
 * settleStatus is set to 'failed' and a structured error log lets ops
 * grep by orderId. v1 is manual-recovery; v1.1 may add an auto-retry
 * cron.
 */
export async function applyTopupToUser(
  order: OrderRecord,
  channel: string,
): Promise<boolean> {
  const tag = `[webhook/${channel}]`;

  const usd = order.topupAmountUsd;
  if (!usd || usd <= 0) {
    reportSettleFailure({
      stage: 'topup_amount_missing',
      channel,
      orderId: order.orderId,
      userId: order.userId,
      extra: { topupAmountUsd: usd },
    });
    await markOrderSettleStatus({ orderId: order.orderId, settleStatus: 'failed' });
    return false;
  }

  const user = await getUser(order.userId);
  if (!user || user.newapiUserId == null || !user.newapiPassword) {
    reportSettleFailure({
      stage: 'topup_user_link',
      channel,
      orderId: order.orderId,
      userId: order.userId,
      extra: { hasNewapiUserId: user?.newapiUserId != null, hasNewapiPassword: !!user?.newapiPassword },
    });
    await markOrderSettleStatus({ orderId: order.orderId, settleStatus: 'failed' });
    return false;
  }

  // Reuse the order's persisted code on retries — minting a fresh code
  // per attempt double-credits when a prior redeem succeeded remotely but
  // we died before marking 'settled'. The code is persisted BEFORE the
  // redeem so no success can ever be untracked. If a reused code comes
  // back "already redeemed", that prior attempt DID credit — the loud
  // failure below is then a false negative to resolve manually, which is
  // the safe direction (never double-credit).
  let code = order.redemptionCode;
  if (!code) {
    try {
      code = await newapi.createRedemption({
        name: order.orderId,
        quotaUsd: usd,
      });
      await setOrderRedemptionCode({ orderId: order.orderId, redemptionCode: code });
    } catch (err) {
      reportSettleFailure({
        stage: 'topup_mint',
        channel,
        orderId: order.orderId,
        userId: order.userId,
        err,
        extra: { topupAmountUsd: usd },
      });
      await markOrderSettleStatus({ orderId: order.orderId, settleStatus: 'failed' });
      return false;
    }
  }

  try {
    const session = await newapi.loginUser({
      username: newapiUsername(order.userId),
      password: user.newapiPassword,
    });
    await newapi.redeemCode(session, code);
    await markOrderSettleStatus({ orderId: order.orderId, settleStatus: 'settled' });
    console.info(`${tag} topup credited`, {
      orderId: order.orderId,
      userId: order.userId,
      topupAmountUsd: usd,
    });
    return true;
  } catch (err) {
    reportSettleFailure({
      stage: 'topup_redeem',
      channel,
      orderId: order.orderId,
      userId: order.userId,
      err,
      extra: {
        topupAmountUsd: usd,
        // Last 4 chars of the minted code so ops can look it up in
        // newapi admin by name=orderId without leaking the full code.
        mintedCodeTail: code.slice(-4),
      },
    });
    await markOrderSettleStatus({ orderId: order.orderId, settleStatus: 'failed' });
    return false;
  }
}

