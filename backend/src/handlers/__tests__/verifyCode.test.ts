import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { sendCodeHandler, verifyCodeHandler } from '../authHandlers.js';
import { init, getUser, getUserIdByEmail, putUser } from '../../lib/store.js';
import * as emailService from '../../lib/emailService.js';

vi.mock('../../lib/newapi.js', async (orig) => {
  const real = await orig<typeof import('../../lib/newapi.js')>();
  return {
    ...real,
    newapi: {
      ...real.newapi,
      provisionUser: vi.fn().mockResolvedValue({ newapiUserId: 99 }),
      bindSubscription: vi.fn().mockResolvedValue(undefined),
      loginUser: vi.fn().mockResolvedValue({ cookie: 'sid=test' }),
      createAndRevealToken: vi.fn().mockResolvedValue({ tokenId: 1, apiKey: 'sk-test' }),
    },
  };
});

beforeEach(() => {
  process.env.SQLITE_PATH = ':memory:';
  process.env.EMAIL_PROVIDER = 'console';
  process.env.JWT_SECRET = 'test-secret';
  init();
  vi.spyOn(emailService, 'sendVerificationEmail').mockResolvedValue();
});

async function getCodeForEmail(email: string): Promise<string> {
  await sendCodeHandler({ body: JSON.stringify({ email }) } as any);
  const { db } = await import('../../lib/store.js');
  return (db.prepare('SELECT code FROM verification_codes WHERE email = ? ORDER BY createdAt DESC, rowid DESC LIMIT 1').get(email.toLowerCase()) as any).code;
}

