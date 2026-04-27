import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { slockBtn } from '../lib/slockBtn';
import {
  AuthShell,
  ComingSoonBadge,
  GitHubIcon,
  GoogleIcon,
  authInputCls,
  authLabelCls,
  authOAuthBtnCls,
} from '../components/AuthShell';

/**
 * Email + password sign-in. The matching account is created via
 * /register; users who lost their password fall back to /login/magic
 * (one-time email code) until proper password reset lands.
 */
export default function Login() {
  const nav = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(email.trim().toLowerCase(), password);
      nav('/dashboard');
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === 'bad_credentials') {
        setError('邮箱或密码不正确');
      } else {
        setError((err as Error).message || '登录失败，请稍后重试');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell caption={<span>$10 试用额度即时到账 · 24 小时有效</span>}>
      <h1 className="text-[24px] font-bold text-ink tracking-tight mb-1.5">
        登录 TokenBoss
      </h1>
      <p className="text-[13.5px] text-[#6B5E52] mb-7 leading-relaxed">
        没有账户？<Link to="/register" className="text-accent font-semibold underline underline-offset-4 decoration-2">立即注册</Link>
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="login-email" className={authLabelCls}>邮箱</label>
          <input
            id="login-email"
            type="email"
            required
            autoFocus
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authInputCls}
          />
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-2">
            <label htmlFor="login-password" className={authLabelCls + ' mb-0'}>密码</label>
            <Link to="/login/magic" className="text-[12px] text-[#6B5E52] hover:text-ink underline underline-offset-4">
              忘记密码？
            </Link>
          </div>
          <input
            id="login-password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="至少 6 位"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInputCls}
          />
        </div>

        <button
          type="submit"
          disabled={loading || !email || !password}
          className={slockBtn('primary') + ' w-full mt-2'}
        >
          {loading ? '登录中…' : '登录'}
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
