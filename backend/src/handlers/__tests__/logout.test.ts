import { describe, it, expect, beforeEach } from 'vitest';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { logoutHandler, meHandler } from '../authHandlers.js';
import { signSession } from '../../lib/authTokens.js';
import { init, putUser } from '../../lib/store.js';

beforeEach(() => {
  process.env.SQLITE_PATH = ':memory:';
  process.env.SESSION_SECRET = 'logout-test-secret-32bytes-min-please';
  init();
});

function authedEvent(token: string) {
  return {
    headers: { authorization: `Bearer ${token}` },
    body: '{}',
    requestContext: { http: { method: 'POST' } },
  } as any;
}

describe('POST /v1/auth/logout', () => {
  it('invalidates the bearer that called it on subsequent requests', async () => {
    const userId = 'u_logout_a';
    putUser({ userId, email: 'a@example.com', createdAt: new Date().toISOString() });
    const token = signSession(userId, 0);

    // /me works before logout
    const before = (await meHandler(authedEvent(token))) as APIGatewayProxyStructuredResultV2;
    expect(before.statusCode).toBe(200);

    // logout returns 200
    const out = (await logoutHandler(authedEvent(token))) as APIGatewayProxyStructuredResultV2;
    expect(out.statusCode).toBe(200);

    // same token now rejected with 401
    const after = (await meHandler(authedEvent(token))) as APIGatewayProxyStructuredResultV2;
    expect(after.statusCode).toBe(401);
  });

  it('also invalidates a sibling token issued before logout (all-devices)', async () => {
    const userId = 'u_logout_b';
    putUser({ userId, email: 'b@example.com', createdAt: new Date().toISOString() });
    const phoneToken = signSession(userId, 0);
    const laptopToken = signSession(userId, 0);

    // Logout via the phone — both tokens should now be dead.
    await logoutHandler(authedEvent(phoneToken));

    const fromPhone = (await meHandler(authedEvent(phoneToken))) as APIGatewayProxyStructuredResultV2;
    const fromLaptop = (await meHandler(authedEvent(laptopToken))) as APIGatewayProxyStructuredResultV2;
    expect(fromPhone.statusCode).toBe(401);
    expect(fromLaptop.statusCode).toBe(401);
  });

  it('returns 200 even when no auth header is present', async () => {
    const res = (await logoutHandler({ headers: {}, body: '{}' } as any)) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);
  });
});
