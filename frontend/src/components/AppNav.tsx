import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { BrandPlate } from './TopNav';

export type AppNavCurrent = 'dashboard' | 'pricing' | 'account';

/**
 * Shared top nav for authenticated app pages (Dashboard, UsageHistory,
 * Settings, Plans-while-logged-in). 3-zone layout mirroring TopNav: tilted
 * BrandPlate left → "控制台 / 套餐 / 账户" toggle pills absolutely centered →
 * user-initial avatar right that links to /dashboard/account (where the
 * logout action lives).
 */
export function AppNav({ current }: { current: AppNavCurrent }) {
  const { user } = useAuth();
  const initial = (user?.email?.[0] ?? 'U').toUpperCase();

  const navLink = (active: boolean) =>
    active
      ? 'bg-ink text-bg shadow-[2px_2px_0_0_#1C1917]/30 px-3 py-1 rounded-md text-[13px] font-semibold transition-colors'
      : 'text-ink-2 hover:text-ink text-[13px] font-medium transition-colors';

  return (
    <nav className="relative px-5 sm:px-9 py-5 flex items-center justify-between max-w-[1340px] mx-auto gap-3">
      <BrandPlate />

      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-5 sm:gap-7">
        <Link to="/dashboard" className={navLink(current === 'dashboard')}>控制台</Link>
        <Link to="/pricing" className={navLink(current === 'pricing')}>套餐</Link>
        <Link to="/dashboard/account" className={navLink(current === 'account')}>账户</Link>
      </div>

      <Link
        to="/dashboard/account"
        aria-label={user?.email ? `账户：${user.email}` : '账户'}
        className={
          'inline-flex items-center justify-center w-8 h-8 bg-ink text-bg border-2 border-ink ' +
          'rounded-full font-mono text-[12px] font-bold shadow-[2px_2px_0_0_#1C1917] ' +
          'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
          'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
          'transition-all'
        }
      >
        {initial}
      </Link>
    </nav>
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
