/**
 * Dodo Payments (MoR) channel client.
 *
 * Wire format: POST {base}/checkouts (Bearer auth, JSON)
 *   request: { product_cart: [{ product_id, quantity, amount? }],
 *              metadata: { orderId }, return_url }
 *   response: { session_id, checkout_url }
 *
 * The hosted checkout page collects customer + billing details itself
 * (unlike POST /payments, which requires both in the request), then lets
 * the buyer pay via card / Apple Pay / WeChat Pay / etc. `amount` on the
 * cart item overrides the price for pay-what-you-want products — that is
 * how one product serves any topup denomination. Amounts are USD cents.
 *
 * Webhook (POST notify endpoint, Standard Webhooks spec):
 *   headers: webhook-id, webhook-timestamp, webhook-signature ("v1,<b64>")
 *   signature = base64(HMAC-SHA256(secret, `${id}.${timestamp}.${rawBody}`))
 *   body: { type: "payment.succeeded" | ..., data: { payment_id,
 *          total_amount, metadata: { orderId }, ... } }
 *
 * Unlike epusdt/xunhupay the signature covers headers + raw body, so this
 * channel does NOT implement PaymentChannelClient.verifyCallback — the
 * webhook handler calls verifyWebhook(headers, rawBody) instead.
 */

import crypto from "node:crypto";

import type { CreateOrderInput, CreateOrderResult } from "./types.js";

export class DodoError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = "DodoError";
  }
}

interface DodoConfig {
  apiKey: string;
  /** https://live.dodopayments.com or https://test.dodopayments.com */
  apiBase: string;
  /** The pay-what-you-want "Credit Top-up" product id. */
  productId: string;
  /** Standard Webhooks secret from Dashboard → Developer → Webhooks.
   *  Optional at construction so order creation works before the webhook
   *  endpoint is configured; verifyWebhook fails closed without it. */
  webhookSecret?: string;
}

export interface DodoWebhookEvent {
  type: string;
  orderId: string;
  upstreamTradeId: string;
  /** Settlement total in the payment currency's main unit (may include
   *  tax and differ from the ordered amount — informational only). */
  amountActual: number;
}

/** Checkout sessions expire server-side; we surface a nominal 60 min. */
const SESSION_TTL_MS = 60 * 60 * 1000;

export class DodoClient {
  constructor(private readonly cfg: DodoConfig) {}

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const res = await fetch(`${this.cfg.apiBase}/checkouts`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.cfg.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        product_cart: [
          {
            product_id: this.cfg.productId,
            quantity: 1,
            // PWYW override, USD cents. input.amount is integer USD.
            amount: Math.round(input.amount * 100),
          },
        ],
        metadata: { orderId: input.orderId },
        ...(input.redirectUrl ? { return_url: input.redirectUrl } : {}),
      }),
    });

    let parsed: { session_id?: string; checkout_url?: string; message?: string };
    try {
      parsed = (await res.json()) as typeof parsed;
    } catch {
      throw new DodoError(res.status || 502, "dodo returned a non-JSON response");
    }
    if (!res.ok || !parsed.session_id || !parsed.checkout_url) {
      throw new DodoError(
        res.status || 502,
        parsed.message ?? `dodo checkout create failed (${res.status})`,
      );
    }

    return {
      upstreamTradeId: parsed.session_id,
      paymentUrl: parsed.checkout_url,
      amountActual: input.amount,
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
  }

  /**
   * Standard Webhooks verification + event mapping. Returns null when the
   * signature (or timestamp window, ±5 min) fails — callers reply 403 so
   * Dodo retries later rather than treating it as delivered.
   */
  verifyWebhook(
    headers: Record<string, string | undefined>,
    rawBody: string,
  ): DodoWebhookEvent | null {
    const secret = this.cfg.webhookSecret;
    if (!secret) return null;

    const id = headers["webhook-id"];
    const timestamp = headers["webhook-timestamp"];
    const signature = headers["webhook-signature"];
    if (!id || !timestamp || !signature) return null;

    // Reject replays outside a 5-minute window (Standard Webhooks rec).
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
      return null;
    }

    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const expected = crypto
      .createHmac("sha256", key)
      .update(`${id}.${timestamp}.${rawBody}`, "utf8")
      .digest("base64");

    // Header may carry several space-separated "v1,<sig>" entries.
    const match = signature.split(" ").some((part) => {
      const [version, sig] = part.split(",", 2);
      if (version !== "v1" || !sig) return false;
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    });
    if (!match) return null;

    let body: {
      type?: string;
      data?: {
        payment_id?: string;
        total_amount?: number;
        metadata?: Record<string, unknown>;
      };
    };
    try {
      body = JSON.parse(rawBody) as typeof body;
    } catch {
      return null;
    }

    const orderId = body.data?.metadata?.orderId;
    if (typeof body.type !== "string" || typeof orderId !== "string") {
      return null;
    }

    return {
      type: body.type,
      orderId,
      upstreamTradeId: body.data?.payment_id ?? "",
      amountActual:
        typeof body.data?.total_amount === "number"
          ? body.data.total_amount / 100
          : 0,
    };
  }
}

/** Build the client from DODO_* env vars; null when not configured
 *  (handler replies 503, same convention as epusdtFromEnv). */
export function dodoFromEnv(): DodoClient | null {
  const apiKey = process.env.DODO_API_KEY;
  const productId = process.env.DODO_PRODUCT_ID;
  if (!apiKey || !productId) return null;
  return new DodoClient({
    apiKey,
    productId,
    apiBase: (process.env.DODO_API_BASE ?? "https://live.dodopayments.com").replace(
      /\/+$/,
      "",
    ),
    webhookSecret: process.env.DODO_WEBHOOK_SECRET,
  });
}
