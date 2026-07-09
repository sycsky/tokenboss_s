/**
 * Alipay A2M (按量付费) 402-protocol topup endpoint.
 *
 *   GET|POST /v1/billing/a2m/topup?amount=50
 *
 * Agent-facing: the caller is an AI agent holding a TokenBoss API key
 * (sk-...), passed as `Authorization: Bearer <key>` or `?key=<key>` —
 * agents in the 402 flow can't carry our dashboard session JWT.
 *
 * Flow (see lib/payment/alipayA2m.ts for protocol details):
 *   no Payment-Proof  → persist pending order, reply 402 + Payment-Needed
 *   with Payment-Proof → verify → credit topup (the "resource") →
 *                        fulfillment.confirm → 200 + Payment-Validation
 *
 * Delivery ordering follows the A2M production rules: the order row is
 * persisted BEFORE the 402 goes out; credit is applied before the
 * fulfillment.confirm call; the order only flips to FULFILLED after
 * alipay acks the confirm — a failed confirm keeps the same
 * Payment-Proof retryable without double-crediting (settleStatus guard).
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { createHash, randomBytes } from "node:crypto";

import {
  alipayA2mFromEnv,
  type AlipayA2mClient,
} from "../lib/payment/alipayA2m.js";
import type { OrderRecord } from "../lib/payment/types.js";
import {
  claimOrderSettlement,
  createOrder,
  getLatestUnfulfilledA2mOrder,
  getOrder,
  getOrderByUpstreamTradeId,
  getUserIdByKeyHash,
  markOrderFulfillStatus,
  markOrderPaidIfPending,
  setOrderUpstreamTradeId,
} from "../lib/store.js";
import { applyTopupToUser } from "./paymentWebhook.js";

const RESOURCE_PATH = "/v1/billing/a2m/topup";
const MAX_TOPUP_AMOUNT = 99999;
const PAY_WINDOW_MS = 30 * 60 * 1000;

function jsonResponse(
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {},
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

function a2mError(
  statusCode: number,
  code: string,
  message: string,
): APIGatewayProxyResultV2 {
  return jsonResponse(statusCode, { code, message });
}

/** Resolve the paying user from their TokenBoss API key (same sha256 →
 *  api_key_index lookup chatProxyCore uses for attribution). */
function resolveUserId(event: APIGatewayProxyEventV2): string | null {
  const authHeader =
    event.headers?.authorization ?? event.headers?.Authorization ?? "";
  const bearer = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  const rawKey = bearer || event.queryStringParameters?.key || "";
  if (!rawKey) return null;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  return getUserIdByKeyHash(keyHash);
}

/** A2M is pay-per-use: fractional CNY is legitimate (最低 0.01, 即注册
 *  服务的最小单价), unlike the integer-only web topup form. Max 2 decimal
 *  places — alipay amounts are 分-precision. */
function parseAmount(event: APIGatewayProxyEventV2): number | null {
  const raw = event.queryStringParameters?.amount;
  if (!raw || !/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0.01 || n > MAX_TOPUP_AMOUNT) {
    return null;
  }
  return n;
}

// ---------- 402: no Payment-Proof — issue a payment request ----------

async function issuePaymentNeeded(
  event: APIGatewayProxyEventV2,
  client: AlipayA2mClient,
): Promise<APIGatewayProxyResultV2> {
  const userId = resolveUserId(event);
  if (!userId) {
    return a2mError(
      401,
      "INVALID_API_KEY",
      "Pass your TokenBoss API key as `Authorization: Bearer sk-...` or `?key=sk-...` so we know whose balance to credit.",
    );
  }

  const amount = parseAmount(event);
  if (amount === null) {
    return a2mError(
      400,
      "INVALID_AMOUNT",
      `amount (query param) must be a CNY value between 0.01 and ${MAX_TOPUP_AMOUNT} with at most 2 decimals.`,
    );
  }

  const orderId = `tb_a2m_${randomBytes(12).toString("hex")}`;
  const amountStr = amount.toFixed(2);
  // 服务市场 enforces amount == the registered service's fixed price, so
  // production only accepts the registered denominations.
  const serviceId = client.serviceIdFor(amountStr);
  if (!serviceId) {
    return a2mError(
      400,
      "INVALID_AMOUNT",
      `amount must be one of the registered denominations (CNY): ${client.allowedTiers()?.join(", ")}.`,
    );
  }
  const resourceId = `${RESOURCE_PATH}?amount=${amount}`;
  const goodsName = `TokenBoss Topup CNY ${amount}`;
  const payBefore = new Date(Date.now() + PAY_WINDOW_MS);

  // Persist BEFORE replying 402 — the payment link dies with the process
  // otherwise (in-memory orders can't be fulfilled after a restart).
  const order: OrderRecord = {
    orderId,
    userId,
    skuType: "topup",
    channel: "alipay_a2m",
    amount,
    currency: "CNY",
    topupAmountUsd: amount, // ¥1 = $1 baseline, same as xunhupay topups
    status: "pending",
    resourceId,
    payBefore: payBefore.toISOString(),
    createdAt: new Date().toISOString(),
  };
  await createOrder(order);

  const paymentNeeded = client.buildPaymentNeeded({
    outTradeNo: orderId,
    amount: amountStr,
    goodsName,
    resourceId,
    payBefore,
    serviceId,
  });

  console.info("[a2m] payment-needed issued", { orderId, userId, amount });
  return jsonResponse(
    402,
    {
      code: "Payment-Needed",
      message: `Pay ${amountStr} CNY via Alipay, then retry this request with the Payment-Proof header.`,
      out_trade_no: orderId,
      amount: amountStr,
      currency: "CNY",
      resource_id: resourceId,
      goods_name: goodsName,
    },
    { "Payment-Needed": paymentNeeded },
  );
}

