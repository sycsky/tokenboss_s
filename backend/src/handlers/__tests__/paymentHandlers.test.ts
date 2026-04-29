/**
 * paymentHandlers — focused on the sold-out gate added in this feature.
 * The full create-order happy path is integration-heavy (needs xunhupay /
 * epusdt running), so this file only covers the synchronous validation
 * branches that don't talk to upstream gateways.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

// Session signing requires SESSION_SECRET set before authTokens loads.
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
  // Make sure the public-base-url branch doesn't error out before the
  // sold-out check runs. Set env so resolvePublicBaseUrl returns a value.
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
    // Both channels should be blocked equally — sold-out is plan-scoped,
    // not channel-scoped.
    const epusdt = await run({ planId: 'ultra', channel: 'epusdt' });
    expect(epusdt.statusCode).toBe(410);
    const xunhupay = await run({ planId: 'ultra', channel: 'xunhupay' });
    expect(xunhupay.statusCode).toBe(410);
  });

  it('does NOT 410 for non-sold-out plans (Plus, Super)', async () => {
    // Plus / Super aren't sold out. They should NOT hit the 410 branch.
    // We expect 503 instead because no payment gateway is configured in
    // the test env — that's a separate downstream check, but it confirms
    // the sold-out gate didn't fire.
    const plus = await run({ planId: 'plus', channel: 'xunhupay' });
    expect(plus.statusCode).not.toBe(410);
    const sup = await run({ planId: 'super', channel: 'epusdt' });
    expect(sup.statusCode).not.toBe(410);
  });

  it('still validates planId / channel before checking sold-out', async () => {
    // Bad planId → 400, not 410. Sold-out gate must come AFTER validation.
    const badPlan = await run({ planId: 'fake', channel: 'xunhupay' });
    expect(badPlan.statusCode).toBe(400);

    const badChannel = await run({ planId: 'ultra', channel: 'paypal' });
    expect(badChannel.statusCode).toBe(400);
  });
});
