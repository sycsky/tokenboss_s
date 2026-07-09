/**
 * Alipay A2M (Agent-to-Machine, 按量付费 / "AI收") channel client.
 *
 * Unlike epusdt/xunhupay this is NOT a redirect-and-webhook gateway, so it
 * does not implement PaymentChannelClient. The 402 protocol is:
 *
 *   1. agent hits a paid endpoint with no Payment-Proof header
 *      → we persist a pending order and reply HTTP 402 + Payment-Needed
 *        header (base64url JSON, seller_signature RSA2-signed by us)
 *   2. the user pays through Alipay's 402 skill; their agent retries the
 *      same endpoint with a Payment-Proof header
 *   3. we verify the proof via alipay.aipay.agent.payment.verify, deliver
 *      the resource (credit the topup), then confirm delivery via
 *      alipay.aipay.agent.fulfillment.confirm
 *
 * Sandbox gateway: https://openapi-sandbox.dl.alipaydev.com/gateway.do
 * Production gateway: https://openapi.alipay.com/gateway.do
 */

import { AlipaySdk } from "alipay-sdk";
import crypto from "node:crypto";

export class AlipayA2mError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlipayA2mError";
  }
}

export interface AlipayA2mConfig {
  appId: string;
  /** App private key, raw base64 PKCS#1 (the sandbox `appPrivatePkcsKey`
   *  field / the production key converted to PKCS#1). No PEM armor. */
  privateKey: string;
  /** Alipay public key, raw base64. Used by the SDK for response verify. */
  alipayPublicKey: string;
  gateway: string;
  /** Merchant 2088 id (sandbox: the pid). Goes into seller_id fields. */
  sellerId: string;
  /** Service id from服务市场注册 (onboarding stage 产物). Sandbox does not
   *  enforce it but the field must be non-empty. */
  serviceId: string;
  /** Fixed-denomination tier map: amount (CNY, e.g. "10") → serviceId.
   *  服务市场 enforces one fixed price per service (and caps it at 50元),
   *  so production registers one service per denomination. When set,
   *  only these amounts are payable; when empty, `serviceId` is used for
   *  any amount (sandbox mode — its cashier has a single 0.01 test price). */
  serviceTiers?: Record<string, string>;
  /** Display name shown to the paying user. */
  sellerName: string;
}

export interface PaymentNeededInput {
  outTradeNo: string;
  /** Amount in CNY, formatted string e.g. "50.00". */
  amount: string;
  goodsName: string;
  resourceId: string;
  /** Payment deadline. Serialized as ISO 8601 with timezone offset. */
  payBefore: Date;
  /** Tier-resolved service id (from serviceIdFor). */
  serviceId: string;
}

export interface ParsedPaymentProof {
  paymentProof: string;
  tradeNo: string;
  clientSession?: string;
}

export interface VerifyResult {
  code: string;
  subCode?: string;
  subMsg?: string;
  tradeNo?: string;
  outTradeNo?: string;
  resourceId?: string;
  amount?: string;
  active?: boolean;
}

/** ISO 8601 with numeric timezone offset (2026-05-15T12:08:36+08:00) —
 *  the format alipay requires for pay_before. */
export function formatISO8601WithTimezone(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str, "utf8").toString("base64url");
}

function base64UrlDecode(str: string): string {
  return Buffer.from(str, "base64url").toString("utf8");
}

/** node:crypto needs PEM armor; the config keeps the raw base64 string
 *  (never hand-edit the stored key — this wrapping is runtime-only). */
