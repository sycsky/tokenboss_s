import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { BrandPlate } from './TopNav';

export type AppNavCurrent = 'console' | 'history' | 'account';

/**
 * Shared top nav for authenticated app pages (Dashboard, UsageHistory,
 * Settings). 3-zone layout: BrandPlate left → primary section toggle
 * (控制台 / 用量 / 账户) absolutely centered → secondary (升级) + avatar right.
 *
 * 套餐 used to live in the center toggle but it's an upgrade path, not a
 * primary destination — moved to a small 升级 pill on the right so the
 * center stays focused on app sections the user lives in.
 *
 * Avatar follows the AvatarBlock primitive: solid lavender square, ink
 * text + ink border + hard offset. No more black-on-page contrast issue.
 */
export function AppNav({ current }: { current: AppNavCurrent }) {
  const { user } = useAuth();
  const initial = (user?.email?.[0] ?? 'U').toUpperCase();

  const navLink = (active: boolean) =>
    active
      ? 'bg-ink text-bg px-3 py-1 rounded-md text-[13px] font-semibold transition-colors'
      : 'text-ink-2 hover:text-ink text-[13px] font-medium transition-colors';

  return (
    <nav className="relative px-5 sm:px-9 py-5 flex items-center justify-between max-w-[1340px] mx-auto gap-3">
      <BrandPlate />

      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-5 sm:gap-7">
        <Link to="/console" className={navLink(current === 'console')}>控制台</Link>
        <Link to="/console/history" className={navLink(current === 'history')}>用量</Link>
        <Link to="/console/account" className={navLink(current === 'account')}>账户</Link>
      </div>

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
        <Link
          to="/console/account"
          aria-label={user?.email ? `账户：${user.email}` : '账户'}
          className={
            'inline-flex items-center justify-center w-9 h-9 bg-lavender text-lavender-ink border-2 border-ink ' +
            'rounded font-mono text-[13px] font-bold shadow-[2px_2px_0_0_#1C1917] ' +
            'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
            'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
            'transition-all'
          }
        >
          {initial}
        </Link>
      </div>
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
