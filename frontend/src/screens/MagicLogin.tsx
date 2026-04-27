import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { slockBtn } from '../lib/slockBtn';
import {
  AuthShell,
  EnvelopePlate,
  authInputCls,
  authLabelCls,
} from '../components/AuthShell';

/**
 * Recovery / magic-link flow. Sends a one-time 6-digit code to the user's
 * email, then logs them straight in on success — same effect as resetting
 * a password without needing to set one. Reachable from the Login page's
 * "忘记密码？" link, and serves as a stop-gap until v1.1 ships proper
 * password reset emails.
 */
export default function MagicLogin() {
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
      nav(result.isNew ? '/onboard/welcome' : '/dashboard');
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
          一次性登录链接
        </h1>
        <p className="text-[13.5px] text-[#6B5E52] mb-7 leading-relaxed">
          忘了密码？输入邮箱，我们发一个 6 位验证码给你，验证完直接进控制台。
        </p>

        <form onSubmit={handleSendCode} className="space-y-4">
          <div>
            <label htmlFor="magic-email" className={authLabelCls}>邮箱</label>
            <input
              id="magic-email"
              type="email"
              required
              autoFocus
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

        <p className="text-center text-[13px] text-[#6B5E52] mt-6">
          想起密码了？<Link to="/login" className="text-ink underline underline-offset-4 decoration-2">回到登录</Link>
        </p>
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
            {loading ? '验证中…' : '验证并登录'}
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
            换一个邮箱地址
          </button>
        </div>
      </div>
    </AuthShell>
  );
}
