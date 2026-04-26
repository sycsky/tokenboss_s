import { useState } from 'react';

export interface TerminalBlockProps {
  cmd: string;
  size?: 'sm' | 'lg';
  className?: string;
}

export function TerminalBlock({ cmd, size = 'sm', className = '' }: TerminalBlockProps) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    await navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  // Responsive: mobile shrinks font + padding so 28-char "set up tokenboss.com/skill.md"
  // doesn't truncate at 390px viewport. Desktop keeps the original "lg" feel.
  const padding = size === 'lg' ? 'px-3.5 py-3 sm:px-5 sm:py-4' : 'px-3 py-2.5 sm:px-4 sm:py-3.5';
  const fontSize = size === 'lg' ? 'text-[11.5px] sm:text-[15px]' : 'text-[10.5px] sm:text-[12.5px]';
  return (
    <div className={`group flex items-center gap-2 bg-[#1C1917] rounded-[10px] ${padding} ${fontSize} font-mono leading-snug transition-shadow hover:shadow-[0_0_0_1px_rgba(232,105,42,0.4),0_8px_28px_-12px_rgba(232,105,42,0.45)] ${className}`}>
      <span className="text-accent font-semibold select-none">$</span>
      <span className="text-[#FFF8F0] flex-1 truncate">{cmd}</span>
      <button
        onClick={handleCopy}
        aria-label="copy command"
        className="font-mono text-[9px] sm:text-[9.5px] font-bold tracking-[0.12em] uppercase text-[#A89A8D] hover:text-[#FFF8F0] border border-[#3A332D] bg-[#0A0807] px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-[5px] flex-shrink-0 transition-colors"
      >
        {copied ? '已复制' : 'COPY'}
      </button>
    </div>
  );
}
