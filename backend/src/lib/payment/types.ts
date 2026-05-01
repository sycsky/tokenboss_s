/**
 * Payment domain types — shared across channels (epusdt + xunhupay) and
 * across order kinds (套餐 plans + 一次性充值 topup).
 *
 * Channels are pluggable: each one implements `PaymentChannelClient` so the
 * handlers can dispatch by channel without knowing the wire format.
 *
 * Order kinds are discriminated by `skuType`. plan_* orders activate a
 * subscription via newapi.bindSubscription on settle; topup orders mint a
 * one-shot redemption code on newapi admin and apply it to the user's quota.
 */

export type PaymentChannel = "epusdt" | "xunhupay";

export type OrderStatus = "pending" | "paid" | "expired" | "failed";

export type OrderCurrency = "CNY" | "USD";

/** Discriminator for what kind of thing the order is buying. Mirrors the
 *  bucket sku_type vocabulary in credits-economy spec § Implementation. */
export type OrderSkuType =
  | "plan_plus"
  | "plan_super"
  | "plan_ultra"
  | "topup";

/** "我方落账到 newapi 的结果"。Plan orders use bindSubscription which is
 *  near-atomic on newapi side, so settleStatus is left undefined for them.
 *  Topup orders go through the mint+redeem flow — we mark `settled` on
 *  success so `failed` rows can be filtered for ops follow-up. */
export type OrderSettleStatus = "settled" | "failed";

// PlanId is still the source of truth in lib/plans.ts for the plan-only
// surface (pricing, bindSubscription mapping). OrderRecord no longer
// references PlanId directly — it uses OrderSkuType.
export type { PlanId } from "../plans.js";

export interface OrderRecord {
  orderId: string;
  userId: string;
  /** What the order is buying. */
  skuType: OrderSkuType;
  channel: PaymentChannel;
  /** Quoted amount in `currency` (CNY for xunhupay, USD for epusdt). */
  amount: number;
  /** Currency the `amount` is denominated in. */
  currency: OrderCurrency;
  /** Channel-side actual settled amount (USDT for epusdt, same as
   *  amount for xunhupay). */
  amountActual?: number;
  /** USD value to credit on topup orders. CNY orders: ¥1 = $1 baseline,
   *  so equals `amount`. USD orders: `amount` (USDT) is multiplied by the
   *  USD_TO_CREDIT_RATE in paymentHandlers (currently 7), so $1 USDT pays
   *  → $7 credited. Stored separately so settle is decoupled from FX drift
   *  between order and webhook. Undefined for plan orders. */
  topupAmountUsd?: number;
  status: OrderStatus;
  /** Set on topup orders after the webhook has attempted to apply credits.
   *  Undefined while the order is still pending or for plan orders. */
  settleStatus?: OrderSettleStatus;
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
  /** Quoted amount in `currency`. epusdt: USD; xunhupay: CNY. */
  amount: number;
  currency: OrderCurrency;
  /** SKU label used as the upstream order subject/title (xunhupay shows
   *  this on the 支付宝 H5 checkout page). MUST be ASCII-only and ≤20 chars
   *  — non-ASCII or longer strings can trigger gateway-side content filters
   *  (xunhupay's 支付宝 channel returns errcode=500 for some Chinese strings).
   *  Plan orders pass the plan id ('plus'|'super'|'ultra'); topup orders
   *  pass the literal 'topup'. Adding new SKU labels: keep them ASCII. */
  skuLabel: string;
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
