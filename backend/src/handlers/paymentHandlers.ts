/**
 * Payment / order handlers (session-authed).
 *
 *   POST /v1/billing/orders            create order, returns paymentUrl
 *   GET  /v1/billing/orders            list caller's orders
 *   GET  /v1/billing/orders/{orderId}  fetch one (for status polling)
 *
 * The caller chooses a `channel` (`epusdt` for now; xunhupay next phase).
 * On creation we record the order as `pending`, call the channel to get
 * a payment URL, and stamp the upstream fields back onto the row. The
 * front end then redirects the user to `paymentUrl` and polls GET-by-id
 * until status flips to `paid` (set by the webhook handler).
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import crypto from "node:crypto";

import {
  isAuthFailure,
  verifySessionHeader,
} from "../lib/auth.js";
import { epusdtFromEnv, EpusdtError } from "../lib/payment/epusdt.js";
import { xunhupayFromEnv, XunhupayError } from "../lib/payment/xunhupay.js";
import type { PaymentChannel } from "../lib/payment/types.js";
import {
  createOrder,
  getOrder,
  listOrdersByUser,
} from "../lib/store.js";
import type { OrderRecord, OrderSkuType } from "../lib/payment/types.js";
import { PLANS, isPlanId, getPlanPriceCNY, getPlanPriceUSD, skuTypeToPlanId } from "../lib/plans.js";
import type { PlanId } from "../lib/plans.js";

// PLAN_PRICE was a frozen snapshot of PLANS[*].priceCNY built at module
// load — replaced by getPlanPriceCNY() / getPlanPriceUSD(), which read
// the env override at call time so PLAN_PRICE_<PLANID>_CNY (or _USD)
// can flip without a process bounce.

function jsonResponse(
  statusCode: number,
  body: unknown,
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function jsonError(
  statusCode: number,
  type: string,
  message: string,
  code?: string,
): APIGatewayProxyResultV2 {
  return jsonResponse(statusCode, {
    error: { type, message, ...(code ? { code } : {}) },
  });
}

async function requireSession(event: APIGatewayProxyEventV2) {
  const authHeader =
    event.headers?.authorization ?? event.headers?.Authorization ?? undefined;
  return verifySessionHeader(authHeader);
}

function parseJsonBody(event: APIGatewayProxyEventV2): Record<string, unknown> | null {
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? "", "base64").toString("utf8")
      : (event.body ?? "");
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isChannel(v: unknown): v is PaymentChannel {
  return v === "epusdt" || v === "xunhupay";
}

/**
 * Resolve the public-facing URL of THIS service. epusdt and xunhupay both
 * post webhooks to whatever URL we hand them, so it must be reachable from
 * the public internet (zeabur.app, your domain, etc).
 *
 * Priority:
 *   1. PUBLIC_BASE_URL env (explicit, e.g. https://api.tokenboss.co)
 *   2. inferred from the request — works behind API Gateway / Function URL
 */
function resolvePublicBaseUrl(event: APIGatewayProxyEventV2): string | null {
  const fromEnv = process.env.PUBLIC_BASE_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");

  const headers = event.headers ?? {};
  const host =
    headers["x-forwarded-host"] ??
    headers["X-Forwarded-Host"] ??
    headers.host ??
    headers.Host;
  const proto =
    headers["x-forwarded-proto"] ??
    headers["X-Forwarded-Proto"] ??
    "https";
  if (!host) return null;
  return `${proto}://${host}`;
}

/**
 * Resolve the frontend origin used when redirecting users back from the
 * payment gateway (the /billing/success?orderId=... route is a React Router
 * route on the frontend, NOT an API endpoint).
 *
 * When backend and frontend share a domain, the fallback to PUBLIC_BASE_URL
 * works. When they're split (api.tokenboss.co vs tokenboss.co), set
 * PUBLIC_FRONTEND_BASE_URL=https://tokenboss.co or paid users will be
 * redirected to api.tokenboss.co/billing/success which 404s on the API.
 */
function resolveFrontendBaseUrl(event: APIGatewayProxyEventV2): string | null {
  const fromEnv = process.env.PUBLIC_FRONTEND_BASE_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  return resolvePublicBaseUrl(event);
}