// ---------- 200: Payment-Proof present — verify, credit, confirm ----------

/** Payment-Proof is a small base64url JSON envelope; anything bigger is
 *  garbage and not worth a decode attempt (or an Alipay round-trip). */
const MAX_PROOF_HEADER_BYTES = 8192;

async function verifyAndDeliver(
  event: APIGatewayProxyEventV2,
  client: AlipayA2mClient,
  proofHeader: string,
): Promise<APIGatewayProxyResultV2> {
  // Same API-key gate as the 402 leg. Without it, the proof path is an
  // unauthenticated Alipay-verify amplification surface, and a stolen
  // proof could probe orders that belong to someone else.
  const userId = resolveUserId(event);
  if (!userId) {
    return a2mError(
      401,
      "INVALID_API_KEY",
      "Pass your TokenBoss API key as `Authorization: Bearer sk-...` or `?key=sk-...` (same key used on the 402 request).",
    );
  }

  if (proofHeader.length > MAX_PROOF_HEADER_BYTES) {
    return a2mError(400, "INVALID_PAYMENT_PROOF_FORMAT", "Payment-Proof header too large.");
  }

  const proof = client.parsePaymentProof(proofHeader);
  if (!proof) {
    return a2mError(
      400,
      "INVALID_PAYMENT_PROOF_FORMAT",
      "Payment-Proof header must be base64url JSON with protocol.payment_proof and protocol.trade_no.",
    );
  }

  let verify;
  try {
    verify = await client.verifyPayment(proof);
  } catch (err) {
    console.error("[a2m] payment.verify call failed", {
      tradeNo: proof.tradeNo,
      err: (err as Error).message,
    });
    return a2mError(502, "VERIFY_FAILED", "Payment verification failed, please retry.");
  }

  if (verify.code !== "10000") {
    return a2mError(
      400,
      verify.subCode ?? "VERIFY_REJECTED",
      verify.subMsg ?? "Payment credential rejected by Alipay.",
    );
  }
  if (verify.active !== true) {
    return a2mError(400, "INVALID_PAYMENT_PROOF", "Payment credential is invalid or expired.");
  }

  // Sandbox omits some verify fields (empty strings). Production must
  // treat missing critical fields as an anomalous credential — never
  // carry the sandbox tolerance below into real traffic.
  if (!client.isSandbox && (!verify.outTradeNo || !verify.resourceId || !verify.amount)) {
    console.error("[a2m] verify response missing critical fields on production gateway", {
      tradeNo: verify.tradeNo ?? proof.tradeNo,
      hasOutTradeNo: !!verify.outTradeNo,
      hasResourceId: !!verify.resourceId,
      hasAmount: !!verify.amount,
    });
    return a2mError(
      502,
      "VERIFY_ANOMALY",
      "Payment verification returned incomplete data; treated as an anomalous credential.",
    );
  }

  // Map back to OUR order. Prefer verify's out_trade_no; sandbox may
  // return it empty, so fall back to the trade_no we stamped on a
  // previous verify attempt. Never skip this mapping.
  const tradeNo = verify.tradeNo ?? proof.tradeNo;
  let order =
    (verify.outTradeNo ? await getOrder(verify.outTradeNo) : null) ??
    (await getOrderByUpstreamTradeId(tradeNo));
  if (!order && client.isSandbox && !verify.outTradeNo) {
    // Sandbox first-attempt gap: verify returned no out_trade_no and no
    // earlier attempt stamped the trade_no yet. Scope the guess to the
    // caller's own newest unfulfilled a2m order. Production never takes
    // this branch (strict mode 502s on the empty field above).
    order = await getLatestUnfulfilledA2mOrder(userId);
  }
  if (!order || order.channel !== "alipay_a2m" || order.skuType !== "topup") {
    console.warn("[a2m] no matching local order", {
      outTradeNo: verify.outTradeNo,
      tradeNo,
    });
    return a2mError(404, "ORDER_NOT_FOUND", "No matching order for this payment credential.");
  }
  if (order.userId !== userId) {
    // Valid alipay credential but someone else's order — don't leak its
    // existence; same 404 as an unknown order.
    console.warn("[a2m] proof/key user mismatch", { orderId: order.orderId });
    return a2mError(404, "ORDER_NOT_FOUND", "No matching order for this payment credential.");
  }

  // 资源防串: only enforce when alipay echoes a non-empty resource_id
  // (sandbox omits it); production treats a mismatch as an attack.
  if (verify.resourceId && order.resourceId && verify.resourceId !== order.resourceId) {
    return a2mError(403, "RESOURCE_ID_MISMATCH", "Paid resource does not match this order.");
  }
  if (verify.amount && Number(verify.amount) !== order.amount) {
    return a2mError(403, "AMOUNT_MISMATCH", "Paid amount does not match this order.");
  }

  if (!order.upstreamTradeId) {
    await setOrderUpstreamTradeId({ orderId: order.orderId, upstreamTradeId: tradeNo });
  }

  // Idempotent replay: already delivered and confirmed — don't re-credit.
  if (order.fulfillStatus === "FULFILLED") {
    return deliveredResponse(order, tradeNo, true);
  }

  if (order.status === "pending") {
    await markOrderPaidIfPending({
      orderId: order.orderId,
      paidAt: new Date().toISOString(),
      amountActual: order.amount,
    });
  }

  // Credit the topup (this IS the resource). claimOrderSettlement is an
  // atomic conditional UPDATE — of N concurrent retries carrying the same
  // proof, exactly one wins the claim and runs the credit; the rest see
  // 'crediting'/'settled' on a fresh read. A confirm-failed retry lands
  // in the settled branch and skips straight to the confirm call below.
  if (order.settleStatus !== "settled") {
    const claimed = await claimOrderSettlement(order.orderId);
    if (claimed) {
      const fresh = await getOrder(order.orderId);
      const credited = fresh ? await applyTopupToUser(fresh, "alipay_a2m") : false;
      if (!credited) {
        return a2mError(
          502,
          "SETTLE_FAILED",
          "Payment verified but crediting failed. Retry with the same Payment-Proof.",
        );
      }
    } else {
      const fresh = await getOrder(order.orderId);
      if (fresh?.settleStatus !== "settled") {
        return a2mError(
          409,
          "SETTLE_IN_PROGRESS",
          "Another request is crediting this payment. Retry with the same Payment-Proof shortly.",
        );
      }
    }
  }

  // Receipt: PENDING_CONFIRM until alipay acks fulfillment.confirm.
  await markOrderFulfillStatus({ orderId: order.orderId, fulfillStatus: "PENDING_CONFIRM" });
  const confirmed = await client.confirmFulfillment(tradeNo);
  if (!confirmed) {
    return a2mError(
      502,
      "FULFILLMENT_CONFIRM_FAILED",
      "Topup credited but fulfillment confirm failed. Retry with the same Payment-Proof.",
    );
  }
  await markOrderFulfillStatus({ orderId: order.orderId, fulfillStatus: "FULFILLED" });

  console.info("[a2m] topup delivered", {
    orderId: order.orderId,
    userId: order.userId,
    tradeNo,
    topupAmountUsd: order.topupAmountUsd,
  });
  return deliveredResponse(order, tradeNo, false);
}

