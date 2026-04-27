import type { ReactNode } from 'react';
import { BrandPlate } from './TopNav';

/**
 * Slock-pixel shell for the post-register onboarding flow. Centered narrow
 * column, BrandPlate at the top, mono "STEP NN" stamp, h1 + sub, then
 * step-specific content. Stays close to AuthShell visually so the journey
 * from /register → /onboard/welcome doesn't change vibe abruptly.
 */
export function OnboardShell({
  step,
  cnLabel,
  enLabel,
  title,
  subtitle,
  width = 'md',
  children,
}: {
  /** "01" / "02" / "03" — rendered in mono. */
  step: string;
  /** Chinese label after the step number, e.g. "接入方式". */
  cnLabel: string;
  /** English label, e.g. "Pick your path". */
  enLabel: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Column width. md = 480 (welcome / success), lg = 580 (install). */
  width?: 'md' | 'lg';
  children: ReactNode;
}) {
  const max = width === 'lg' ? 'max-w-[580px]' : 'max-w-[480px]';
  return (
    <div className="min-h-screen bg-bg flex flex-col items-center px-5 pt-12 pb-10">
      <div className="mb-7">
        <BrandPlate />
      </div>
      <div className={`w-full ${max}`}>
        <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[#A89A8D] mb-3 flex items-center gap-2.5">
          <span>STEP {step}</span>
          <span className="w-3 h-px bg-[#A89A8D]" />
          <span className="text-ink-3">{cnLabel}</span>
          <span className="text-[#A89A8D]/70">·</span>
          <span className="text-[#A89A8D]">{enLabel}</span>
        </div>
        <h1 className="text-[36px] md:text-[42px] font-bold tracking-tight leading-[1.05] mb-3 text-ink">
          {title}
        </h1>
        {subtitle && (
          <p className="text-[14px] text-[#6B5E52] leading-relaxed mb-9 max-w-[440px]">
            {subtitle}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}