describe('POST /v1/auth/verify-code', () => {
  it('first-time email creates a TokenBoss user (newapi handles subscription)', async () => {
    const code = await getCodeForEmail('new@example.com');

    const res = await verifyCodeHandler({ body: JSON.stringify({ email: 'new@example.com', code }) } as any) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.token).toBeTruthy();
    expect(body.user.email).toBe('new@example.com');
    expect(body.isNew).toBe(true);

    const userId = getUserIdByEmail('new@example.com');
    expect(userId).toBeTruthy();
    const u = await getUser(userId!);
    expect(u).toBeTruthy();
    // V3 (newapi-as-truth): TokenBoss DB no longer tracks plan. The
    // active subscription lives in newapi; /v1/buckets reads it live.
    expect(u?.plan).toBeUndefined();
    expect(u?.subscriptionStartedAt).toBeUndefined();
    expect(u?.subscriptionExpiresAt).toBeUndefined();
  });

  it('returning user gets a token (no DB plan to flip)', async () => {
    // First signup
    const code1 = await getCodeForEmail('returning@example.com');
    await verifyCodeHandler({ body: JSON.stringify({ email: 'returning@example.com', code: code1 }) } as any);
    const userId = getUserIdByEmail('returning@example.com')!;

    // Second login
    const code2 = await getCodeForEmail('returning@example.com');
    const res = await verifyCodeHandler({ body: JSON.stringify({ email: 'returning@example.com', code: code2 }) } as any) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(res.body!);
    expect(body.isNew).toBe(false);

    // V3: there's nothing to flip — login can't accidentally touch
    // subscription state because it's not on this side anymore.
    const u = await getUser(userId);
    expect(u).toBeTruthy();
    expect(u?.plan).toBeUndefined();
  });

  it('flips emailVerified=true for existing unverified user (OTP proves inbox ownership)', async () => {
    // Pre-existing user (e.g. registered via password) who never clicked
    // the verify-link. emailVerified starts false.
    putUser({
      userId: 'u_unverified_otp',
      email: 'unverified-otp@example.com',
      createdAt: new Date().toISOString(),
      emailVerified: false,
    });

    // Log in via verify-code — receiving + entering the OTP at this email
    // is proof the user owns the inbox, same as the new-user branch which
    // sets emailVerified: true at creation time.
    const code = await getCodeForEmail('unverified-otp@example.com');
    const res = await verifyCodeHandler({
      body: JSON.stringify({ email: 'unverified-otp@example.com', code }),
    } as any) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.isNew).toBe(false);

    const u = await getUser('u_unverified_otp');
    expect(u?.emailVerified).toBe(true);
  });

  it('does not write when existing user is already verified (idempotency)', async () => {
    putUser({
      userId: 'u_already_verified',
      email: 'verified@example.com',
      createdAt: new Date().toISOString(),
      emailVerified: true,
    });

    const code = await getCodeForEmail('verified@example.com');
    const res = await verifyCodeHandler({
      body: JSON.stringify({ email: 'verified@example.com', code }),
    } as any) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);

    const u = await getUser('u_already_verified');
    expect(u?.emailVerified).toBe(true); // unchanged
  });

  it('response carries full user profile incl. emailVerified for new user', async () => {
    // Frontend's loginWithCode reads res.user.emailVerified directly into
    // its auth state. If the response only ships {userId, email}, the UI
    // falls back to undefined → "邮箱待验证" banner flashes until /v1/me
    // re-fetches on the next mount. Response shape MUST mirror the other
    // auth handlers (register / login / verifyEmail) which all use
    // buildUserProfile.
    const code = await getCodeForEmail('newshape@example.com');
    const res = await verifyCodeHandler({
      body: JSON.stringify({ email: 'newshape@example.com', code }),
    } as any) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.user.emailVerified).toBe(true);
    expect(body.user.userId).toBeTruthy();
    expect(body.user.email).toBe('newshape@example.com');
    expect(typeof body.user.balance).toBe('number');
  });

  it('response carries emailVerified=true for existing user OTP login', async () => {
    putUser({
      userId: 'u_shape_existing',
      email: 'shape-existing@example.com',
      createdAt: new Date().toISOString(),
      emailVerified: false,
    });
    const code = await getCodeForEmail('shape-existing@example.com');
    const res = await verifyCodeHandler({
      body: JSON.stringify({ email: 'shape-existing@example.com', code }),
    } as any) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(res.body!);
    // markEmailVerified ran (previous fix), AND the response now reflects it
    // — frontend gets emailVerified=true on the same payload, no flash.
    expect(body.user.emailVerified).toBe(true);
  });

  it('rejects wrong code', async () => {
    await getCodeForEmail('a@b.com');
    const res = await verifyCodeHandler({ body: JSON.stringify({ email: 'a@b.com', code: '000000' }) } as any) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(401);
  });

  it('rejects malformed input', async () => {
    const res = await verifyCodeHandler({ body: JSON.stringify({ email: 'not-email', code: '123456' }) } as any) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(400);
  });

  it('rejects already-consumed code', async () => {
    await sendCodeHandler({ body: JSON.stringify({ email: 'reuse@test.com' }) } as any);
    const code = await getCodeForEmail('reuse@test.com');

    // First use — succeeds
    const r1 = await verifyCodeHandler({ body: JSON.stringify({ email: 'reuse@test.com', code }) } as any) as APIGatewayProxyStructuredResultV2;
    expect(r1.statusCode).toBe(200);

    // Second use of same code — must fail
    const r2 = await verifyCodeHandler({ body: JSON.stringify({ email: 'reuse@test.com', code }) } as any) as APIGatewayProxyStructuredResultV2;
    expect(r2.statusCode).toBe(401);
  });

  it('locks out code after 5 wrong-code guesses', async () => {
    const { db } = await import('../../lib/store.js');
    await sendCodeHandler({ body: JSON.stringify({ email: 'brute@test.com' }) } as any);

    // Capture the real code before brute-forcing so we can prove it gets locked.
    const realCode = (db.prepare('SELECT code FROM verification_codes WHERE email = ? ORDER BY createdAt DESC, rowid DESC LIMIT 1').get('brute@test.com') as any).code;

    // 5 wrong attempts — all must return 401.
    for (const wrong of ['000000', '111111', '222222', '333333', '444444']) {
      const r = await verifyCodeHandler({ body: JSON.stringify({ email: 'brute@test.com', code: wrong }) } as any) as APIGatewayProxyStructuredResultV2;
      expect(r.statusCode).toBe(401);
    }

    // After 5 failures the original code must be invalidated (consumed=1).
    const r = await verifyCodeHandler({ body: JSON.stringify({ email: 'brute@test.com', code: realCode }) } as any) as APIGatewayProxyStructuredResultV2;
    expect(r.statusCode).toBe(401);
  });

  it('does NOT auto-create a default API key on first signup', async () => {
    // Enable the newapi path so isNewapiConfigured() returns true.
    const origBase = process.env.NEWAPI_BASE_URL;
    const origToken = process.env.NEWAPI_ADMIN_TOKEN;
    process.env.NEWAPI_BASE_URL = 'http://newapi.test';
    process.env.NEWAPI_ADMIN_TOKEN = 'admin-token';

    const { newapi } = await import('../../lib/newapi.js');
    const createSpy = newapi.createAndRevealToken as unknown as ReturnType<typeof vi.fn>;
    createSpy.mockClear();

    const code = await getCodeForEmail('nokey@example.com');
    const res = await verifyCodeHandler({
      body: JSON.stringify({ email: 'nokey@example.com', code }),
    } as any) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!).isNew).toBe(true);

    expect(createSpy).not.toHaveBeenCalled();

    // Restore env.
    process.env.NEWAPI_BASE_URL = origBase;
    process.env.NEWAPI_ADMIN_TOKEN = origToken;
  });
});
