import type { ReactNode } from 'react';
import { BrandPlate } from './TopNav';

/**
 * Slock-pixel auth shell. Cream bg, BrandPlate centered above a white card
 * with 2px ink border + 4px hard offset shadow. Used by /login, /register,
 * and /login/magic so the three views share an unmistakable family.
 */
export function AuthShell({
  children,
  caption,
  showTagline = true,
}: {
  children: ReactNode;
  /** Small line under the card (e.g. trial pitch, retry hint). Optional. */
  caption?: ReactNode;
  /** Brand tagline above the card. Hide on screens that already lead with a strong h1. */
  showTagline?: boolean;
}) {
  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-5 py-10">
      <div className="mb-6">
        <BrandPlate />
      </div>
      {showTagline && (
        <p className="text-[13px] text-[#6B5E52] mb-8 tracking-tight">
          你专心创造，剩下交给我们。
        </p>
      )}
      <div className="w-full max-w-[440px] bg-white border-2 border-ink rounded-lg shadow-[4px_4px_0_0_#1C1917] p-7 sm:p-9">
        {children}
      </div>
      {caption && (
        <div className="mt-6 text-[12px] text-[#6B5E52] tracking-tight text-center">
          {caption}
        </div>
      )}
    </div>
  );
}

/** Slock-pixel input. 2px ink border, focus → 3px hard shadow. */
export const authInputCls =
  'w-full px-4 py-3 bg-white border-2 border-ink rounded-md text-[15px] font-medium text-ink ' +
  'placeholder:text-[#A89A8D] placeholder:font-normal ' +
  'focus:outline-none focus:shadow-[3px_3px_0_0_#1C1917] transition-shadow';

export const authLabelCls = 'block text-[13px] font-bold text-ink mb-2 tracking-tight';

export const authOAuthBtnCls =
  'w-full inline-flex items-center justify-center gap-2.5 px-4 py-3 ' +
  'bg-white border-2 border-[#D9CEC2] rounded-md text-[14px] font-semibold text-[#A89A8D] ' +
  'cursor-not-allowed';

/** "即将开放" badge for disabled OAuth providers. */
export function ComingSoonBadge() {
  return (
    <span className="ml-1 px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-[#A89A8D] border border-[#D9CEC2] rounded">
      即将开放
    </span>
  );
}

export function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#9CA3AF" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.79 2.71v2.26h2.9c1.7-1.56 2.69-3.86 2.69-6.6z" />
      <path fill="#9CA3AF" d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.9-2.26c-.8.54-1.83.86-3.06.86-2.36 0-4.36-1.59-5.07-3.74H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#9CA3AF" d="M3.93 10.71a5.4 5.4 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.07l2.97-2.32z" />
      <path fill="#9CA3AF" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.96l2.97 2.32C4.64 5.17 6.64 3.58 9 3.58z" />
    </svg>
  );
}

export function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="#9CA3AF" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-1-.02-1.96-3.2.7-3.87-1.54-3.87-1.54-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.75 1.18 1.75 1.18 1.02 1.74 2.68 1.24 3.33.95.1-.74.4-1.24.73-1.53-2.55-.29-5.24-1.27-5.24-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.15 1.18a10.99 10.99 0 0 1 5.74 0c2.18-1.49 3.14-1.18 3.14-1.18.62 1.57.23 2.73.11 3.02.74.8 1.18 1.82 1.18 3.07 0 4.4-2.69 5.36-5.25 5.65.41.36.78 1.06.78 2.14 0 1.55-.01 2.79-.01 3.17 0 .31.21.66.79.55A11.5 11.5 0 0 0 23.5 12c0-6.35-5.15-11.5-11.5-11.5z" />
    </svg>
  );
}

/** Big icon plate used at the top of confirmation cards (e.g. "Check your email"). */
export function EnvelopePlate() {
  return (
    <span
      className="inline-flex items-center justify-center w-14 h-14 bg-accent border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917] text-white"
      aria-hidden="true"
    >
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="1.5" />
        <path d="M3 7l9 6 9-6" />
      </svg>
    </span>
  );
}
