import { describe, expect, it } from "vitest";
import crypto from "node:crypto";

import { DodoClient } from "../dodo.js";

const SECRET_RAW = crypto.randomBytes(24);
const SECRET = `whsec_${SECRET_RAW.toString("base64")}`;

function makeClient(overrides: Partial<{ webhookSecret: string }> = {}) {
  return new DodoClient({
    apiKey: "test-key",
    apiBase: "https://test.dodopayments.com",
    productId: "pdt_test",
    webhookSecret: overrides.webhookSecret ?? SECRET,
  });
}

/** Sign a body the way Dodo (Standard Webhooks) does. */
function sign(body: string, opts: { id?: string; ts?: number; secret?: Buffer } = {}) {
  const id = opts.id ?? "msg_1";
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  const sig = crypto
    .createHmac("sha256", opts.secret ?? SECRET_RAW)
    .update(`${id}.${ts}.${body}`, "utf8")
    .digest("base64");
  return {
    "webhook-id": id,
    "webhook-timestamp": String(ts),
    "webhook-signature": `v1,${sig}`,
  };
}

const PAID_BODY = JSON.stringify({
  business_id: "biz_1",
  type: "payment.succeeded",
  timestamp: new Date().toISOString(),
  data: {
    payload_type: "Payment",
    payment_id: "pay_123",
    total_amount: 3526,
    metadata: { orderId: "tb_ord_abc" },
  },
});

describe("DodoClient.verifyWebhook", () => {
  it("accepts a correctly signed payment.succeeded event", () => {
    const client = makeClient();
    const evt = client.verifyWebhook(sign(PAID_BODY), PAID_BODY);
    expect(evt).not.toBeNull();
    expect(evt!.type).toBe("payment.succeeded");
    expect(evt!.orderId).toBe("tb_ord_abc");
    expect(evt!.upstreamTradeId).toBe("pay_123");
    expect(evt!.amountActual).toBeCloseTo(35.26);
  });

  it("rejects a tampered body", () => {
    const client = makeClient();
    const headers = sign(PAID_BODY);
    const tampered = PAID_BODY.replace("tb_ord_abc", "tb_ord_EVIL");
    expect(client.verifyWebhook(headers, tampered)).toBeNull();
  });

  it("rejects a signature from the wrong secret", () => {
    const client = makeClient();
    const headers = sign(PAID_BODY, { secret: crypto.randomBytes(24) });
    expect(client.verifyWebhook(headers, PAID_BODY)).toBeNull();
  });

  it("rejects stale timestamps (replay window)", () => {
    const client = makeClient();
    const headers = sign(PAID_BODY, { ts: Math.floor(Date.now() / 1000) - 3600 });
    expect(client.verifyWebhook(headers, PAID_BODY)).toBeNull();
  });

  it("rejects when headers are missing", () => {
    const client = makeClient();
    expect(client.verifyWebhook({}, PAID_BODY)).toBeNull();
  });

  it("fails closed when no webhook secret is configured", () => {
    const client = new DodoClient({
      apiKey: "k",
      apiBase: "https://test.dodopayments.com",
      productId: "p",
    });
    expect(client.verifyWebhook(sign(PAID_BODY), PAID_BODY)).toBeNull();
  });

  it("accepts multi-entry signature headers (key rotation)", () => {
    const client = makeClient();
    const headers = sign(PAID_BODY);
    headers["webhook-signature"] = `v1,${Buffer.from("bogus").toString("base64")} ${headers["webhook-signature"]}`;
    const evt = client.verifyWebhook(headers, PAID_BODY);
    expect(evt).not.toBeNull();
  });

  it("rejects payment.succeeded without a payment_id", () => {
    const client = makeClient();
    const body = JSON.stringify({
      type: "payment.succeeded",
      data: { total_amount: 100, metadata: { orderId: "tb_ord_x" } },
    });
    expect(client.verifyWebhook(sign(body), body)).toBeNull();
  });

  it("still accepts refund events without a payment_id", () => {
    const client = makeClient();
    const body = JSON.stringify({
      type: "refund.succeeded",
      data: { total_amount: 100, metadata: { orderId: "tb_ord_x" } },
    });
    const evt = client.verifyWebhook(sign(body), body);
    expect(evt).not.toBeNull();
    expect(evt!.type).toBe("refund.succeeded");
  });

  it("returns null for events without an orderId in metadata", () => {
    const client = makeClient();
    const body = JSON.stringify({
      type: "payment.succeeded",
      data: { payment_id: "pay_1", total_amount: 100, metadata: {} },
    });
    expect(client.verifyWebhook(sign(body), body)).toBeNull();
  });
});
