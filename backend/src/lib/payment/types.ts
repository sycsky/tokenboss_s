/**
 * Payment domain types — shared across channels (epusdt now, xunhupay next).
 *
 * Channels are pluggable: each one implements `PaymentChannelClient` so the
 * handlers can dispatch by channel without knowing the wire format.
 */

export type PaymentChannel = "epusdt" | "xunhupay";

export type OrderStatus = "pending" | "paid" | "expired" | "failed";

// PlanId is the source of truth in lib/plans.ts; re-export here so the
// payment-domain types live in one place.
export type { PlanId } from "../plans.js";
import type { PlanId as _PlanId } from "../plans.js";

export interface OrderRecord {
  orderId: string;
  userId: string;
  planId: _PlanId;
  channel: PaymentChannel;
  amountCNY: number;
  /** USDT amount when channel=epusdt; same as amountCNY for fiat channels. */
  amountActual?: number;
  status: OrderStatus;
  /** Channel-side trade id (epusdt: trade_id; xunhupay: open_order_id). */
  upstreamTradeId?: string;
  /** URL to redirect the user to (checkout counter for epusdt). */
  upstreamPaymentUrl?: string;
  /** TRON / chain transaction id, only set for crypto channels on success. */
  blockTxId?: string;
  /** Wallet address the user paid into (epusdt only). */
  receiveAddress?: string;
  createdAt: string;
  paidAt?: string;
}

export interface CreateOrderInput {
  orderId: string;
  amountCNY: number;
  planId: _PlanId;
  notifyUrl: string;
  redirectUrl?: string;
}

export interface CreateOrderResult {
  upstreamTradeId: string;
  paymentUrl: string;
  /** Direct QR-code image URL when the channel exposes one (xunhupay).
   *  Lets the frontend render the QR inline on PC instead of routing the
   *  user to the gateway's hosted checkout page. */
  qrCodeUrl?: string;
  amountActual: number;
  expiresAt: number;
}

/** Minimal channel-agnostic interface — handlers code against this. */
export interface PaymentChannelClient {
  createOrder(input: CreateOrderInput): Promise<CreateOrderResult>;
  /**
   * Verify and parse a webhook payload. Returns null when verification
   * fails — handlers must reject with 403 in that case.
   */
  verifyCallback(payload: Record<string, unknown>): WebhookEvent | null;
}

export interface WebhookEvent {
  orderId: string;
  upstreamTradeId: string;
  amountActual: number;
  status: OrderStatus;
  blockTxId?: string;
  receiveAddress?: string;
}
