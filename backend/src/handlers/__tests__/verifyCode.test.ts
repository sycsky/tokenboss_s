import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { sendCodeHandler, verifyCodeHandler } from '../authHandlers.js';
import { init, getActiveBucketsForUser, getUserIdByEmail } from '../../lib/store.js';
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
  it('first-time email creates user + grants trial bucket', async () => {
    const code = await getCodeForEmail('new@example.com');

    const res = await verifyCodeHandler({ body: JSON.stringify({ email: 'new@example.com', code }) } as any) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.token).toBeTruthy();
    expect(body.user.email).toBe('new@example.com');
    expect(body.isNew).toBe(true);

    const userId = getUserIdByEmail('new@example.com');
    expect(userId).toBeTruthy();
    const buckets = getActiveBucketsForUser(userId!);
    expect(buckets.find(b => b.skuType === 'trial')).toBeTruthy();
    expect(buckets.find(b => b.skuType === 'trial')!.totalRemainingUsd).toBe(10);
  });

  it('returning user gets token without new trial bucket', async () => {
    // First signup
    const code1 = await getCodeForEmail('returning@example.com');
    await verifyCodeHandler({ body: JSON.stringify({ email: 'returning@example.com', code: code1 }) } as any);
    const userId = getUserIdByEmail('returning@example.com')!;
    const trialCountAfterFirst = getActiveBucketsForUser(userId).filter(b => b.skuType === 'trial').length;

    // Second login
    const code2 = await getCodeForEmail('returning@example.com');
    const res = await verifyCodeHandler({ body: JSON.stringify({ email: 'returning@example.com', code: code2 }) } as any) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(res.body!);
    expect(body.isNew).toBe(false);

    const trialCountAfterSecond = getActiveBucketsForUser(userId).filter(b => b.skuType === 'trial').length;
    expect(trialCountAfterSecond).toBe(trialCountAfterFirst);
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

  it('rejects multiple wrong-code guesses against valid email', async () => {
    await sendCodeHandler({ body: JSON.stringify({ email: 'brute@test.com' }) } as any);
    // Try 5 random wrong codes — all should 401
    for (const wrong of ['000000', '111111', '222222', '333333', '444444']) {
      const r = await verifyCodeHandler({ body: JSON.stringify({ email: 'brute@test.com', code: wrong }) } as any) as APIGatewayProxyStructuredResultV2;
      expect(r.statusCode).toBe(401);
    }
    // Original real code is still consumable (no lockout in v1.0 — note this for production hardening)
    const code = await getCodeForEmail('brute@test.com');
    const r = await verifyCodeHandler({ body: JSON.stringify({ email: 'brute@test.com', code }) } as any) as APIGatewayProxyStructuredResultV2;
    expect(r.statusCode).toBe(200);
  });
});
