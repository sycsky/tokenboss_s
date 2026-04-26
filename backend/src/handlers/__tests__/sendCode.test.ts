import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { sendCodeHandler } from '../authHandlers.js';
import { init } from '../../lib/store.js';
import * as emailService from '../../lib/emailService.js';

beforeEach(() => {
  process.env.SQLITE_PATH = ':memory:';
  process.env.EMAIL_PROVIDER = 'console';
  init();
  vi.spyOn(emailService, 'sendVerificationEmail').mockResolvedValue();
});

describe('POST /v1/auth/send-code', () => {
  it('sends a code for valid email', async () => {
    const res = await sendCodeHandler({ body: JSON.stringify({ email: 'a@b.com' }) } as any) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);
    expect(emailService.sendVerificationEmail).toHaveBeenCalledWith('a@b.com', expect.stringMatching(/^\d{6}$/));
  });

  it('rate-limits 1 per minute per email', async () => {
    const evt = { body: JSON.stringify({ email: 'a@b.com' }) } as any;
    await sendCodeHandler(evt);
    const second = await sendCodeHandler(evt) as APIGatewayProxyStructuredResultV2;
    expect(second.statusCode).toBe(429);
  });

  it('rejects invalid email', async () => {
    const res = await sendCodeHandler({ body: JSON.stringify({ email: 'not-email' }) } as any) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(400);
  });
});
