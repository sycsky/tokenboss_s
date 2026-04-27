/**
 * Email delivery layer. Two providers:
 *   console — dev default, prints to stdout (useful for local + tests)
 *   resend  — production, posts to https://api.resend.com/emails
 *
 * Provider selection: `EMAIL_PROVIDER` env (`console` | `resend`).
 * From address: `EMAIL_FROM` env (default `TokenBoss <noreply@tokenboss.co>`).
 */

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body. Always required so accessible clients have something to read. */
  text: string;
  /** Optional HTML body. Resend will fall back to `text` if omitted. */
  html?: string;
}

export interface EmailProvider {
  send(msg: EmailMessage): Promise<void>;
}

class ConsoleProvider implements EmailProvider {
  async send(msg: EmailMessage): Promise<void> {
    console.log(`[email:console] → ${msg.to}\n  subject: ${msg.subject}\n  text: ${msg.text.replace(/\n/g, "\n         ")}`);
  }
}

class ResendProvider implements EmailProvider {
  async send(msg: EmailMessage): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY not set");
    const from = process.env.EMAIL_FROM ?? "TokenBoss <noreply@tokenboss.co>";

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        ...(msg.html ? { html: msg.html } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Resend send failed: ${res.status} ${body}`);
    }
  }
}

const providers: Record<string, EmailProvider> = {
  console: new ConsoleProvider(),
  resend: new ResendProvider(),
};

function getProvider(): EmailProvider {
  const name = process.env.EMAIL_PROVIDER ?? "console";
  const provider = providers[name];
  if (!provider) throw new Error(`unknown email provider: ${name}`);
  return provider;
}

/**
 * Send a 6-digit one-time login code (used by the magic-link / recovery
 * flow at /login/magic).
 */
export async function sendVerificationEmail(
  email: string,
  code: string,
): Promise<void> {
  await getProvider().send({
    to: email,
    subject: `TokenBoss 验证码：${code}`,
    text: `你的 TokenBoss 验证码是 ${code}\n\n5 分钟内输入有效。如果不是你本人在登录，请忽略本邮件。`,
  });
}

/**
 * Send the post-register verification link. The link points the user back
 * to the frontend `/verify-email?token=...` route, which calls
 * `POST /v1/auth/verify-email` to consume the token.
 */
export async function sendVerifyLinkEmail(
  email: string,
  link: string,
  displayName?: string,
): Promise<void> {
  const greeting = displayName ? `${displayName}，` : "";
  await getProvider().send({
    to: email,
    subject: "请验证你的 TokenBoss 邮箱",
    text:
`${greeting}欢迎使用 TokenBoss。

请点击下方链接完成邮箱验证（24 小时内有效）：

${link}

验证完成后，你的 $10 / 24h 试用额度立刻可用。如果不是你本人在注册，请忽略本邮件。

— TokenBoss`,
    html:
`<p>${greeting}欢迎使用 <strong>TokenBoss</strong>。</p>
<p>请点击下方按钮完成邮箱验证（24 小时内有效）：</p>
<p><a href="${link}" style="display:inline-block;background:#E8692A;color:#fff;font-weight:700;padding:12px 24px;border:2px solid #1C1917;border-radius:6px;text-decoration:none;box-shadow:3px 3px 0 0 #1C1917">验证我的邮箱 →</a></p>
<p style="color:#6B5E52;font-size:13px;">或复制此链接到浏览器：<br><span style="font-family:monospace;word-break:break-all;">${link}</span></p>
<p style="color:#6B5E52;font-size:13px;">验证完成后，你的 $10 / 24h 试用额度立刻可用。如果不是你本人在注册，请忽略本邮件。</p>
<p style="color:#A89A8D;font-size:12px;">— TokenBoss</p>`,
  });
}
