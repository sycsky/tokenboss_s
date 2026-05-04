/**
 * Admin handler tests.
 *
 * Covers:
 *   - login success / fail / 503-when-unconfigured
 *   - constant ~800ms delay on failed login
 *   - IP lockout after 5 failures
 *   - listUsers pagination + search across email/userId/displayName
 *   - getUser returns plaintext newapiPassword + computed newapiUsername
 *   - role isolation (user JWT denied on admin route, admin JWT denied
 *     on /v1/me)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

import {
  adminGetUserHandler,
  adminListUsersHandler,
  adminLoginHandler,
} from '../adminHandlers.js';
import { meHandler } from '../authHandlers.js';
import { signAdminSession } from '../../lib/adminAuth.js';
import { signSession } from '../../lib/authTokens.js';
import { init, putUser } from '../../lib/store.js';

const ADMIN_USER = 'tb-admin';
const ADMIN_PASS = 'super-secret-admin-pw';

// Reset module-level lockout state between tests by re-importing the
// adminAuth module fresh. Vitest's resetModules clears the require cache;
// this keeps lockout assertions independent.
beforeEach(async () => {
  process.env.SQLITE_PATH = ':memory:';
  process.env.SESSION_SECRET = 'admin-test-secret-32bytes-min-please';
  process.env.TB_ADMIN_USERNAME = ADMIN_USER;
  process.env.TB_ADMIN_PASSWORD = ADMIN_PASS;
  delete process.env.NODE_ENV; // skip the 12-char production guard
  vi.resetModules();
  init();
});

afterEach(() => {
  delete process.env.TB_ADMIN_USERNAME;
  delete process.env.TB_ADMIN_PASSWORD;
});

function jsonEvent(
  body: Record<string, unknown> | undefined,
  opts: {
    auth?: string;
    query?: Record<string, string>;
    path?: Record<string, string>;
    ip?: string;
  } = {},
) {
  return {
    headers: opts.auth ? { authorization: `Bearer ${opts.auth}` } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    queryStringParameters: opts.query ?? {},
    pathParameters: opts.path ?? {},
    requestContext: { http: { method: 'POST', sourceIp: opts.ip ?? '1.2.3.4' } },
  } as any;
}

function parseBody(res: APIGatewayProxyStructuredResultV2): any {
  return JSON.parse(res.body!);
}

describe('POST /v1/admin/login', () => {
  it('returns 200 + admin JWT on correct creds', async () => {
    const res = (await adminLoginHandler(
      jsonEvent({ username: ADMIN_USER, password: ADMIN_PASS }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);
    const body = parseBody(res);
    expect(typeof body.token).toBe('string');
    expect(body.username).toBe(ADMIN_USER);
  });

  it('returns 401 on wrong password and waits ~800ms', async () => {
    const start = Date.now();
    const res = (await adminLoginHandler(
      jsonEvent({ username: ADMIN_USER, password: 'wrong' }),
    )) as APIGatewayProxyStructuredResultV2;
    const elapsed = Date.now() - start;
    expect(res.statusCode).toBe(401);
    expect(parseBody(res).error.code).toBe('invalid_credentials');
    // Allow some jitter — the delay is fixed at 800ms but test runners
    // can shave a few ms off setTimeout. Lower bound 600 catches the
    // case where someone removed the delay entirely.
    expect(elapsed).toBeGreaterThanOrEqual(600);
  });

  it('returns 503 when admin env vars are unset', async () => {
    delete process.env.TB_ADMIN_USERNAME;
    delete process.env.TB_ADMIN_PASSWORD;
    const res = (await adminLoginHandler(
      jsonEvent({ username: 'anything', password: 'anything' }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(503);
    expect(parseBody(res).error.code).toBe('admin_not_configured');
  });

  it('locks out an IP after 5 failed attempts', async () => {
    for (let i = 0; i < 5; i++) {
      await adminLoginHandler(
        jsonEvent({ username: ADMIN_USER, password: 'wrong' }, { ip: '9.9.9.9' }),
      );
    }
    // 6th attempt — even with correct password, should be 429 from lockout.
    const res = (await adminLoginHandler(
      jsonEvent({ username: ADMIN_USER, password: ADMIN_PASS }, { ip: '9.9.9.9' }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(429);
    expect(parseBody(res).error.code).toBe('ip_locked');
  }, 10_000); // 5 attempts × 800ms = 4s, plus margin

  it('successful login clears prior failures', async () => {
    // 3 failures + 1 success — subsequent failures should restart the count.
    for (let i = 0; i < 3; i++) {
      await adminLoginHandler(
        jsonEvent({ username: ADMIN_USER, password: 'wrong' }, { ip: '8.8.8.8' }),
      );
    }
    const ok = (await adminLoginHandler(
      jsonEvent({ username: ADMIN_USER, password: ADMIN_PASS }, { ip: '8.8.8.8' }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(ok.statusCode).toBe(200);
    // Now 5 more failures should NOT lock out (counter was cleared).
    for (let i = 0; i < 4; i++) {
      const r = await adminLoginHandler(
        jsonEvent({ username: ADMIN_USER, password: 'wrong' }, { ip: '8.8.8.8' }),
      );
      expect((r as APIGatewayProxyStructuredResultV2).statusCode).toBe(401);
    }
  }, 15_000);
});

describe('GET /v1/admin/users', () => {
  beforeEach(() => {
    putUser({ userId: 'u_a1', email: 'alice@x.com', displayName: 'Alice', createdAt: '2026-01-01T00:00:00Z', newapiUserId: 100, newapiPassword: 'np-a' });
    putUser({ userId: 'u_b2', email: 'bob@x.com', displayName: 'Bob', createdAt: '2026-02-01T00:00:00Z', newapiUserId: 101, newapiPassword: 'np-b' });
    putUser({ userId: 'u_c3', email: 'carol@y.com', displayName: 'Carol', createdAt: '2026-03-01T00:00:00Z', newapiUserId: 102, newapiPassword: 'np-c' });
  });

  it('returns full list when no query and admin is authed', async () => {
    const token = signAdminSession(ADMIN_USER);
    const res = (await adminListUsersHandler(
      jsonEvent(undefined, { auth: token }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);
    const body = parseBody(res);
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(3);
    // newest first
    expect(body.items[0].userId).toBe('u_c3');
  });

  it('filters by email substring (server-side q)', async () => {
    const token = signAdminSession(ADMIN_USER);
    const res = (await adminListUsersHandler(
      jsonEvent(undefined, { auth: token, query: { q: 'y.com' } }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);
    const body = parseBody(res);
    expect(body.total).toBe(1);
    expect(body.items[0].email).toBe('carol@y.com');
  });

  it('filters by userId substring (q matches u_a1)', async () => {
    const token = signAdminSession(ADMIN_USER);
    const res = (await adminListUsersHandler(
      jsonEvent(undefined, { auth: token, query: { q: 'u_a' } }),
    )) as APIGatewayProxyStructuredResultV2;
    const body = parseBody(res);
    expect(body.total).toBe(1);
    expect(body.items[0].userId).toBe('u_a1');
  });

  it('paginates with limit + offset', async () => {
    const token = signAdminSession(ADMIN_USER);
    const r1 = (await adminListUsersHandler(
      jsonEvent(undefined, { auth: token, query: { limit: '1', offset: '0' } }),
    )) as APIGatewayProxyStructuredResultV2;
    const r2 = (await adminListUsersHandler(
      jsonEvent(undefined, { auth: token, query: { limit: '1', offset: '1' } }),
    )) as APIGatewayProxyStructuredResultV2;
    const b1 = parseBody(r1);
    const b2 = parseBody(r2);
    expect(b1.total).toBe(3);
    expect(b1.items).toHaveLength(1);
    expect(b2.items).toHaveLength(1);
    expect(b1.items[0].userId).not.toBe(b2.items[0].userId);
  });

  it('rejects request without admin token (401)', async () => {
    const res = (await adminListUsersHandler(
      jsonEvent(undefined),
    )) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /v1/admin/users/{userId}', () => {
  it('returns full user with newapi creds', async () => {
    putUser({
      userId: 'u_2a1cbcaf18dc9254fbeb',
      email: 'real@example.com',
      displayName: 'Real Person',
      createdAt: '2026-03-01T00:00:00Z',
      newapiUserId: 72,
      newapiPassword: 'aGn3R4nDoMpAsS',
      plan: 'plus',
      subscriptionStartedAt: '2026-04-01T00:00:00Z',
      subscriptionExpiresAt: '2026-04-29T00:00:00Z',
      dailyQuotaUsd: 10,
    });
    const token = signAdminSession(ADMIN_USER);
    const res = (await adminGetUserHandler(
      jsonEvent(undefined, { auth: token, path: { userId: 'u_2a1cbcaf18dc9254fbeb' } }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);
    const body = parseBody(res);
    expect(body.user.email).toBe('real@example.com');
    expect(body.user.newapi.userId).toBe(72);
    expect(body.user.newapi.username).toBe('2a1cbcaf18dc9254fbeb');
    expect(body.user.newapi.password).toBe('aGn3R4nDoMpAsS');
    expect(body.user.subscription.plan).toBe('plus');
  });

  it('404 when userId not found', async () => {
    const token = signAdminSession(ADMIN_USER);
    const res = (await adminGetUserHandler(
      jsonEvent(undefined, { auth: token, path: { userId: 'u_does_not_exist' } }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(404);
  });
});

describe('role isolation between user and admin JWTs', () => {
  it('a user JWT is rejected on admin routes', async () => {
    const userId = 'u_normal';
    putUser({ userId, email: 'normal@x.com', createdAt: '2026-01-01T00:00:00Z' });
    const userToken = signSession(userId, 0);

    const res = (await adminListUsersHandler(
      jsonEvent(undefined, { auth: userToken }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(401);
    expect(parseBody(res).error.code).toBe('invalid_session');
  });

  it('an admin JWT is rejected on /v1/me (user route)', async () => {
    const adminToken = signAdminSession(ADMIN_USER);
    const res = (await meHandler(
      jsonEvent(undefined, { auth: adminToken }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(401);
  });
});
