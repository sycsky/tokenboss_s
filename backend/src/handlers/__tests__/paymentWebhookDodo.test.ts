import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

process.env.SESSION_SECRET = 'test-secret-32bytes-min-aaaaaaaaaaa';
process.env.SQLITE_PATH = ':memory:';
process.env.NEWAPI_BASE_URL = 'http://newapi.test.local';
process.env.NEWAPI_ADMIN_TOKEN = 'admin-token-test';

import {
  init,
  putUser,
  createOrder,
  getOrder,
  markOrderPaidIfPending,
} from '../../lib/store.js';
import * as dodoMod from '../../lib/payment/dodo.js';
import type { DodoWebhookEvent } from '../../lib/payment/dodo.js';
import { newapi } from '../../lib/newapi.js';
import { dodoWebhookHandler } from '../paymentWebhook.js';

const userId = 'u_test_dodo_webhook';

beforeAll(async () => {
  init();
  putUser({
    userId,
    email: 'dodo@test.local',
    createdAt: new Date().toISOString(),
    newapiUserId: 77,
    newapiPassword: 'test-pwd',
  });
});

beforeEach(() => {
  vi.restoreAllMocks();
});

const event = () =>
  ({
    headers: { 'content-type': 'application/json' },
    body: '{}',
    isBase64Encoded: false,
  }) as unknown as Parameters<typeof dodoWebhookHandler>[0];

// Stub dodoFromEnv with a client whose verifyWebhook yields a fixed event,
// so the test exercises handler routing without real Standard-Webhooks HMAC.
function stubDodo(evt: DodoWebhookEvent) {
  vi.spyOn(dodoMod, 'dodoFromEnv').mockReturnValue({
    verifyWebhook: () => evt,
  } as unknown as ReturnType<typeof dodoMod.dodoFromEnv>);
}

describe('dodoWebhookHandler — payment.failed', () => {
  it('flips a pending order to failed so the user gets the retry flow', async () => {
    const orderId = 'tb_ord_dodo_failed';
    await createOrder({
      orderId,
      userId,
      skuType: 'topup',
      channel: 'dodo',
      amount: 50,
      currency: 'USD',
      topupAmountUsd: 340,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    stubDodo({
      type: 'payment.failed',
      orderId,
      upstreamTradeId: 'pay_failed_1',
      amountActual: 0,
      currency: 'USD',
    });

    const res = (await dodoWebhookHandler(event())) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);

    const back = await getOrder(orderId);
    expect(back?.status).toBe('failed');
  });

  it('never reverts an already-paid order (late failure event)', async () => {
    const orderId = 'tb_ord_dodo_late_fail';
    await createOrder({
      orderId,
      userId,
      skuType: 'topup',
      channel: 'dodo',
      amount: 50,
      currency: 'USD',
      topupAmountUsd: 340,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    await markOrderPaidIfPending({
      orderId,
      paidAt: new Date().toISOString(),
      amountActual: 340,
    });

    stubDodo({
      type: 'payment.failed',
      orderId,
      upstreamTradeId: 'pay_failed_late',
      amountActual: 0,
      currency: 'USD',
    });

    const res = (await dodoWebhookHandler(event())) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);

    const back = await getOrder(orderId);
    expect(back?.status).toBe('paid');
  });
});

describe('dodoWebhookHandler — amount integrity', () => {
  it('holds settlement (no credit) when a same-currency payment underpays', async () => {
    const orderId = 'tb_ord_dodo_underpaid';
    await createOrder({
      orderId,
      userId,
      skuType: 'topup',
      channel: 'dodo',
      amount: 50,
      currency: 'USD',
      topupAmountUsd: 340,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    const mintSpy = vi.spyOn(newapi, 'createRedemption');
    stubDodo({
      type: 'payment.succeeded',
      orderId,
      upstreamTradeId: 'pay_underpaid',
      amountActual: 30, // paid $30 for a $50 order — discount/tamper
      currency: 'USD',
    });

    const res = (await dodoWebhookHandler(event())) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);

    const back = await getOrder(orderId);
    expect(back?.status).toBe('paid'); // money did arrive
    expect(back?.settleStatus).toBe('failed'); // but credit is held for review
    expect(mintSpy).not.toHaveBeenCalled(); // never granted
  });

  it('grants credit when the paid amount matches the order', async () => {
    const orderId = 'tb_ord_dodo_exact';
    await createOrder({
      orderId,
      userId,
      skuType: 'topup',
      channel: 'dodo',
      amount: 50,
      currency: 'USD',
      topupAmountUsd: 340,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    const mintSpy = vi.spyOn(newapi, 'createRedemption').mockResolvedValue('CODE-OK');
    vi.spyOn(newapi, 'loginUser').mockResolvedValue({ cookie: 'c', userId: 77 });
    vi.spyOn(newapi, 'redeemCode').mockResolvedValue({ quotaAdded: 340 * 500_000 });

    stubDodo({
      type: 'payment.succeeded',
      orderId,
      upstreamTradeId: 'pay_exact',
      amountActual: 50,
      currency: 'USD',
    });

    const res = (await dodoWebhookHandler(event())) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);

    const back = await getOrder(orderId);
    expect(back?.status).toBe('paid');
    expect(back?.settleStatus).toBe('settled');
    expect(mintSpy).toHaveBeenCalledWith({ name: orderId, quotaUsd: 340 });
  });

  it('skips the numeric check when settlement currency differs (adaptive currency)', async () => {
    const orderId = 'tb_ord_dodo_adaptive';
    await createOrder({
      orderId,
      userId,
      skuType: 'topup',
      channel: 'dodo',
      amount: 50,
      currency: 'USD',
      topupAmountUsd: 340,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    const mintSpy = vi.spyOn(newapi, 'createRedemption').mockResolvedValue('CODE-ADP');
    vi.spyOn(newapi, 'loginUser').mockResolvedValue({ cookie: 'c', userId: 77 });
    vi.spyOn(newapi, 'redeemCode').mockResolvedValue({ quotaAdded: 340 * 500_000 });

    // Presentment currency (XAF) with a numerically smaller-than-USD-amount
    // main unit must NOT be misread as an underpayment.
    stubDodo({
      type: 'payment.succeeded',
      orderId,
      upstreamTradeId: 'pay_adaptive',
      amountActual: 29885,
      currency: 'XAF',
    });

    const res = (await dodoWebhookHandler(event())) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);

    const back = await getOrder(orderId);
    expect(back?.settleStatus).toBe('settled');
    expect(mintSpy).toHaveBeenCalled();
  });
});
