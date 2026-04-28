import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { sendCodeHandler, verifyCodeHandler } from '../authHandlers.js';
import { init, getUser, getUserIdByEmail } from '../../lib/store.js';
import * as emailService from '../../lib/emailService.js';

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
});