function newOrderId(): string {
  // tb_ord_<24 hex> = 31 chars total — epusdt caps order_id at 32.
  return `tb_ord_${crypto.randomBytes(12).toString("hex")}`;
}

function shapeOrder(rec: OrderRecord) {
  return {
    orderId: rec.orderId,
    skuType: rec.skuType,
    // Convenience: derive planId for plan_* orders so the existing
    // OrderStatus UI keeps working without a code change.
    planId: skuTypeToPlanId(rec.skuType) ?? undefined,
    channel: rec.channel,
    amount: rec.amount,
    currency: rec.currency,
    amountActual: rec.amountActual,
    topupAmountUsd: rec.topupAmountUsd,
    status: rec.status,
    settleStatus: rec.settleStatus,
    paymentUrl: rec.upstreamPaymentUrl,
    blockTxId: rec.blockTxId,
    createdAt: rec.createdAt,
    paidAt: rec.paidAt,
  };
}

// ---------- POST /v1/billing/orders ----------

const MAX_TOPUP_AMOUNT = 99999;
/** USD-paying channels (epusdt) credit FX-converted USD额度 to the user.
 *  ¥1 = $1 baseline still holds for RMB; USD payments effectively pay
 *  the spot CNY/USD rate and get credited at the same baseline.
 *  Hardcoded for v1; bump on noticeable FX drift. */
const USD_TO_CREDIT_RATE = 7;

function isOrderType(v: unknown): v is 'plan' | 'topup' {
  return v === 'plan' || v === 'topup';
}

