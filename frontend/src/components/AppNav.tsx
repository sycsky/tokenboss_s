import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { BrandPlate } from './TopNav';

export type AppNavCurrent = 'console' | 'history' | 'account';

/**
 * Shared top nav for authenticated app pages. Layout:
 *
 *   [BrandPlate]                                [升级] [Avatar▾]
 *
 * The previous 3-link center toggle (控制台 / 用量 / 账户) was removed —
 * 控制台 is the only place a user lives, 用量 collapses into the
 * console's recent-usage widgets (with click-through to the detail
 * page), and 账户 / 退出登录 now live in the avatar dropdown so they
 * stop competing with the primary surface.
 *
 * The `current` prop is kept on the type so existing callsites stay
 * valid without a coordinated rename, but it no longer drives any
 * visual highlight.
 */
export function AppNav({ current: _current }: { current?: AppNavCurrent } = {}) {
  return (
    <nav className="px-5 sm:px-9 py-5 flex items-center justify-between max-w-[1340px] mx-auto gap-3">
      <BrandPlate />
      <div className="flex items-center gap-3">
        <Link
          to="/pricing"
          className={
            'hidden sm:inline-flex items-center px-2.5 py-1 bg-yellow-stamp border-2 border-ink rounded ' +
            'font-mono text-[10.5px] font-bold tracking-[0.12em] uppercase text-yellow-stamp-ink ' +
            'shadow-[2px_2px_0_0_#1C1917] ' +
            'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
            'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
            'transition-all'
          }
        >
          升级 ↗
        </Link>
        <AvatarMenu />
      </div>
    </nav>
  );
}

/**
 * Avatar plate that doubles as the menu trigger. Clicks open a small
 * Slock-pixel dropdown anchored to the right edge with: 账户设置 /
 * 退出登录. Click-outside and ESC close the menu, matching the modal
 * dismissal pattern used across the app.
 */
function AvatarMenu() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const initial = (user?.email?.[0] ?? 'U').toUpperCase();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function handleLogout() {
    setOpen(false);
    logout();
    nav('/');
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        aria-label={user?.email ? `账户：${user.email}` : '账户'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={
          'inline-flex items-center justify-center w-9 h-9 bg-lavender text-lavender-ink border-2 border-ink ' +
          'rounded font-mono text-[13px] font-bold shadow-[2px_2px_0_0_#1C1917] ' +
          'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
          'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
          'transition-all'
        }
      >
        {initial}
      </button>

      {open && (
        <div
          role="menu"
          className={
            'absolute right-0 top-[calc(100%+8px)] w-[220px] bg-white border-2 border-ink rounded-md ' +
            'shadow-[4px_4px_0_0_#1C1917] py-1 z-40'
          }
        >
          {user?.email && (
            <div className="px-3.5 py-2 border-b-2 border-ink/10">
              <div className="font-mono text-[9.5px] tracking-[0.16em] uppercase text-[#A89A8D] font-bold mb-0.5">
                登录身份
              </div>
              <div className="text-[12.5px] font-bold text-ink truncate">{user.email}</div>
            </div>
          )}
          <Link
            to="/console/account"
            onClick={() => setOpen(false)}
            className="block px-3.5 py-2.5 text-[13.5px] font-semibold text-ink hover:bg-bg transition-colors"
            role="menuitem"
          >
            账户设置
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="block w-full text-left px-3.5 py-2.5 text-[13.5px] font-semibold text-ink hover:bg-bg transition-colors"
            role="menuitem"
          >
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Mono uppercase section label with a short ink prefix line. Used across
 * Dashboard / UsageHistory / Settings as a lightweight section divider that
 * doesn't compete with the cards under it.
 */
export function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-3 flex items-center gap-2 justify-between">
      <span className="flex items-center gap-2.5">
        <span className="w-4 h-px bg-[#A89A8D]" />
        {children}
      </span>
      {action}
    </div>
  );
}
