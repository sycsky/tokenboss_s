import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export default function Register() {
  const nav = useNavigate();
  const { sendCode, loginWithCode } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code' | 'success'>('email');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      await sendCode(email.trim().toLowerCase());
      setStep('code');
    } catch (err: unknown) {
      setError((err as Error).message || '发送验证码失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return;
    setLoading(true); setError(null);
    try {
      const result = await loginWithCode(email.trim().toLowerCase(), code);
      if (result.isNew) {
        setStep('success');
        setTimeout(() => nav('/onboard/welcome'), 2500);
      } else {
        nav('/dashboard');
      }
    } catch {
      setError('验证码错误或已过期');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {step !== 'success' && (
          <>
            <h1 className="text-3xl font-bold mb-2 tracking-tight">免费注册</h1>
            <p className="text-ink-2 text-sm mb-2">注册即送</p>
            <div className="bg-accent-soft border border-accent rounded-lg p-4 mb-8">
              <div className="font-mono text-3xl font-bold text-accent-ink">$10</div>
              <div className="text-sm text-accent-ink mt-1">24 小时免费试用</div>
            </div>
          </>
        )}

        {step === 'email' && (
          <form onSubmit={handleSendCode} className="space-y-4">
            <input
              type="email" required autoFocus
              placeholder="email@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-4 py-3 bg-surface border border-border rounded-lg text-base focus:outline-none focus:border-accent"
            />
            <button type="submit" disabled={loading || !email}
              className="w-full py-3 bg-accent text-white font-semibold rounded-lg disabled:opacity-50">
              {loading ? '发送中…' : '免费开始 · 送 $10 体验'}
            </button>
            {error && <p className="text-red-ink text-sm">{error}</p>}
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={handleVerify} className="space-y-4">
            <p className="text-sm text-ink-2">验证码已发送至 <span className="font-mono">{email}</span></p>
            <input
              type="text" inputMode="numeric" autoFocus maxLength={6} pattern="\d{6}"
              placeholder="输入 6 位验证码"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              className="w-full px-4 py-3 bg-surface border border-border rounded-lg text-2xl font-mono tracking-[0.4em] text-center focus:outline-none focus:border-accent"
            />
            <button type="submit" disabled={loading || code.length !== 6}
              className="w-full py-3 bg-accent text-white font-semibold rounded-lg disabled:opacity-50">
              {loading ? '验证中…' : '完成注册'}
            </button>
            {error && <p className="text-red-ink text-sm">{error}</p>}
          </form>
        )}

        {step === 'success' && (
          <div className="text-center">
            <div className="text-5xl mb-4">🎉</div>
            <h2 className="text-2xl font-bold mb-2">注册成功</h2>
            <p className="text-ink-2">$10 / 24h 试用已激活</p>
            <p className="text-ink-3 text-sm mt-4">正在跳转到接入引导…</p>
          </div>
        )}

        {step !== 'success' && (
          <p className="text-center text-sm text-ink-3 mt-8">
            已有账户？<a href="/login" className="text-accent">登录</a>
          </p>
        )}
      </div>
    </div>
  );
}
