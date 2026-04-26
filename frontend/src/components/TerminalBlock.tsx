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
  const padding = size === 'lg' ? 'px-5 py-4' : 'px-4 py-3.5';
  const fontSize = size === 'lg' ? 'text-[15px]' : 'text-[12.5px]';
  return (
    <div className={`flex items-center gap-2 bg-[#1C1917] rounded-[10px] ${padding} ${fontSize} font-mono leading-snug ${className}`}>
      <span className="text-accent font-semibold select-none">$</span>
      <span className="text-[#FFF8F0] flex-1 truncate">{cmd}</span>
      <button
        onClick={handleCopy}
        className="font-mono text-[9.5px] font-bold tracking-[0.12em] uppercase text-[#A89A8D] border border-[#3A332D] bg-[#0A0807] px-2 py-1 rounded-[5px]"
      >
        {copied ? '已复制' : 'COPY'}
      </button>
    </div>
  );
}
