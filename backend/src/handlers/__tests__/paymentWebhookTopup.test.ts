import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

process.env.SESSION_SECRET = 'test-secret-32bytes-min-aaaaaaaaaaa';
process.env.SQLITE_PATH = ':memory:';
process.env.NEWAPI_BASE_URL = 'http://newapi.test.local';
process.env.NEWAPI_ADMIN_TOKEN = 'admin-token-test';
process.env.XUNHUPAY_APPID = 'test-appid';
process.env.XUNHUPAY_APPSECRET = 'test-secret';

import { init, putUser, createOrder, getOrder } from '../../lib/store.js';
import { newapi } from '../../lib/newapi.js';
import * as xun from '../../lib/payment/xunhupay.js';
import { xunhupayWebhookHandler } from '../paymentWebhook.js';

const userId = 'u_test_topup_webhook';

beforeAll(async () => {
  init();
  putUser({
    userId,
    email: 'topup@test.local',
    createdAt: new Date().toISOString(),
    newapiUserId: 42,
    newapiPassword: 'test-pwd',
  });
});

beforeEach(() => {
  vi.restoreAllMocks();
});

function makeWebhookEvent(body: Record<string, unknown>) {
  return {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body as Record<string, string>).toString(),
    isBase64Encoded: false,
  } as unknown as Parameters<typeof xunhupayWebhookHandler>[0];
}

describe('xunhupayWebhookHandler — topup orders', () => {
  it('mints a redemption code and applies it to the user', async () => {
    const orderId = 'tb_ord_webhook_topup_a';
    await createOrder({
      orderId,
      userId,
      skuType: 'topup',
      channel: 'xunhupay',
      amount: 50,
      currency: 'CNY',
      topupAmountUsd: 50,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    // Mock the channel's signature verification.
    const client = xun.xunhupayFromEnv();
    vi.spyOn(client!, 'verifyCallback').mockReturnValue({
      orderId,
      upstreamTradeId: 'upstream-id',
      amountActual: 50,
      status: 'paid',
    });
    vi.spyOn(xun, 'xunhupayFromEnv').mockReturnValue(client);

    const mintSpy = vi
      .spyOn(newapi, 'createRedemption')
      .mockResolvedValue('CODE-MINTED-XYZ');
    const loginSpy = vi
      .spyOn(newapi, 'loginUser')
      .mockResolvedValue({ cookie: 'sess=abc', userId: 42 });
    const redeemSpy = vi
      .spyOn(newapi, 'redeemCode')
      .mockResolvedValue({ quotaAdded: 50 * 500_000 });

    const res = (await xunhupayWebhookHandler(makeWebhookEvent({}))) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('success');

    expect(mintSpy).toHaveBeenCalledWith({ name: orderId, quotaUsd: 50 });
    expect(loginSpy).toHaveBeenCalled();
    expect(redeemSpy).toHaveBeenCalledWith(
      expect.objectContaining({ cookie: 'sess=abc', userId: 42 }),
      'CODE-MINTED-XYZ',
    );

    const back = await getOrder(orderId);
    expect(back?.status).toBe('paid');
    expect(back?.settleStatus).toBe('settled');
  });

  it('marks settleStatus=failed when newapi redeem throws', async () => {
    const orderId = 'tb_ord_webhook_topup_failed';
    await createOrder({
      orderId,
      userId,
      skuType: 'topup',
      channel: 'xunhupay',
      amount: 25,
      currency: 'CNY',
      topupAmountUsd: 25,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    const client = xun.xunhupayFromEnv();
    vi.spyOn(client!, 'verifyCallback').mockReturnValue({
      orderId,
      upstreamTradeId: 'u-2',
      amountActual: 25,
      status: 'paid',
    });
    vi.spyOn(xun, 'xunhupayFromEnv').mockReturnValue(client);
    vi.spyOn(newapi, 'createRedemption').mockResolvedValue('CODE-X');
    vi.spyOn(newapi, 'loginUser').mockResolvedValue({ cookie: 'c', userId: 42 });
    vi.spyOn(newapi, 'redeemCode').mockRejectedValue(
      new Error('newapi rejected'),
    );

    const res = (await xunhupayWebhookHandler(makeWebhookEvent({}))) as APIGatewayProxyStructuredResultV2;
    // We STILL ack 200 to stop gateway retries — order is paid.
    expect(res.statusCode).toBe(200);

    const back = await getOrder(orderId);
    expect(back?.status).toBe('paid');
    expect(back?.settleStatus).toBe('failed');
  });

  it('does not mint twice on duplicate webhook delivery', async () => {
    const orderId = 'tb_ord_webhook_topup_dup';
    await createOrder({
      orderId,
      userId,
      skuType: 'topup',
      channel: 'xunhupay',
      amount: 10,
      currency: 'CNY',
      topupAmountUsd: 10,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    const client = xun.xunhupayFromEnv();
    vi.spyOn(client!, 'verifyCallback').mockReturnValue({
      orderId,
      upstreamTradeId: 'u-3',
      amountActual: 10,
      status: 'paid',
    });
    vi.spyOn(xun, 'xunhupayFromEnv').mockReturnValue(client);
    const mintSpy = vi.spyOn(newapi, 'createRedemption').mockResolvedValue('CODE-Y');
    vi.spyOn(newapi, 'loginUser').mockResolvedValue({ cookie: 'c', userId: 42 });
    vi.spyOn(newapi, 'redeemCode').mockResolvedValue({ quotaAdded: 10 * 500_000 });

    await xunhupayWebhookHandler(makeWebhookEvent({}));
    await xunhupayWebhookHandler(makeWebhookEvent({}));
    await xunhupayWebhookHandler(makeWebhookEvent({}));

    expect(mintSpy).toHaveBeenCalledTimes(1);
  });
});
