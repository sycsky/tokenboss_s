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
    });

    const res = (await dodoWebhookHandler(event())) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);

    const back = await getOrder(orderId);
    expect(back?.status).toBe('paid');
  });
});
