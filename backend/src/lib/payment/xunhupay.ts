/**
 * xunhupay (虎皮椒) client.
 *
 * Wire format: POST https://api.xunhupay.com/payment/do.html
 *   Content-Type: application/x-www-form-urlencoded
 *   request fields: appid, version=1.1, trade_order_id, total_fee, title,
 *                   time, nonce_str, notify_url, return_url, type=WAP,
 *                   wap_url, wap_name, hash
 *   response: JSON { errcode, errmsg, hash, oderno, url_qrcode, url, ... }
 *     - errcode === 0 means accepted
 *     - `oderno` (sic) is the gateway-side order id
 *     - `url` is the checkout page (works on PC + mobile, auto-renders QR)
 *
 * Webhook (POST notify_url, application/x-www-form-urlencoded):
 *   appid, trade_order_id, total_fee, transaction_id, open_order_id,
 *   order_title, status, plugins, attach, time, nonce_str, hash
 *   - status === "OD" means paid; anything else is non-final.
 *   - Handler must respond with literal "success" to ack (otherwise xunhupay
 *     retries up to ~10 times with exponential backoff).
 *
 * Signature is MD5(sortedParams + appsecret), excluding the `hash` field
 * itself. Identical algorithm on inbound + outbound — see ../sign.ts.
 */

import crypto from "node:crypto";
import { md5KsortSign, constantTimeEqual } from "./sign.js";
import type {
  CreateOrderInput,
  CreateOrderResult,
  PaymentChannelClient,
  WebhookEvent,
} from "./types.js";

const DEFAULT_GATEWAY_URL = "https://api.xunhupay.com/payment/do.html";

interface XunhupayConfig {
  appid: string;
  appsecret: string;
  /** Override only for testing or sandbox. */
  gatewayUrl?: string;
  /** Default order title shown on the checkout page. Must be ASCII-safe
   *  for some 支付宝 H5 channels — Chinese words like "订阅 / 充值 / 会员"
   *  occasionally trigger gateway-side content filters and return errcode=500. */
  defaultTitle?: string;
  /** Brand name shown on H5 checkout. */
  wapName?: string;
}

interface CreateOrderResponse {
  errcode: number;
  errmsg?: string;
  hash?: string;
  /** xunhupay's gateway-side order id (note the typo — it's "oderno", not "orderno"). */
  oderno?: string;
  url_qrcode?: string;
  url?: string;
}

export class XunhupayError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = "XunhupayError";
  }
}

function nonceStr(): string {
  return crypto.randomBytes(16).toString("hex");
}

function unixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function createXunhupayClient(cfg: XunhupayConfig): PaymentChannelClient {
  const gatewayUrl = (cfg.gatewayUrl ?? DEFAULT_GATEWAY_URL).trim();
  const wapName = cfg.wapName ?? "TokenBoss";
  const defaultTitle = cfg.defaultTitle ?? "TokenBoss";

  return {
    async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
      // xunhupay (虎皮椒) is a Chinese fiat gateway and only accepts CNY.
      // Other currencies will be rejected with a vague gateway error;
      // fail loudly here instead so callers get a clear signal.
      if (input.currency !== "CNY") {
        throw new XunhupayError(
          0,
          `xunhupay only supports CNY orders; got currency=${input.currency}. ` +
            `Route USD orders through epusdt instead.`,
        );
      }

      // wap_url is the page the user came FROM — xunhupay shows a "Back to
      // <wap_name>" link pointing here on the checkout page. Strip query
      // string from redirectUrl so we don't trip URL-validation on the
      // gateway side.
      const wapUrl = input.redirectUrl
        ? input.redirectUrl.split("?")[0]
        : "";

      const body: Record<string, unknown> = {
        appid: cfg.appid,
        version: "1.1",
        trade_order_id: input.orderId,
        // total_fee must be a numeric string with at most 2 decimals.
        total_fee: input.amount.toFixed(2),
        title: `${defaultTitle} ${input.skuLabel}`.trim(),
        time: unixSeconds(),
        nonce_str: nonceStr(),
        notify_url: input.notifyUrl,
        type: "WAP",
        wap_url: wapUrl,
        wap_name: wapName,
      };
      if (input.redirectUrl) body.return_url = input.redirectUrl;

      body.hash = md5KsortSign(body, cfg.appsecret, {
        excludeKeys: ["hash"],
      });

      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) {
        if (v === null || v === undefined || v === "") continue;
        form.append(k, String(v));
      }

      const res = await fetch(gatewayUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });

      let parsed: CreateOrderResponse;
      try {
        parsed = (await res.json()) as CreateOrderResponse;
      } catch {
        // Log the body so we can see what the gateway choked on without
        // re-running the user. Mask the appsecret-derived hash so it
        // doesn't leak into log aggregators.
        console.warn("[xunhupay] non-json response", {
          status: res.status,
          requestBody: { ...body, hash: "<redacted>" },
        });
        throw new XunhupayError(
          res.status,
          `xunhupay non-json response (${res.status})`,
        );
      }

      if (parsed.errcode !== 0 || !parsed.url) {
        console.warn("[xunhupay] create rejected", {
          errcode: parsed.errcode,
          errmsg: parsed.errmsg,
          requestBody: { ...body, hash: "<redacted>" },
        });
        throw new XunhupayError(
          parsed.errcode || res.status,
          `xunhupay create failed: ${parsed.errmsg ?? "unknown"} (errcode=${parsed.errcode})`,
        );
      }

      return {
        upstreamTradeId: parsed.oderno ?? "",
        paymentUrl: parsed.url,
        qrCodeUrl: parsed.url_qrcode,
        // Fiat channel — actual payable amount equals quoted CNY amount.
        amountActual: input.amount,
        // xunhupay doesn't return an explicit expiration; pad 30min so
        // the OrderRecord has a non-zero value. Real expiry is enforced
        // upstream regardless of this field.
        expiresAt: unixSeconds() + 30 * 60,
      };
    },

    verifyCallback(payload: Record<string, unknown>): WebhookEvent | null {
      const sig = typeof payload.hash === "string" ? payload.hash : "";
      if (!sig) return null;

      const expected = md5KsortSign(payload, cfg.appsecret, {
        excludeKeys: ["hash"],
      });
      if (!constantTimeEqual(sig, expected)) return null;

      const orderId = String(payload.trade_order_id ?? "");
      const tradeId = String(payload.open_order_id ?? "");
      const statusRaw = String(payload.status ?? "");
      if (!orderId) return null;

      // xunhupay's only success state is "OD" (订单完成 / Order Done).
      // Any other value (including absent) is non-terminal — treat as
      // pending so we don't accidentally settle.
      const status = statusRaw === "OD" ? "paid" : "pending";

      const totalFee = Number(payload.total_fee ?? 0);

      return {
        orderId,
        upstreamTradeId: tradeId,
        amountActual: totalFee,
        status,
      };
    },
  };
}

/**
 * Build a xunhupay client from env. Returns null when not configured —
 * handlers can then return 503 with a clear message instead of crashing
 * at startup.
 */
export function xunhupayFromEnv(): PaymentChannelClient | null {
  const appid = process.env.XUNHUPAY_APPID;
  const appsecret = process.env.XUNHUPAY_APPSECRET;
  if (!appid || !appsecret) return null;
  return createXunhupayClient({
    appid,
    appsecret,
    gatewayUrl: process.env.XUNHUPAY_GATEWAY_URL,
    wapName: process.env.XUNHUPAY_WAP_NAME,
  });
}
