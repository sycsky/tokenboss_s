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
  type OrderRecord,
} from "../lib/store.js";
import { PLANS, isPlanId, getPlanPriceCNY, getPlanPriceUSD } from "../lib/plans.js";

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

function newOrderId(): string {
  // tb_ord_<24 hex> = 31 chars total — epusdt caps order_id at 32.
  return `tb_ord_${crypto.randomBytes(12).toString("hex")}`;
}

function shapeOrder(rec: OrderRecord) {
  return {
    orderId: rec.orderId,
    planId: rec.planId,
    channel: rec.channel,
    amount: rec.amount,
    currency: rec.currency,
    amountActual: rec.amountActual,
    status: rec.status,
    paymentUrl: rec.upstreamPaymentUrl,
    blockTxId: rec.blockTxId,
    createdAt: rec.createdAt,
    paidAt: rec.paidAt,
  };
}

// ---------- POST /v1/billing/orders ----------

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

  if (!isPlanId(body.planId))
    return jsonError(400, "invalid_request_error", "planId must be basic|standard|pro.");
  if (!isChannel(body.channel))
    return jsonError(400, "invalid_request_error", "channel must be epusdt|xunhupay.");

  const planId = body.planId;
  const channel = body.channel;
  // Block sold-out tiers at the API edge — UI hides the CTA, but we don't
  // trust the client. 410 Gone is the right semantic: the resource (plan)
  // exists historically but is no longer available for new orders.
  if (PLANS[planId].soldOut) {
    return jsonError(
      410,
      "plan_unavailable",
      `${PLANS[planId].displayName} 当前售罄，暂时无法下单。`,
      "plan_sold_out",
    );
  }
  // Channel determines pricing currency:
  //   epusdt   → USD (USDT-TRC20)
  //   xunhupay → CNY (Alipay/WeChat fiat gateway, CNY only)
  // The CNY/USD prices are independent product decisions — both are
  // editable via env overrides (PLAN_PRICE_<TIER>_CNY/_USD).
  const currency: "CNY" | "USD" = channel === "epusdt" ? "USD" : "CNY";
  const amount = currency === "USD"
    ? getPlanPriceUSD(planId)
    : getPlanPriceCNY(planId);

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

  // Call upstream FIRST. If it fails we don't want a phantom pending row
  // in our DB — the user's order list would fill with garbage. The orderId
  // is generated server-side so client retries don't collide on it.
  let result;
  try {
    result = await client.createOrder({
      orderId,
      amount,
      currency,
      planId,
      notifyUrl: `${baseUrl}/v1/billing/webhook/${channel}`,
      redirectUrl: typeof body.redirectUrl === "string"
        ? body.redirectUrl
        : `${baseUrl}/billing/success?orderId=${orderId}`,
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
    planId,
    channel,
    amount,
    currency,
    amountActual: result.amountActual,
    status: "pending",
    upstreamTradeId: result.upstreamTradeId,
    upstreamPaymentUrl: result.paymentUrl,
    createdAt: now,
  };
  await createOrder(order);

  return jsonResponse(201, {
    orderId,
    planId,
    channel,
    amount,
    currency,
    amountActual: result.amountActual,
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
