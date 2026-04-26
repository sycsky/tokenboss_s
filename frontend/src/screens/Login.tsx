import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export default function Login() {
  const nav = useNavigate();
  const { sendCode, loginWithCode } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
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
      await loginWithCode(email.trim().toLowerCase(), code);
      nav('/dashboard');
    } catch {
      setError('验证码错误或已过期');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold mb-2 tracking-tight">欢迎回来</h1>
        <p className="text-ink-2 text-sm mb-8">用邮箱登录到你的 Agent 钱包</p>

        {step === 'email' && (
          <form onSubmit={handleSendCode} className="space-y-4">
            <input
              type="email"
              required
              autoFocus
              placeholder="email@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-4 py-3 bg-surface border border-border rounded-lg text-base focus:outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={loading || !email}
              className="w-full py-3 bg-accent text-white font-semibold rounded-lg disabled:opacity-50"
            >
              {loading ? '发送中…' : '发送验证码'}
            </button>
            {error && <p className="text-red-ink text-sm">{error}</p>}
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={handleVerify} className="space-y-4">
            <p className="text-sm text-ink-2">验证码已发送至 <span className="font-mono">{email}</span></p>
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              maxLength={6}
              pattern="\d{6}"
              placeholder="输入 6 位验证码"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              className="w-full px-4 py-3 bg-surface border border-border rounded-lg text-2xl font-mono tracking-[0.4em] text-center focus:outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="w-full py-3 bg-accent text-white font-semibold rounded-lg disabled:opacity-50"
            >
              {loading ? '验证中…' : '登录'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('email'); setCode(''); }}
              className="w-full py-2 text-ink-2 text-sm"
            >
              重新输入邮箱
            </button>
            {error && <p className="text-red-ink text-sm">{error}</p>}
          </form>
        )}

        <p className="text-center text-sm text-ink-3 mt-8">
          没有账户？<a href="/register" className="text-accent">免费注册</a>
        </p>
      </div>
    </div>
  );
}
