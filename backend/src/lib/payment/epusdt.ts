/**
 * epusdt (GMWalletApp fork) client.
 *
 * Wire format: POST /payments/gmpay/v1/order/create-transaction (JSON body)
 *   request fields: pid, order_id, currency, token, network, amount,
 *                   notify_url, redirect_url?, name?, signature
 *   response: { status_code, message, data: { trade_id, order_id, amount,
 *              actual_amount, receive_address, token, expiration_time,
 *              payment_url } }
 *
 * Webhook (POST notify_url, JSON):
 *   { pid, trade_id, order_id, amount, actual_amount, receive_address,
 *     token, block_transaction_id, signature, status }
 *   status: 1=pending, 2=paid, 3=expired
 *   handler must respond with literal "ok" to ack.
 *
 * Signature is MD5(sortedParams + secretKey), excluding the `signature`
 * field itself. Identical algorithm on inbound + outbound — see ../sign.ts.
 */

import { md5KsortSign, constantTimeEqual } from "./sign.js";
import type {
  CreateOrderInput,
  CreateOrderResult,
  PaymentChannelClient,
  WebhookEvent,
} from "./types.js";

interface EpusdtConfig {
  baseUrl: string;
  pid: string;
  secret: string;
  /** Defaults: cny / usdt / tron — overridable when the rate config supports more. */
  currency?: string;
  token?: string;
  network?: string;
}

interface CreateTxResponse {
  status_code: number;
  message: string;
  data: {
    trade_id: string;
    order_id: string;
    amount: number;
    actual_amount: number;
    receive_address?: string;
    token: string;
    expiration_time: number;
    payment_url: string;
  } | null;
  request_id?: string;
}

export class EpusdtError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = "EpusdtError";
  }
}

export function createEpusdtClient(cfg: EpusdtConfig): PaymentChannelClient {
  const baseUrl = cfg.baseUrl.replace(/\/+$/, "");
  const token = cfg.token ?? "usdt";
  const network = cfg.network ?? "tron";

  return {
    async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
      // V3: TokenBoss prices crypto plans in USD natively (frontend
      // marketing copy is "$49 USDC / 4 周"). Pass that through to epusdt
      // as currency=usd; epusdt then converts to USDT at gateway rate.
      // Fall back to cfg.currency / 'cny' for any unexpected callers.
      const apiCurrency = input.currency
        ? input.currency.toLowerCase()
        : (cfg.currency ?? "cny");
      const body: Record<string, unknown> = {
        pid: cfg.pid,
        order_id: input.orderId,
        currency: apiCurrency,
        token,
        network,
        amount: input.amount,
        notify_url: input.notifyUrl,
      };
      if (input.redirectUrl) body.redirect_url = input.redirectUrl;
      body.signature = md5KsortSign(body, cfg.secret, {
        excludeKeys: ["signature"],
      });

      const res = await fetch(
        `${baseUrl}/payments/gmpay/v1/order/create-transaction`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      let parsed: CreateTxResponse;
      try {
        parsed = (await res.json()) as CreateTxResponse;
      } catch {
        throw new EpusdtError(res.status, `epusdt non-json response (${res.status})`);
      }

      if (parsed.status_code !== 200 || !parsed.data) {
        throw new EpusdtError(
          parsed.status_code || res.status,
          `epusdt create failed: ${parsed.message ?? "unknown"} (status_code=${parsed.status_code})`,
        );
      }

      return {
        upstreamTradeId: parsed.data.trade_id,
        paymentUrl: parsed.data.payment_url,
        amountActual: parsed.data.actual_amount,
        expiresAt: parsed.data.expiration_time,
      };
    },

    verifyCallback(payload: Record<string, unknown>): WebhookEvent | null {
      const sig = typeof payload.signature === "string" ? payload.signature : "";
      if (!sig) return null;

      const expected = md5KsortSign(payload, cfg.secret, {
        excludeKeys: ["signature"],
      });
      if (!constantTimeEqual(sig, expected)) return null;

      const orderId = String(payload.order_id ?? "");
      const tradeId = String(payload.trade_id ?? "");
      const statusNum = Number(payload.status);
      if (!orderId || !tradeId) return null;

      return {
        orderId,
        upstreamTradeId: tradeId,
        amountActual: Number(payload.actual_amount ?? 0),
        status: statusNum === 2 ? "paid" : statusNum === 3 ? "expired" : "pending",
        blockTxId: typeof payload.block_transaction_id === "string"
          ? payload.block_transaction_id
          : undefined,
        receiveAddress: typeof payload.receive_address === "string"
          ? payload.receive_address
          : undefined,
      };
    },
  };
}

/**
 * Build an epusdt client from env. Returns null when not configured —
 * handlers can then return 503 with a clear message instead of crashing
 * at startup.
 */
export function epusdtFromEnv(): PaymentChannelClient | null {
  const baseUrl = process.env.EPUSDT_BASE_URL;
  const pid = process.env.EPUSDT_PID;
  const secret = process.env.EPUSDT_SECRET;
  if (!baseUrl || !pid || !secret) return null;
  return createEpusdtClient({ baseUrl, pid, secret });
}