export const createOrderHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const auth = await requireSession(event);
  if (isAuthFailure(auth)) {
    return jsonError(auth.status, "authentication_error", auth.message, auth.code);
  }

  const body = parseJsonBody(event);
  if (!body)
    return jsonError(400, "invalid_request_error", "Body must be valid JSON.");

  // type: 'plan' (default for back-compat) | 'topup'
  const rawType = body.type ?? 'plan';
  if (!isOrderType(rawType))
    return jsonError(400, "invalid_request_error", "type must be plan|topup.");
  const type = rawType;

  if (!isChannel(body.channel))
    return jsonError(400, "invalid_request_error", "channel must be epusdt|xunhupay.");
  const channel = body.channel;

  // Channel determines pricing currency:
  //   epusdt   → USD (USDT-TRC20)
  //   xunhupay → CNY (Alipay/WeChat fiat gateway, CNY only)
  // Server-derived; client-supplied currency is ignored.
  const currency: "CNY" | "USD" = channel === "epusdt" ? "USD" : "CNY";

  let skuType: OrderSkuType;
  let amount: number;
  let topupAmountUsd: number | undefined;
  let skuLabel: string;
  let planId: PlanId | undefined;

  if (type === 'plan') {
    if (!isPlanId(body.planId))
      return jsonError(400, "invalid_request_error", "planId must be plus|super|ultra.");
    planId = body.planId;
    if (PLANS[planId].soldOut) {
      return jsonError(
        410,
        "plan_unavailable",
        `${PLANS[planId].displayName} 当前售罄，暂时无法下单。`,
        "plan_sold_out",
      );
    }
    skuType = `plan_${planId}` as const;
    amount = currency === "USD"
      ? getPlanPriceUSD(planId)
      : getPlanPriceCNY(planId);
    skuLabel = planId;
  } else {
    // type === 'topup'
    const rawAmount = body.amount;
    if (
      typeof rawAmount !== 'number' ||
      !Number.isFinite(rawAmount) ||
      !Number.isInteger(rawAmount) ||
      rawAmount < 1 ||
      rawAmount > MAX_TOPUP_AMOUNT
    ) {
      return jsonError(
        400,
        "invalid_request_error",
        `amount must be an integer between 1 and ${MAX_TOPUP_AMOUNT}.`,
        "invalid_amount",
      );
    }
    skuType = 'topup';
    amount = rawAmount;
    // ¥1 = $1 baseline (spec credits-economy § 4) for RMB; USD pays spot
    // FX so $1 USDT → $7 credited. Stored independently of amount/currency
    // so settle is decoupled from FX drift between order and webhook.
    topupAmountUsd = currency === 'USD' ? rawAmount * USD_TO_CREDIT_RATE : rawAmount;
    skuLabel = 'topup';
  }

  const baseUrl = resolvePublicBaseUrl(event);
  if (!baseUrl) {
    return jsonError(
      500,
      "server_error",
      "Cannot determine public base URL for callbacks. Set PUBLIC_BASE_URL.",
    );
  }

  let client;
  if (channel === "epusdt") {
    client = epusdtFromEnv();
    if (!client) {
      return jsonError(
        503,
        "service_unavailable",
        "epusdt is not configured (set EPUSDT_BASE_URL / EPUSDT_PID / EPUSDT_SECRET).",
        "epusdt_not_configured",
      );
    }
  } else {
    client = xunhupayFromEnv();
    if (!client) {
      return jsonError(
        503,
        "service_unavailable",
        "xunhupay is not configured (set XUNHUPAY_APPID / XUNHUPAY_APPSECRET).",
        "xunhupay_not_configured",
      );
    }
  }

  const orderId = newOrderId();
  const now = new Date().toISOString();

  let result;
  try {
    result = await client.createOrder({
      orderId,
      amount,
      currency,
      skuLabel,
      notifyUrl: `${baseUrl}/v1/billing/webhook/${channel}`,
      // notifyUrl uses backend domain (webhook hits the API). redirectUrl uses
      // frontend domain — /billing/success is a React Router route on the
      // frontend, NOT an API endpoint. When PUBLIC_FRONTEND_BASE_URL is unset,
      // resolveFrontendBaseUrl falls back to PUBLIC_BASE_URL (legacy single-
      // domain setup). On split-domain deploys, the env MUST be set.
      redirectUrl: typeof body.redirectUrl === "string"
        ? body.redirectUrl
        : `${resolveFrontendBaseUrl(event) ?? baseUrl}/billing/success?orderId=${orderId}`,
    });
  } catch (err) {
    const status =
      err instanceof EpusdtError || err instanceof XunhupayError ? 502 : 500;
    return jsonError(
      status,
      "upstream_error",
      `payment channel error: ${(err as Error).message}`,
    );
  }

  const order: OrderRecord = {
    orderId,
    userId: auth.userId,
    skuType,
    channel,
    amount,
    currency,
    amountActual: result.amountActual,
    topupAmountUsd,
    status: "pending",
    upstreamTradeId: result.upstreamTradeId,
    upstreamPaymentUrl: result.paymentUrl,
    createdAt: now,
  };
  await createOrder(order);

  return jsonResponse(201, {
    orderId,
    skuType,
    // Mirror shapeOrder() — derive planId from skuType so plan-only UI
    // surfaces stay working; null/undefined for topup.
    planId: skuTypeToPlanId(skuType) ?? undefined,
    channel,
    amount,
    currency,
    amountActual: result.amountActual,
    topupAmountUsd,
    paymentUrl: result.paymentUrl,
    qrCodeUrl: result.qrCodeUrl,
    expiresAt: result.expiresAt,
    status: "pending",
  });
};

// ---------- GET /v1/billing/orders/{orderId} ----------

export const getOrderHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const auth = await requireSession(event);
  if (isAuthFailure(auth)) {
    return jsonError(auth.status, "authentication_error", auth.message, auth.code);
  }

  const orderId = event.pathParameters?.orderId;
  if (!orderId)
    return jsonError(400, "invalid_request_error", "Missing orderId in path.");

  const rec = await getOrder(orderId);
  if (!rec) return jsonError(404, "not_found", "Order not found.");
  if (rec.userId !== auth.userId) {
    // Don't leak existence across users.
    return jsonError(404, "not_found", "Order not found.");
  }
  return jsonResponse(200, { order: shapeOrder(rec) });
};

// ---------- GET /v1/billing/orders ----------

export const listOrdersHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const auth = await requireSession(event);
  if (isAuthFailure(auth)) {
    return jsonError(auth.status, "authentication_error", auth.message, auth.code);
  }

  const orders = await listOrdersByUser(auth.userId, 50);
  return jsonResponse(200, { orders: orders.map(shapeOrder) });
};