function deliveredResponse(
  order: OrderRecord,
  tradeNo: string,
  alreadyFulfilled: boolean,
): APIGatewayProxyResultV2 {
  const paymentValidation = Buffer.from(
    JSON.stringify({
      trade_no: tradeNo,
      out_trade_no: order.orderId,
      validated: true,
      resource_id: order.resourceId,
    }),
    "utf8",
  ).toString("base64url");
  return jsonResponse(
    200,
    {
      resource_id: order.resourceId,
      out_trade_no: order.orderId,
      trade_no: tradeNo,
      credited_usd: order.topupAmountUsd,
      already_fulfilled: alreadyFulfilled,
      fulfillment_confirmed: true,
      message: alreadyFulfilled
        ? "This payment was already credited — no double charge."
        : `Topup of $${order.topupAmountUsd} credited to your TokenBoss balance.`,
    },
    { "Payment-Validation": paymentValidation },
  );
}

// ---------- GET|POST /v1/billing/a2m/topup ----------

export const a2mTopupHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const client = alipayA2mFromEnv();
  if (!client) {
    return a2mError(
      503,
      "A2M_NOT_CONFIGURED",
      "Alipay A2M is not configured (set ALIPAY_A2M_APP_ID / ALIPAY_A2M_PRIVATE_KEY / ALIPAY_A2M_ALIPAY_PUBLIC_KEY / ALIPAY_A2M_SELLER_ID / ALIPAY_A2M_SERVICE_ID).",
    );
  }

  const proofHeader =
    event.headers?.["payment-proof"] ?? event.headers?.["Payment-Proof"] ?? "";
  if (!proofHeader || proofHeader.trim() === "") {
    return issuePaymentNeeded(event, client);
  }
  return verifyAndDeliver(event, client, proofHeader);
};
