import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { slockBtn } from '../lib/slockBtn';
import { AuthShell } from '../components/AuthShell';

type State = { kind: 'signing-in' } | { kind: 'failed' };

/**
 * Landing page for the backend's OAuth callback redirect. The session JWT
 * arrives in the URL FRAGMENT (`#token=...&isNew=0|1`) — fragments never
 * reach servers or Referer headers, so the token stays out of access logs.
 * We adopt it, scrub it from the address bar / history, and route new
 * users to onboarding, returning users to the console.
 */
export default function OAuthCallback() {
  const nav = useNavigate();
  const { loginWithToken } = useAuth();
  const [state, setState] = useState<State>({ kind: 'signing-in' });
  // StrictMode double-fires effects in dev; adopt the token only once.
  const consumed = useRef(false);

  useEffect(() => {
    if (consumed.current) return;
    consumed.current = true;

    const frag = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = frag.get('token');
    const isNew = frag.get('isNew') === '1';
    // Drop the fragment immediately so the JWT never sits in the URL bar
    // or survives into browser history / bookmarks.
    window.history.replaceState(null, '', window.location.pathname);

    if (!token) {
      setState({ kind: 'failed' });
      return;
    }
    loginWithToken(token)
      .then(() => nav(isNew ? '/onboard/welcome' : '/console', { replace: true }))
      .catch(() => setState({ kind: 'failed' }));
  }, [loginWithToken, nav]);

  if (state.kind === 'signing-in') {
    return (
      <AuthShell>
        <div className="text-center">
          <h1 className="text-[24px] font-bold text-ink tracking-tight mb-1.5">
            正在登录…
          </h1>
          <p className="text-[13.5px] text-[#6B5E52]">稍等一下，马上进入控制台。</p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="text-[24px] font-bold text-ink tracking-tight mb-3">
        登录没有完成
      </h1>
      <p className="text-[13.5px] text-[#6B5E52] mb-6 leading-relaxed">
        第三方登录中途出了问题（链接失效或授权被取消）。回到登录页再试一次即可。
      </p>
      <Link to="/login" className={slockBtn('primary') + ' w-full text-center'}>
        返回登录
      </Link>
    </AuthShell>
  );
}
