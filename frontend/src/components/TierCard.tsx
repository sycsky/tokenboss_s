export interface TierCardProps {
  name: string;
  pricePeriod: string;
  leverage?: string;
  totalUsd?: string;
  dailyCap: string;
  models: string;
  ctaText: string;
  ctaVariant?: 'primary' | 'secondary' | 'disabled';
  featured?: boolean;
  soldOut?: boolean;
  tooltipExtras?: string[];
  onCtaClick?: () => void;
  className?: string;
}

export function TierCard({
  name,
  pricePeriod,
  leverage,
  totalUsd,
  dailyCap,
  models,
  ctaText,
  ctaVariant = 'secondary',
  featured = false,
  soldOut = false,
  tooltipExtras,
  onCtaClick,
  className = '',
}: TierCardProps) {
  const cardBase = 'relative rounded-md p-[22px_20px] border-2 border-ink';
  const cardVariant = featured
    ? 'bg-[#FFFAF5] shadow-[4px_4px_0_0_#1C1917]'
    : 'bg-surface shadow-[3px_3px_0_0_#1C1917]';

  // Slock-pixel CTA: filled fill, 2px ink border, 3px hard shadow, hover depresses.
  const ctaBase =
    'block w-full text-center py-[10px] rounded-md text-[13px] font-bold leading-snug cursor-pointer border-2 border-ink shadow-[3px_3px_0_0_#1C1917] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] transition-all';
  const ctaVariantCls =
    ctaVariant === 'primary'
      ? 'bg-accent text-white'
      : ctaVariant === 'disabled'
      ? 'bg-surface text-ink-3 cursor-not-allowed shadow-none hover:translate-x-0 hover:translate-y-0 hover:shadow-none'
      : 'bg-bg text-ink';

  return (
    <div
      className={`${cardBase} ${cardVariant} ${soldOut ? 'opacity-55' : ''} ${className}`}
    >
      {/* Header row: name + price */}
      <div className="flex items-baseline justify-between mb-3.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[18px] font-bold tracking-[-0.01em] text-ink">{name}</span>
          {featured && (
            <span className="text-accent text-[14px] leading-none">★</span>
          )}
          {soldOut && (
            <span className="font-mono text-[9.5px] font-bold tracking-[0.1em] uppercase text-ink-3 bg-surface-warm px-1.5 py-0.5 rounded-[4px] ml-1">
              售罄
            </span>
          )}
        </div>
        <span className="font-mono text-[13px] font-semibold text-ink-3 leading-snug">
          {pricePeriod}
        </span>
      </div>

      {/* Anchor row: leverage pill + total USD */}
      {(leverage || totalUsd) && (
        <div className="flex items-center gap-1.5 mb-3.5 font-mono text-[13px] font-bold text-accent leading-snug">
          {leverage && (
            <span className="inline-flex items-center bg-accent text-white text-[11px] font-bold tracking-[0.04em] px-2 py-0.5 rounded-[5px]">
              {leverage}
            </span>
          )}
          {totalUsd && <span>{totalUsd}</span>}
        </div>
      )}

      {/* Feature rows */}
      <ul className="mb-4 space-y-1">
        <li className="text-[13px] text-text-secondary leading-relaxed">
          <strong className="text-ink font-semibold">{dailyCap}</strong>
        </li>
        <li className="text-[13px] text-text-secondary leading-relaxed">
          <strong className="text-ink font-semibold">{models}</strong>
        </li>
      </ul>

      {/* CTA */}
      <div className="flex items-center gap-2">
        <button
          className={`${ctaBase} ${ctaVariantCls} flex-1`}
          onClick={onCtaClick}
          disabled={ctaVariant === 'disabled'}
        >
          {ctaText}
        </button>
        {tooltipExtras && tooltipExtras.length > 0 && (
          <div className="relative group flex-shrink-0">
            <button className="w-[30px] h-[30px] rounded-[7px] border border-border-2 bg-surface text-ink-3 text-[13px] font-serif italic font-semibold flex items-center justify-center hover:border-ink-3 hover:text-ink transition-colors">
              i
            </button>
            <div className="hidden group-hover:block absolute bottom-[calc(100%+8px)] right-0 bg-ink text-bg text-[11.5px] font-medium leading-relaxed px-3.5 py-2.5 rounded-[7px] whitespace-nowrap z-10 shadow-warm-lg">
              {tooltipExtras.join(' · ')}
              <span className="absolute top-full right-2.5 border-[5px] border-transparent border-t-ink" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
