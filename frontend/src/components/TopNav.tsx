import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export interface TopNavProps {
  /** Highlights the matching link in the center group. */
  current?: 'home' | 'pricing';
}

/**
 * Shared top nav. Logo is a Link to home; center links use the editorial
 * mono-uppercase treatment to match SectionHeader / footer typography.
 */
export function TopNav({ current }: TopNavProps) {
  const { user } = useAuth();
  const isLoggedIn = !!user;

  const navLink = (active: boolean) =>
    `font-mono text-[10.5px] font-bold tracking-[0.16em] uppercase transition-colors ${
      active ? 'text-ink' : 'text-ink-3 hover:text-ink'
    }`;

  return (
    <nav className="px-5 sm:px-9 py-3.5 flex items-center justify-between border-b border-hairline max-w-[1200px] mx-auto gap-3 sm:gap-6">
      <Link to="/" className="flex items-center gap-2.5 flex-shrink-0 hover:opacity-85 transition-opacity">
        <div className="w-7 h-7 bg-accent rounded-md flex items-center justify-center text-white font-mono text-[10px] font-bold">TB</div>
        <span className="font-bold text-[15px] tracking-tight">TokenBoss</span>
      </Link>

      <div className="flex items-center gap-5 sm:gap-7 ml-auto sm:ml-0">
        <Link to="/" className={navLink(current === 'home')}>首页</Link>
        <Link to="/pricing" className={navLink(current === 'pricing')}>套餐</Link>
      </div>

      <div className="flex items-center gap-3 sm:gap-4 flex-shrink-0">
        {isLoggedIn ? (
          <Link
            to="/dashboard"
            className="px-3 sm:px-4 py-1.5 bg-accent text-white rounded-lg text-[11.5px] sm:text-[12.5px] font-semibold hover:bg-accent-deep transition-colors whitespace-nowrap"
          >
            控制台 →
          </Link>
        ) : (
          <>
            <Link to="/login" className="text-[12px] sm:text-[13px] text-ink-2 hover:text-ink transition-colors">登录</Link>
            <Link
              to="/register"
              className="px-3 sm:px-4 py-1.5 bg-accent text-white rounded-lg text-[11.5px] sm:text-[12.5px] font-semibold hover:bg-accent-deep transition-colors whitespace-nowrap"
            >
              免费开始 →
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
