import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendVerificationEmail } from '../emailService.js';

describe('emailService', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('logs verification code in dev mode', async () => {
    process.env.EMAIL_PROVIDER = 'console';
    await sendVerificationEmail('user@example.com', '123456');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('user@example.com'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('123456'));
  });
});
