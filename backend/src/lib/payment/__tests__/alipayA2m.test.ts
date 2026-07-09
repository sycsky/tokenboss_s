/**
 * Pure-function coverage for the A2M client: Payment-Needed construction
 * (field completeness + seller_signature validity) and Payment-Proof
 * parsing. Network calls (verify/confirm) are exercised by the sandbox
 * e2e flow, not mocked here.
 */
import { describe, expect, it } from "vitest";
import crypto from "node:crypto";

import {
  createAlipayA2mClient,
  formatISO8601WithTimezone,
} from "../alipayA2m.js";

// Throwaway RSA pair — exported as raw base64 PKCS#1, same shape as the
// sandbox appPrivatePkcsKey field.
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const rawPkcs1 = privateKey
  .export({ type: "pkcs1", format: "pem" })
  .toString()
  .replace(/-----(BEGIN|END) RSA PRIVATE KEY-----|\s+/g, "");

const client = createAlipayA2mClient({
  appId: "9021000000000000",
  privateKey: rawPkcs1,
  alipayPublicKey: "unused-in-these-tests",
  gateway: "https://openapi-sandbox.dl.alipaydev.com/gateway.do",
  sellerId: "2088000000000000",
  serviceId: "svc_test",
  sellerName: "TokenBoss",
});

function decodeHeader(value: string): {
  protocol: Record<string, string>;
  method: Record<string, string>;
} {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

describe("buildPaymentNeeded", () => {
  const header = client.buildPaymentNeeded({
    outTradeNo: "tb_a2m_test123",
    amount: "50.00",
    goodsName: "TokenBoss Topup CNY 50",
    resourceId: "/v1/billing/a2m/topup?amount=50",
    payBefore: new Date("2026-07-09T12:00:00+08:00"),
    serviceId: "svc_test",
  });
  const decoded = decodeHeader(header);

  it("emits every field the 402 预检 requires, non-empty", () => {
    const required: Array<[keyof typeof decoded, string]> = [
      ["protocol", "out_trade_no"], ["protocol", "amount"],
      ["protocol", "currency"], ["protocol", "resource_id"],
      ["protocol", "pay_before"], ["protocol", "seller_signature"],
      ["protocol", "seller_sign_type"], ["protocol", "seller_unique_id"],
      ["method", "seller_name"], ["method", "seller_id"],
      ["method", "seller_app_id"], ["method", "goods_name"],
      ["method", "seller_unique_id_key"], ["method", "service_id"],
    ];
    for (const [layer, field] of required) {
      expect(decoded[layer][field], `${layer}.${field}`).toBeTruthy();
    }
    expect(decoded.protocol.seller_sign_type).toBe("RSA2");
    expect(decoded.method.seller_unique_id_key).toBe("seller_id");
  });

  it("signs the sorted key=value& string verifiably with RSA-SHA256", () => {
    const p = decoded.protocol;
    const m = decoded.method;
    const content = [
      `amount=${p.amount}`,
      `currency=${p.currency}`,
      `goods_name=${m.goods_name}`,
      `out_trade_no=${p.out_trade_no}`,
      `pay_before=${p.pay_before}`,
      `resource_id=${p.resource_id}`,
      `seller_id=${m.seller_id}`,
      `service_id=${m.service_id}`,
    ].join("&");
    const ok = crypto
      .createVerify("RSA-SHA256")
      .update(content, "utf8")
      .verify(publicKey, p.seller_signature, "base64");
    expect(ok).toBe(true);
  });

  it("uses ISO 8601 with timezone offset for pay_before", () => {
    expect(decoded.protocol.pay_before).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
    );
  });
});

describe("parsePaymentProof", () => {
  it("round-trips a well-formed proof", () => {
    const raw = {
      protocol: { payment_proof: "abc123", trade_no: "2026070900828..." },
      method: { client_session: "sess" },
    };
    const parsed = client.parsePaymentProof(
      Buffer.from(JSON.stringify(raw)).toString("base64url"),
    );
    expect(parsed).toEqual({
      paymentProof: "abc123",
      tradeNo: "2026070900828...",
      clientSession: "sess",
    });
  });

  it.each([
    ["not base64 json", "%%%"],
    ["missing payment_proof", Buffer.from(JSON.stringify({ protocol: { trade_no: "t" } })).toString("base64url")],
    ["empty trade_no", Buffer.from(JSON.stringify({ protocol: { payment_proof: "p", trade_no: "" } })).toString("base64url")],
  ])("returns null on %s", (_label, value) => {
    expect(client.parsePaymentProof(value)).toBeNull();
  });
});

describe("serviceIdFor", () => {
  it("returns the single serviceId for any amount without tiers", () => {
    expect(client.serviceIdFor("3.50")).toBe("svc_test");
    expect(client.allowedTiers()).toBeNull();
  });

  it("maps tier amounts and rejects non-tier amounts when tiers are set", () => {
    const tiered = createAlipayA2mClient({
      appId: "9021000000000000",
      privateKey: rawPkcs1,
      alipayPublicKey: "unused",
      gateway: "https://openapi.alipay.com/gateway.do",
      sellerId: "2088000000000000",
      serviceId: "svc_default",
      serviceTiers: { "0.01": "svc_a", "10": "svc_b", "50": "svc_c" },
      sellerName: "TokenBoss",
    });
    expect(tiered.serviceIdFor("10.00")).toBe("svc_b");
    expect(tiered.serviceIdFor("0.01")).toBe("svc_a");
    expect(tiered.serviceIdFor("25.00")).toBeNull();
    expect(tiered.allowedTiers()).toEqual(["0.01", "10", "50"]);
  });
});

describe("formatISO8601WithTimezone", () => {
  it("never emits the Z/ISO-string format alipay rejects", () => {
    const s = formatISO8601WithTimezone(new Date());
    expect(s).not.toContain("Z");
    expect(s).toMatch(/[+-]\d{2}:\d{2}$/);
  });
});
