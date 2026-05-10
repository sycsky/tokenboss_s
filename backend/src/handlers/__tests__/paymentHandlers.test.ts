/**
 * paymentHandlers tests — covers the synchronous validation branches
 * (sold-out gate, type discriminator, topup amount checks). The full
 * upstream call paths (xunhupay/epusdt) require a live gateway and live
 * in scripts/probe-* end-to-end.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

process.env.SESSION_SECRET = 'test-secret-32bytes-min-aaaaaaaaaaa';

import { init, putUser } from '../../lib/store.js';
import { signSession } from '../../lib/authTokens.js';
import { createOrderHandler } from '../paymentHandlers.js';

const userId = 'u_test_paymenthandlers';
let token: string;

beforeAll(() => {
  process.env.SQLITE_PATH = ':memory:';
  init();
  putUser({
    userId,
    email: 'pay@test.local',
    createdAt: new Date().toISOString(),
  });
  token = signSession(userId);
});

beforeEach(() => {
  process.env.PUBLIC_BASE_URL = 'https://api.test.local';
});

function makePostEvent(body: Record<string, unknown>) {
  return {
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as unknown as Parameters<typeof createOrderHandler>[0];
}

async function run(body: Record<string, unknown>) {
  return (await createOrderHandler(makePostEvent(body))) as APIGatewayProxyStructuredResultV2;
}

describe('createOrderHandler — sold-out gate', () => {
  it('returns 410 plan_unavailable when the requested plan is sold out (Ultra)', async () => {
    const res = await run({ planId: 'ultra', channel: 'xunhupay' });
    expect(res.statusCode).toBe(410);
    const body = JSON.parse(res.body as string);
    expect(body.error.type).toBe('plan_unavailable');
    expect(body.error.code).toBe('plan_sold_out');
    expect(body.error.message).toContain('Ultra');
  });

  it('410 sold-out fires regardless of channel selection', async () => {
    const epusdt = await run({ planId: 'ultra', channel: 'epusdt' });
    expect(epusdt.statusCode).toBe(410);
    const xunhupay = await run({ planId: 'ultra', channel: 'xunhupay' });
    expect(xunhupay.statusCode).toBe(410);
  });

  it('410 sold-out fires for Plus and Super too (membership-paused)', async () => {
    // 自 pause-membership-tiers 改造起，三档都 soldOut=true。任何无该档
    // 活跃订阅的用户下单都被 410 拦下，文案带对应 plan 的 displayName。
    const plus = await run({ planId: 'plus', channel: 'xunhupay' });
    expect(plus.statusCode).toBe(410);
    expect(JSON.parse(plus.body as string).error.code).toBe('plan_sold_out');

    const sup = await run({ planId: 'super', channel: 'epusdt' });
    expect(sup.statusCode).toBe(410);
    expect(JSON.parse(sup.body as string).error.code).toBe('plan_sold_out');
  });

  it('still validates planId / channel before checking sold-out', async () => {
    const badPlan = await run({ planId: 'fake', channel: 'xunhupay' });
    expect(badPlan.statusCode).toBe(400);
    const badChannel = await run({ planId: 'ultra', channel: 'paypal' });
    expect(badChannel.statusCode).toBe(400);
  });
});

describe('createOrderHandler — sold-out 全员拦截（含同档持有者）', () => {
  // 设计修正：webhook applyPlanToUser 会 invalidate 旧订阅，同档自助续费
  // 会损失剩余时长，因此 sold-out 期间所有用户（含现有同档订阅者）一律 410。
  // 续费走 contact sales modal，admin 手动处理避开 applyPlanToUser 陷阱。
  // 这些 case 是回归测试，确保即便其他用户字段被设置也不会意外放行。
  const sameUser = 'u_test_same_tier_holder';
  let sameUserToken: string;

  beforeAll(() => {
    putUser({
      userId: sameUser,
      email: 'same@test.local',
      createdAt: new Date().toISOString(),
      plan: 'ultra', // 即便本地 plan 字段被设置（V3 之前的脏数据），仍然要 410
    });
    sameUserToken = signSession(sameUser);
  });

  function runAs(user: { token: string }, body: Record<string, unknown>) {
    const evt = {
      headers: { authorization: `Bearer ${user.token}` },
      body: JSON.stringify(body),
      isBase64Encoded: false,
    } as unknown as Parameters<typeof createOrderHandler>[0];
    return createOrderHandler(evt) as Promise<APIGatewayProxyStructuredResultV2>;
  }

  it('已持有 Ultra 的用户提交 Ultra 下单仍 410（无续费豁免）', async () => {
    const res = await runAs({ token: sameUserToken }, {
      planId: 'ultra',
      channel: 'xunhupay',
    });
    expect(res.statusCode).toBe(410);
    expect(JSON.parse(res.body as string).error.code).toBe('plan_sold_out');
  });

  it('已持有 Plus 的用户跨档买 Ultra 仍 410', async () => {
    const plusUserId = 'u_test_plus_subscriber';
    putUser({
      userId: plusUserId,
      email: 'plus@test.local',
      createdAt: new Date().toISOString(),
      plan: 'plus',
    });
    const plusToken = signSession(plusUserId);
    const res = await runAs({ token: plusToken }, {
      planId: 'ultra',
      channel: 'xunhupay',
    });
    expect(res.statusCode).toBe(410);
  });

  it('无订阅用户买任意 sold-out 档都 410', async () => {
    const res = await run({ planId: 'ultra', channel: 'xunhupay' });
    expect(res.statusCode).toBe(410);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('plan_sold_out');
  });
});

describe('createOrderHandler — type discriminator', () => {
  it('defaults to type="plan" when omitted (back-compat)', async () => {
    // Plus is not sold out → 410 ruled out. Without payment gateway env it
    // falls through to 503 on the channel client. The point: not 400.
    const res = await run({ planId: 'plus', channel: 'xunhupay' });
    expect(res.statusCode).not.toBe(400);
  });

  it('rejects unknown type value', async () => {
    const res = await run({ type: 'subscription', planId: 'plus', channel: 'xunhupay' });
    expect(res.statusCode).toBe(400);
  });
});

describe('createOrderHandler — type=topup validation', () => {
  it('400 invalid_amount when amount missing', async () => {
    const res = await run({ type: 'topup', channel: 'xunhupay' });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('invalid_amount');
  });

  it('400 invalid_amount when amount is not an integer', async () => {
    for (const amount of [1.5, 0, -10, 100000, NaN, '10']) {
      const res = await run({ type: 'topup', amount, channel: 'xunhupay' });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body as string);
      expect(body.error.code).toBe('invalid_amount');
    }
  });

  it('accepts integer amount in valid range and proceeds past validation', async () => {
    // No payment gateway configured in test env → expect 503 on the
    // channel client step, NOT 400/410. This proves validation passed.
    const res = await run({ type: 'topup', amount: 100, channel: 'xunhupay' });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(410);
  });

  it('ignores client-supplied currency (server derives from channel)', async () => {
    const res = await run({
      type: 'topup',
      amount: 100,
      channel: 'xunhupay',
      currency: 'USD', // adversarial — should be silently ignored
    });
    expect(res.statusCode).not.toBe(400);
  });

  it('ignores planId on topup orders', async () => {
    const res = await run({
      type: 'topup',
      amount: 100,
      channel: 'xunhupay',
      planId: 'ultra', // adversarial — should not trigger sold-out gate
    });
    expect(res.statusCode).not.toBe(410);
  });
});
