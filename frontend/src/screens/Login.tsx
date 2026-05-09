import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { slockBtn } from '../lib/slockBtn';
import {
  AuthShell,
  ComingSoonBadge,
  EnvelopePlate,
  GitHubIcon,
  GoogleIcon,
  authInputCls,
  authLabelCls,
  authOAuthBtnCls,
} from '../components/AuthShell';
import { useDocumentMeta } from '../lib/useDocumentMeta';

/**
 * Unified email-code entry. Same screen for new and returning users —
 * after the user submits a 6-digit code, the backend either signs the
 * existing account in or creates one and grants the trial bucket.
 * isNew on the response decides where we route next: /onboard/welcome
 * for first-timers, /console for returning users.
 *
 * Replaces the older email+password flow + the standalone /login/magic
 * recovery page. Industry trend (Notion, Vercel, Linear) is to default
 * to passwordless; we follow suit because v1 has no password-manager
 * power-users to optimize for, and email-code shaves the "think up a
 * password" task off the signup funnel.
 */
export default function Login() {
  useDocumentMeta({
    title: '登录 · TokenBoss',
    description:
      '输入邮箱获取验证码，登录或注册 TokenBoss。免密码、即开即用。',
    ogImage: 'https://tokenboss.co/og-cover.png',
  });
  const nav = useNavigate();
  const { sendCode, loginWithCode } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await sendCode(email.trim().toLowerCase());
      setStep('code');
    } catch (err: unknown) {
      setError((err as Error).message || '发送验证码失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      const result = await loginWithCode(email.trim().toLowerCase(), code);
      nav(result.isNew ? '/onboard/welcome' : '/console');
    } catch {
      setError('验证码错误或已过期，请重新获取');
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setLoading(true);
    setError(null);
    try {
      await sendCode(email.trim().toLowerCase());
    } catch (err: unknown) {
      setError((err as Error).message || '重新发送失败');
    } finally {
      setLoading(false);
    }
  }

  if (step === 'email') {
    return (
      <AuthShell>
        <h1 className="text-[24px] font-bold text-ink tracking-tight mb-1.5">
          进入 TokenBoss
        </h1>
        <p className="text-[13.5px] text-[#6B5E52] mb-7 leading-relaxed">
          输入邮箱，我们发一个 6 位验证码给你。已注册直接进控制台，未注册自动开户。
        </p>

        <form onSubmit={handleSendCode} className="space-y-4">
          <div>
            <label htmlFor="login-email" className={authLabelCls}>邮箱</label>
            <input
              id="login-email"
              type="email"
              required
              autoFocus
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={authInputCls}
            />
          </div>

          <button
            type="submit"
            disabled={loading || !email}
            className={slockBtn('primary') + ' w-full mt-2'}
          >
            {loading ? '发送中…' : '发送验证码 →'}
          </button>

          {error && (
            <p className="text-[13px] text-red-ink font-medium">{error}</p>
          )}
        </form>

        <div className="flex items-center gap-3 my-6">
          <span className="flex-1 h-px bg-[#D9CEC2]" />
          <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-[#A89A8D]">或</span>
          <span className="flex-1 h-px bg-[#D9CEC2]" />
        </div>

        <div className="space-y-2.5">
          <button type="button" disabled className={authOAuthBtnCls} aria-disabled="true">
            <GoogleIcon />
            <span>Continue with Google</span>
            <ComingSoonBadge />
          </button>
          <button type="button" disabled className={authOAuthBtnCls} aria-disabled="true">
            <GitHubIcon />
            <span>Continue with GitHub</span>
            <ComingSoonBadge />
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="text-center">
        <div className="inline-block mb-5">
          <EnvelopePlate />
        </div>
        <h1 className="text-[24px] font-bold text-ink tracking-tight mb-1.5">
          查收你的邮箱
        </h1>
        <p className="text-[13.5px] text-[#6B5E52] mb-1">
          我们刚把验证码发到了
        </p>
        <p className="font-mono text-[14px] text-ink font-semibold mb-7 break-all">
          {email}
        </p>

        <form onSubmit={handleVerify} className="space-y-4 text-left">
          <input
            type="text"
            inputMode="numeric"
            autoFocus
            maxLength={6}
            pattern="\d{6}"
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className={
              'w-full px-4 py-3 bg-white border-2 border-ink rounded-md ' +
              'text-[26px] font-mono font-semibold text-ink tracking-[0.45em] text-center ' +
              'placeholder:text-[#D9CEC2] ' +
              'focus:outline-none focus:shadow-[3px_3px_0_0_#1C1917] transition-shadow'
            }
          />

          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className={slockBtn('primary') + ' w-full'}
          >
            {loading ? '验证中…' : '验证并进入'}
          </button>

          {error && (
            <p className="text-[13px] text-red-ink font-medium text-center">{error}</p>
          )}
        </form>

        <div className="mt-6 flex flex-col items-center gap-2 text-[13px]">
          <button
            type="button"
            onClick={handleResend}
            disabled={loading}
            className="text-ink underline underline-offset-4 decoration-2 hover:text-accent disabled:opacity-50 transition-colors"
          >
            重新发送验证码
          </button>
          <button
            type="button"
            onClick={() => {
              setStep('email');
              setCode('');
              setError(null);
            }}
            className="text-[#6B5E52] hover:text-ink transition-colors"
          >
            换一个邮箱
          </button>
        </div>
      </div>
    </AuthShell>
  );
}
