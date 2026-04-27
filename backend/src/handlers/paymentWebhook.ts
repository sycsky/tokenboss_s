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
  markOrderPaidIfPending,
  markOrderStatus,
} from "../lib/store.js";

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
      // TODO(credit): grant the plan's quota to the user here. The
      // settlement is idempotent so this block runs at most once per
      // order — safe to extend without re-introducing double-credit risk.
    }
  }

  return textResponse(200, "ok");
};
