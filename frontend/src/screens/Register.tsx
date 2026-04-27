import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api';
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

/**
 * Email + password registration. New accounts go through onboarding;
 * email verification is deferred to v1.1 (see docs/superpowers/specs).
 */
export default function Register() {
  const nav = useNavigate();
  const { register, resendVerification } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      setError('密码至少需要 6 位');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      await register({
        email: normalizedEmail,
        password,
        displayName: displayName.trim() || undefined,
      });
      setRegisteredEmail(normalizedEmail);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === 'email_taken') {
        setError('这个邮箱已注册，请直接登录');
      } else {
        setError((err as Error).message || '注册失败，请稍后重试');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResendState('sending');
    try {
      await resendVerification();
      setResendState('sent');
    } catch {
      setResendState('error');
    }
  }

  if (registeredEmail) {
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
            我们刚把验证邮件发到了
          </p>
          <p className="font-mono text-[14px] text-ink font-semibold mb-7 break-all">
            {registeredEmail}
          </p>
          <p className="text-[13px] text-[#6B5E52] leading-relaxed mb-7 -mt-3">
            点击邮件里的"验证我的邮箱"按钮即可完成注册。链接 24 小时内有效。
          </p>

          <button
            type="button"
            onClick={() => nav('/onboard/welcome')}
            className={slockBtn('primary') + ' w-full mb-3'}
          >
            稍后验证 · 进入控制台
          </button>

          <button
            type="button"
            onClick={handleResend}
            disabled={resendState === 'sending' || resendState === 'sent'}
            className="text-[13px] text-ink underline underline-offset-4 decoration-2 hover:text-accent disabled:opacity-50 transition-colors"
          >
            {resendState === 'sending'
              ? '发送中…'
              : resendState === 'sent'
                ? '已重新发送 ✓'
                : resendState === 'error'
                  ? '发送失败，重试'
                  : '没收到？重新发送'}
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell caption={<span>注册即送 $10 试用额度 · 24 小时有效</span>}>
      <h1 className="text-[24px] font-bold text-ink tracking-tight mb-1.5">
        创建账户
      </h1>
      <p className="text-[13.5px] text-[#6B5E52] mb-7 leading-relaxed">
        已有账户？<Link to="/login" className="text-accent font-semibold underline underline-offset-4 decoration-2">登录</Link>
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="reg-name" className={authLabelCls}>名字</label>
          <input
            id="reg-name"
            type="text"
            placeholder="可填昵称，方便控制台称呼你"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={authInputCls}
            maxLength={40}
          />
        </div>

        <div>
          <label htmlFor="reg-email" className={authLabelCls}>邮箱</label>
          <input
            id="reg-email"
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authInputCls}
          />
        </div>

        <div>
          <label htmlFor="reg-password" className={authLabelCls}>密码</label>
          <input
            id="reg-password"
            type="password"
            required
            autoComplete="new-password"
            placeholder="至少 6 位"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInputCls}
            minLength={6}
          />
        </div>

        <button
          type="submit"
          disabled={loading || !email || password.length < 6}
          className={slockBtn('primary') + ' w-full mt-2'}
        >
          {loading ? '创建中…' : '创建账户 · 立刻送 $10'}
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
          <span>Sign up with Google</span>
          <ComingSoonBadge />
        </button>
        <button type="button" disabled className={authOAuthBtnCls} aria-disabled="true">
          <GitHubIcon />
          <span>Sign up with GitHub</span>
          <ComingSoonBadge />
        </button>
      </div>
    </AuthShell>
  );
}
