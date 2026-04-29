import type { ReactNode } from 'react';

export interface TierCardProps {
  name: string;
  pricePeriod: string;
  leverage?: string;
  totalUsd?: string;
  dailyCap: string;
  /** Usage-intensity bullets — "深度使用 Codex 模型" style, not raw model
   *  enumeration. Each entry renders as its own line. The technical model
   *  list (`GPT-5.5 / 5.4 ...`) lives in the [i] tooltip, not here. */
  models: string[];
  ctaText: string;
  /** primary = filled accent · secondary = white · disabled = unclickable
   *  · muted = clickable but visually de-emphasised (used for sold-out
   *  tiers that still link to a marketing detail page). */
  ctaVariant?: 'primary' | 'secondary' | 'disabled' | 'muted';
  featured?: boolean;
  /** Strong top-edge banner rendered above the card content. Use for
   *  "今日已抢完 · 明日 10:00 再开" style sold-out states — far more
   *  visible than a small badge + opacity. Replaces the old `soldOut`
   *  prop's weak pill. */
  soldOutBanner?: ReactNode;
  /** Small italic note rendered under the CTA. Use to explain a non-obvious
   *  CTA state — e.g. drop schedule for tiers that re-open daily. */
  ctaHelper?: string;
  /** Rich hover-tooltip content (full model lineup, channel rates, etc.).
   *  When set, renders the [i] affordance next to the CTA. Pass JSX so the
   *  tooltip can be multi-line / structured — older `tooltipExtras: string[]`
   *  was single-line whitespace-nowrap which couldn't fit channel tables. */
  tooltipPanel?: ReactNode;
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
  soldOutBanner,
  ctaHelper,
  tooltipPanel,
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
      : ctaVariant === 'muted'
      ? 'bg-surface text-ink-2 font-mono text-[12px] tracking-tight'
      : 'bg-bg text-ink';

  return (
    <div
      className={`${cardBase} ${cardVariant} ${soldOutBanner ? 'overflow-hidden' : ''} ${className}`}
    >
      {/* Sold-out banner — bleeds to card edges via negative margin. Strong
          contrast (accent fill + white text) so the state is unmissable
          even at a glance from across the page. */}
      {soldOutBanner && (
        <div className="-mt-[22px] -mx-[20px] mb-4 bg-accent text-white border-b-2 border-ink py-2 px-4 font-mono text-[11px] font-bold tracking-[0.12em] uppercase text-center leading-snug">
          {soldOutBanner}
        </div>
      )}

      {/* Header row: name + price */}
      <div className="flex items-baseline justify-between mb-3.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[18px] font-bold tracking-[-0.01em] text-ink">{name}</span>
          {featured && (
            <span className="text-accent text-[14px] leading-none">★</span>
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
        {models.map((line) => (
          <li key={line} className="text-[13px] text-text-secondary leading-relaxed">
            <strong className="text-ink font-semibold">{line}</strong>
          </li>
        ))}
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
        {tooltipPanel && (
          <div className="relative group flex-shrink-0">
            <button className="w-[30px] h-[30px] rounded-[7px] border border-border-2 bg-surface text-ink-3 text-[13px] font-serif italic font-semibold flex items-center justify-center hover:border-ink-3 hover:text-ink transition-colors">
              i
            </button>
            <div className="hidden group-hover:block absolute bottom-[calc(100%+8px)] right-0 w-[300px] bg-ink text-bg text-[12px] font-medium leading-relaxed px-4 py-3 rounded-[7px] z-10 shadow-warm-lg">
              {tooltipPanel}
              <span className="absolute top-full right-2.5 border-[5px] border-transparent border-t-ink" />
            </div>
          </div>
        )}
      </div>
      {ctaHelper && (
        <div className="mt-2 font-mono text-[10.5px] text-ink-3 leading-relaxed">
          {ctaHelper}
        </div>
      )}
    </div>
  );
}
