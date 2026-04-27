import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export interface TopNavProps {
  /** Highlights the matching link if it points to a separate page. */
  current?: 'home' | 'primitive';
  /**
   * 'light' (default) → cream bg, ink border + ink shadow on the logo plate.
   * 'dark' → ink bg, white border + white shadow.
   */
  theme?: 'light' | 'dark';
}

/**
 * Shared top nav. Slock-pixel: a tilted logo plate left, plain-text links
 * right. No bottom border, no top-right CTA button — conversion lives in
 * the hero, not in chrome.
 */
export function TopNav({ current, theme = 'light' }: TopNavProps) {
  const { user } = useAuth();
  const isLoggedIn = !!user;
  const dark = theme === 'dark';

  const linkActive = dark ? 'text-white' : 'text-ink';
  const linkInactive = dark
    ? 'text-white/65 hover:text-white'
    : 'text-ink-2 hover:text-ink';

  const navLink = (active: boolean) =>
    `text-[13px] font-medium transition-colors ${active ? linkActive : linkInactive}`;

  return (
    <nav className="px-5 sm:px-9 py-5 flex items-center justify-between max-w-[1200px] mx-auto gap-3 sm:gap-5">
      <BrandPlate dark={dark} />

      <div className="flex items-center gap-4 sm:gap-6">
        <a href="/#pricing" className={navLink(false)}>套餐</a>
        <Link to="/primitive" className={navLink(current === 'primitive')}>原语</Link>
        {isLoggedIn ? (
          <Link to="/dashboard" className={navLink(false)}>控制台</Link>
        ) : (
          <>
            <Link to="/login" className={navLink(false)}>登录</Link>
            <Link to="/register" className={navLink(false)}>注册</Link>
          </>
        )}
      </div>
    </nav>
  );
}

/**
 * Tilted logo plate · Slock-pixel signature: filled accent fill, 2px hard
 * border, 2px hard offset shadow, slight rotation. Hovers to upright.
 */
export function BrandPlate({ dark = false }: { dark?: boolean }) {
  const border = dark ? 'border-white' : 'border-ink';
  const shadow = dark
    ? 'shadow-[2px_2px_0_0_#FFFFFF]'
    : 'shadow-[2px_2px_0_0_#1C1917]';
  return (
    <Link to="/" className="flex-shrink-0 inline-block">
      <div
        className={`inline-block bg-accent text-white font-extrabold text-[14px] tracking-tight px-3 py-1.5 rounded-[5px] border-2 ${border} ${shadow} -rotate-[2.5deg] hover:rotate-0 transition-transform`}
      >
        TokenBoss
      </div>
    </Link>
  );
}
