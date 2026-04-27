export interface SectionHeaderProps {
  num: string;
  cn: string;
  en: string;
  size?: 'sm' | 'lg';
  className?: string;
}

export function SectionHeader({ num, cn, en, size = 'sm', className = '' }: SectionHeaderProps) {
  const numCls = size === 'lg' ? 'text-[22px]' : 'text-[16px]';
  const cnCls = size === 'lg' ? 'text-[14px]' : 'text-[12px]';
  const enCls = size === 'lg' ? 'text-[11px]' : 'text-[10px]';
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span className={`font-serif italic font-semibold text-ink-4 ${numCls}`}>{num}</span>
      <span className={`font-bold text-ink ${cnCls}`}>{cn}</span>
      <span className="text-ink-4 font-light">/</span>
      <span className={`font-mono font-semibold tracking-[0.16em] uppercase text-ink-3 ${enCls}`}>{en}</span>
    </div>
  );
}
