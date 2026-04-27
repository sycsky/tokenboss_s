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

  const inactive = dark
    ? 'text-white/65 hover:text-white'
    : 'text-ink-2 hover:text-ink';
  const activePill = dark
    ? 'bg-white text-ink shadow-[2px_2px_0_0_#FFFFFF]/40'
    : 'bg-ink text-bg shadow-[2px_2px_0_0_#1C1917]/30';

  const navLink = (active: boolean) =>
    active
      ? `${activePill} px-3 py-1 rounded-md text-[13px] font-semibold transition-colors`
      : `text-[13px] font-medium transition-colors ${inactive}`;

  // On /primitive (an independent page) we hide the home-related side links.
  const onPrimitive = current === 'primitive';

  return (
    <nav className="relative px-5 sm:px-9 py-5 flex items-center justify-between max-w-[1200px] mx-auto gap-3">
      <BrandPlate dark={dark} />

      {/* Center: Wallet ↔ Primitives toggle. Both always visible — clicking
          either switches between the two product surfaces. */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-5 sm:gap-7">
        <Link to="/" className={navLink(current === 'home')}>Wallet</Link>
        <Link to="/primitive" className={navLink(onPrimitive)}>Primitives</Link>
      </div>

      {/* Right: 套餐 + 登录/控制台 — hidden on /primitive (independent page) */}
      {!onPrimitive ? (
        <div className="flex items-center gap-5 sm:gap-7">
          <a href="/#pricing" className={navLink(false)}>套餐</a>
          {isLoggedIn ? (
            <Link to="/console" className={navLink(false)}>控制台</Link>
          ) : (
            <Link to="/login" className={navLink(false)}>登录</Link>
          )}
        </div>
      ) : (
        // Spacer keeps logo on the left when right side is empty.
        <div className="w-px" />
      )}
    </nav>
  );
}

/**
 * Tilted logo plate · Slock-pixel signature: filled accent fill, 2px hard
 * border, 2px hard offset shadow, slight rotation. Hovers to upright.
 */
export function BrandPlate({
  dark = false,
  noLink = false,
}: {
  dark?: boolean;
  /** Render without the `<Link to="/">` wrapper. Use on onboarding /
   * funnel screens where bouncing back to Landing would orphan the
   * user mid-flow. */
  noLink?: boolean;
}) {
  const border = dark ? 'border-white' : 'border-ink';
  const shadow = dark
    ? 'shadow-[2px_2px_0_0_#FFFFFF]'
    : 'shadow-[2px_2px_0_0_#1C1917]';
  const plate = (
    <div
      className={`inline-block bg-accent text-white font-extrabold text-[14px] tracking-tight px-3 py-1.5 rounded-[5px] border-2 ${border} ${shadow} -rotate-[2.5deg] hover:rotate-0 transition-transform`}
    >
      TokenBoss
    </div>
  );
  if (noLink) {
    return <span className="flex-shrink-0 inline-block">{plate}</span>;
  }
  return (
    <Link to="/" className="flex-shrink-0 inline-block">
      {plate}
    </Link>
  );
}
