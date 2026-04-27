import { useState } from 'react';

export interface TerminalBlockProps {
  cmd: string;
  size?: 'sm' | 'lg';
  className?: string;
}

/**
 * Slock-pixel "copyable spell" block. Ink fill + 2px ink border + 4px hard
 * accent-colored offset shadow — the same hard-stamp signature used across
 * the marketing surfaces, sitting comfortably on a cream page.
 */
export function TerminalBlock({ cmd, size = 'sm', className = '' }: TerminalBlockProps) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    await navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  // Responsive: mobile shrinks font + padding so 28-char "set up tokenboss.com/skill.md"
  // doesn't truncate at 390px viewport.
  const padding = size === 'lg' ? 'px-3.5 py-3 sm:px-5 sm:py-4' : 'px-3 py-2.5 sm:px-4 sm:py-3.5';
  const fontSize = size === 'lg' ? 'text-[11.5px] sm:text-[15px]' : 'text-[10.5px] sm:text-[12.5px]';
  return (
    <div
      className={
        `flex items-center gap-2.5 bg-ink rounded-md border-2 border-ink ` +
        `shadow-[4px_4px_0_0_#E8692A] ${padding} ${fontSize} font-mono leading-snug ${className}`
      }
    >
      <span className="text-accent font-semibold select-none">$</span>
      <span className="text-[#FFF8F0] flex-1 truncate">{cmd}</span>
      <button
        onClick={handleCopy}
        aria-label="copy command"
        className={
          'font-mono text-[9.5px] sm:text-[10px] font-bold tracking-[0.14em] uppercase text-ink ' +
          'bg-bg border-2 border-bg rounded ' +
          'px-2 py-0.5 sm:px-2.5 sm:py-1 ' +
          'shadow-[2px_2px_0_0_#E8692A] ' +
          'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#E8692A] ' +
          'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#E8692A] ' +
          'transition-all flex-shrink-0'
        }
      >
        {copied ? '已复制' : 'COPY'}
      </button>
    </div>
  );
}