function pkcs1Pem(rawBase64: string): string {
  const body = rawBase64.replace(/\s+/g, "").match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----\n`;
}

export class AlipayA2mClient {
  private readonly sdk: AlipaySdk;

  /** Sandbox gateways (openapi-sandbox.dl.alipaydev.com) return empty
   *  strings for some verify fields; production must never skip checks
   *  because of an empty field — callers branch on this. */
  get isSandbox(): boolean {
    return this.cfg.gateway.includes("alipaydev");
  }

  constructor(private readonly cfg: AlipayA2mConfig) {
    this.sdk = new AlipaySdk({
      appId: cfg.appId,
      privateKey: cfg.privateKey,
      alipayPublicKey: cfg.alipayPublicKey,
      gateway: cfg.gateway,
      // sandbox returns PKCS#1 in appPrivatePkcsKey; SDK default keyType
      // is PKCS1 — set explicitly so a config skim can't misread it.
      keyType: "PKCS1",
      signType: "RSA2",
      // sandbox gateway routinely exceeds the SDK's 5s default
      timeout: 15000,
    });
  }

  /**
   * seller_signature over the protocol-critical fields: sorted by key,
   * joined as key=value&..., RSA2 (SHA256) signed with the app private key.
   */
  sellerSignature(params: Record<string, string>): string {
    const content = Object.keys(params)
      .sort()
      .filter((k) => params[k] !== null && params[k] !== "")
      .map((k) => `${k}=${params[k]}`)
      .join("&");
    return crypto
      .createSign("RSA-SHA256")
      .update(content, "utf8")
      .sign(pkcs1Pem(this.cfg.privateKey), "base64");
  }

  /**
   * Resolve the serviceId for an amount. With tiers configured, only
   * exact tier amounts are payable (null = not a tier); without tiers,
   * the single configured serviceId serves any amount.
   */
  serviceIdFor(amount: string): string | null {
    const tiers = this.cfg.serviceTiers;
    if (!tiers || Object.keys(tiers).length === 0) return this.cfg.serviceId;
    const norm = Number(amount).toFixed(2);
    for (const [k, v] of Object.entries(tiers)) {
      if (Number(k).toFixed(2) === norm) return v;
    }
    return null;
  }

  /** Payable amounts when tiers are configured; null in single-service mode. */
  allowedTiers(): string[] | null {
    const tiers = this.cfg.serviceTiers;
    if (!tiers || Object.keys(tiers).length === 0) return null;
    return Object.keys(tiers).sort((a, b) => Number(a) - Number(b));
  }

  /** Build the base64url-encoded Payment-Needed header value. */
  buildPaymentNeeded(input: PaymentNeededInput): string {
    const payBefore = formatISO8601WithTimezone(input.payBefore);
    const sellerSignature = this.sellerSignature({
      amount: input.amount,
      currency: "CNY",
      goods_name: input.goodsName,
      out_trade_no: input.outTradeNo,
      pay_before: payBefore,
      resource_id: input.resourceId,
      seller_id: this.cfg.sellerId,
      service_id: input.serviceId,
    });
    const paymentNeeded = {
      protocol: {
        out_trade_no: input.outTradeNo,
        amount: input.amount,
        currency: "CNY",
        resource_id: input.resourceId,
        pay_before: payBefore,
        seller_signature: sellerSignature,
        seller_sign_type: "RSA2",
        seller_unique_id: this.cfg.sellerId,
      },
      method: {
        seller_name: this.cfg.sellerName,
        seller_id: this.cfg.sellerId,
        seller_app_id: this.cfg.appId,
        goods_name: input.goodsName,
        seller_unique_id_key: "seller_id",
        service_id: input.serviceId,
      },
    };
    return base64UrlEncode(JSON.stringify(paymentNeeded));
  }

  /** Decode a Payment-Proof header. Returns null on any malformed input. */
  parsePaymentProof(headerValue: string): ParsedPaymentProof | null {
    try {
      const json = JSON.parse(base64UrlDecode(headerValue.trim()));
      const paymentProof = json?.protocol?.payment_proof;
      const tradeNo = json?.protocol?.trade_no;
      const clientSession = json?.method?.client_session;
      if (typeof paymentProof !== "string" || paymentProof.trim() === "") return null;
      if (typeof tradeNo !== "string" || tradeNo.trim() === "") return null;
      return {
        paymentProof,
        tradeNo,
        clientSession: typeof clientSession === "string" ? clientSession : undefined,
      };
    } catch {
      return null;
    }
  }

  /**
   * alipay.aipay.agent.payment.verify — verifies the payment credential.
   * SDK camelcases response keys by default; keep snake_case fallbacks in
   * case the flag flips.
   */
  async verifyPayment(proof: ParsedPaymentProof): Promise<VerifyResult> {
    const raw = (await this.sdk.exec("alipay.aipay.agent.payment.verify", {
      bizContent: {
        payment_proof: proof.paymentProof,
        trade_no: proof.tradeNo,
        client_session: proof.clientSession,
      },
    })) as Record<string, unknown>;
    const r = (raw.alipayAipayAgentPaymentVerifyResponse ??
      (raw as Record<string, unknown>)["alipay_aipay_agent_payment_verify_response"] ??
      raw) as Record<string, unknown>;
    const pick = (camel: string, snake: string): string | undefined => {
      const v = r[camel] ?? r[snake];
      return typeof v === "string" && v !== "" ? v : undefined;
    };
    return {
      code: String(r.code ?? ""),
      subCode: pick("subCode", "sub_code"),
      subMsg: pick("subMsg", "sub_msg"),
      tradeNo: pick("tradeNo", "trade_no"),
      outTradeNo: pick("outTradeNo", "out_trade_no"),
      resourceId: pick("resourceId", "resource_id"),
      amount: pick("amount", "amount"),
      active: (r.active ?? undefined) as boolean | undefined,
    };
  }

  /**
   * alipay.aipay.agent.fulfillment.confirm — tells alipay we delivered.
   * Returns false (never throws) so callers can keep the order in a
   * retryable PENDING_CONFIRM state.
   */
  async confirmFulfillment(tradeNo: string): Promise<boolean> {
    try {
      const raw = (await this.sdk.exec("alipay.aipay.agent.fulfillment.confirm", {
        bizContent: { trade_no: tradeNo },
      })) as Record<string, unknown>;
      const r = (raw.alipayAipayAgentFulfillmentConfirmResponse ??
        (raw as Record<string, unknown>)["alipay_aipay_agent_fulfillment_confirm_response"] ??
        raw) as Record<string, unknown>;
      if (String(r.code ?? "") === "10000") return true;
      console.error("[alipay-a2m] fulfillment.confirm rejected", {
        tradeNo,
        subCode: r.subCode ?? (r as Record<string, unknown>)["sub_code"],
        subMsg: r.subMsg ?? (r as Record<string, unknown>)["sub_msg"],
      });
      return false;
    } catch (err) {
      console.error("[alipay-a2m] fulfillment.confirm failed", {
        tradeNo,
        err: (err as Error).message,
      });
      return false;
    }
  }
}

export function createAlipayA2mClient(cfg: AlipayA2mConfig): AlipayA2mClient {
  return new AlipayA2mClient(cfg);
}

/** Build the client from ALIPAY_A2M_* env vars; null when not configured
 *  (handler replies 503, same convention as epusdtFromEnv). */
export function alipayA2mFromEnv(): AlipayA2mClient | null {
  const appId = process.env.ALIPAY_A2M_APP_ID;
  const privateKey = process.env.ALIPAY_A2M_PRIVATE_KEY;
  const alipayPublicKey = process.env.ALIPAY_A2M_ALIPAY_PUBLIC_KEY;
  const sellerId = process.env.ALIPAY_A2M_SELLER_ID;
  const serviceId = process.env.ALIPAY_A2M_SERVICE_ID;
  if (!appId || !privateKey || !alipayPublicKey || !sellerId || !serviceId) {
    return null;
  }
  let serviceTiers: Record<string, string> | undefined;
  const rawTiers = process.env.ALIPAY_A2M_SERVICE_TIERS;
  if (rawTiers) {
    try {
      const parsed = JSON.parse(rawTiers);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        serviceTiers = parsed as Record<string, string>;
      }
    } catch {
      console.error(
        "[alipay-a2m] ALIPAY_A2M_SERVICE_TIERS is not valid JSON — ignoring tier map",
      );
    }
  }
  return createAlipayA2mClient({
    appId,
    privateKey,
    alipayPublicKey,
    gateway: process.env.ALIPAY_A2M_GATEWAY ?? "https://openapi.alipay.com/gateway.do",
    sellerId,
    serviceId,
    serviceTiers,
    sellerName: process.env.ALIPAY_A2M_SELLER_NAME ?? "TokenBoss",
  });
}
