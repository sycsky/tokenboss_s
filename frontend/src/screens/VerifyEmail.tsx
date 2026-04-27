import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { slockBtn } from '../lib/slockBtn';
import { AuthShell, EnvelopePlate } from '../components/AuthShell';

type State =
  | { kind: 'verifying' }
  | { kind: 'success'; displayName?: string }
  | { kind: 'invalid' }
  | { kind: 'missing' };

/**
 * Landed here from the email link. Auto-consume the token, then bounce
 * the user into the dashboard. Errors fall back to actionable next steps
 * (resend / login).
 */
export default function VerifyEmail() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { verifyEmail } = useAuth();
  const [state, setState] = useState<State>({ kind: 'verifying' });
  // StrictMode double-fires effects in dev; guard so the token isn't consumed twice.
  const consumed = useRef(false);

  useEffect(() => {
    if (consumed.current) return;
    consumed.current = true;
    const token = params.get('token');
    if (!token) {
      setState({ kind: 'missing' });
      return;
    }
    verifyEmail(token)
      .then((res) => {
        setState({ kind: 'success', displayName: res.user.displayName });
        // Tiny delay so the success state is readable before navigation.
        setTimeout(() => nav('/console'), 1400);
      })
      .catch(() => {
        setState({ kind: 'invalid' });
      });
  }, [params, verifyEmail, nav]);

  if (state.kind === 'verifying') {
    return (
      <AuthShell>
        <div className="text-center">
          <div className="inline-block mb-5">
            <EnvelopePlate />
          </div>
          <h1 className="text-[24px] font-bold text-ink tracking-tight mb-1.5">
            正在验证…
          </h1>
          <p className="text-[13.5px] text-[#6B5E52]">稍等一下，马上跳转。</p>
        </div>
      </AuthShell>
    );
  }

  if (state.kind === 'success') {
    return (
      <AuthShell>
        <div className="text-center">
          <CheckPlate />
          <h1 className="text-[24px] font-bold text-ink tracking-tight mt-5 mb-1.5">
            邮箱已验证 ✓
          </h1>
          <p className="text-[13.5px] text-[#6B5E52]">
            {state.displayName ? `${state.displayName}，` : ''}正在带你进入控制台…
          </p>
        </div>
      </AuthShell>
    );
  }

  if (state.kind === 'missing') {
    return (
      <AuthShell>
        <h1 className="text-[24px] font-bold text-ink tracking-tight mb-3">
          缺少验证 token
        </h1>
        <p className="text-[13.5px] text-[#6B5E52] mb-6 leading-relaxed">
          请从我们发给你的邮件里点击"验证我的邮箱"链接进入这里。如果邮件丢了，登录后可以从控制台再发一次。
        </p>
        <Link to="/login" className={slockBtn('primary') + ' w-full text-center'}>
          去登录
        </Link>
      </AuthShell>
    );
  }

  // invalid
  return (
    <AuthShell>
      <h1 className="text-[24px] font-bold text-ink tracking-tight mb-3">
        链接已过期
      </h1>
      <p className="text-[13.5px] text-[#6B5E52] mb-6 leading-relaxed">
        这条验证链接无效或已用过。登录后可以在控制台重新发送。
      </p>
      <Link to="/login" className={slockBtn('primary') + ' w-full text-center'}>
        登录后重新发送
      </Link>
    </AuthShell>
  );
}

/** Green check plate — variant of EnvelopePlate, used for success states. */
function CheckPlate() {
  return (
    <span
      className="inline-flex items-center justify-center w-14 h-14 bg-[#16A34A] border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917] text-white"
      aria-hidden="true"
    >
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12l5 5L20 7" />
      </svg>
    </span>
  );
}
