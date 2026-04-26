export interface EmailProvider {
  send(to: string, code: string): Promise<void>;
}

class ConsoleProvider implements EmailProvider {
  async send(to: string, code: string): Promise<void> {
    console.log(`[email:console] ${to} → code=${code}`);
  }
}

class ResendProvider implements EmailProvider {
  async send(to: string, code: string): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error('RESEND_API_KEY not set');
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'TokenBoss <noreply@tokenboss.com>',
        to,
        subject: `TokenBoss 验证码：${code}`,
        text: `你的验证码是 ${code}（5 分钟内有效）。`,
      }),
    });
    if (!res.ok) throw new Error(`Resend send failed: ${res.status}`);
  }
}

const providers: Record<string, EmailProvider> = {
  console: new ConsoleProvider(),
  resend: new ResendProvider(),
};

export async function sendVerificationEmail(email: string, code: string): Promise<void> {
  const name = process.env.EMAIL_PROVIDER ?? 'console';
  const provider = providers[name];
  if (!provider) throw new Error(`unknown email provider: ${name}`);
  await provider.send(email, code);
}
