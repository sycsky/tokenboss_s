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
  /** When omitted, the CTA button isn't rendered at all — the card stays
   *  as a pure informational tile (used for tiers below the user's
   *  current paid plan, where there's no meaningful action to take). */
  ctaText?: string;
  /** primary = filled accent · secondary = white · disabled = unclickable
   *  · muted = clickable but visually de-emphasised (used for sold-out
   *  tiers that still link to a marketing detail page). */
  ctaVariant?: 'primary' | 'secondary' | 'disabled' | 'muted';
  featured?: boolean;
  /** Top-edge banner spanning the card width. Used to give every tier
   *  card a consistent header strip so the row of three reads as a
   *  uniform layout (without it, only Ultra had a banner during sold-out
   *  states and the row felt asymmetric). Examples:
   *    · Plus  — "入门之选"      (subtle)
   *    · Super — "推荐之选"      (strong)
   *    · Ultra — sold-out copy   (strong)
   */
  banner?: ReactNode;
  /** subtle = muted bg-bg-alt + ink-2 text (low-key tag for entry tier).
   *  strong = bg-accent + white text (loud, for the recommended tier).
   *  dark   = bg-ink + white text (used for the top tier — communicates
   *           "premium / restricted" without competing with Super's
   *           accent banner for attention). */
  bannerVariant?: 'subtle' | 'strong' | 'dark';
  /** Small italic note rendered under the CTA. Use to explain a non-obvious
   *  CTA state — e.g. drop schedule for tiers that re-open daily. */
  ctaHelper?: string;
  /** Rich hover-tooltip content (full model lineup, channel rates, etc.).
   *  When set, renders the [i] affordance next to the CTA. Pass JSX so the
   *  tooltip can be multi-line / structured — older `tooltipExtras: string[]`
   *  was single-line whitespace-nowrap which couldn't fit channel tables. */
  tooltipPanel?: ReactNode;
  /** Visually dim the entire card (opacity + light desaturation) so it
   *  reads at a glance as "not currently available" without resorting to
   *  hard color contrast. Used for sold-out tiers — gentler than a black
   *  banner, and pulls the eye toward the recommended (Super) card in
   *  the middle. Hover restores full opacity so users can still
   *  read details clearly. */
  dimmed?: boolean;
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
  banner,
  bannerVariant = 'strong',
  ctaHelper,
  tooltipPanel,
  dimmed = false,
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

  // Top banner styling — bleeds to card edges via negative margin so it
  // reads as a header strip, not a content row. Three variants tune
  // visual weight without changing layout:
  //   strong  — accent fill + white text (the recommended tier — wants
  //             attention, picks up the brand color).
  //   subtle  — bg-alt fill + ink-2 text (entry tier — uniform shape,
  //             low loudness, doesn't compete).
  //   dark    — ink fill + white text (top tier — high contrast but
  //             without using the brand accent, so Super's banner
  //             stays the page's focal point).
  const bannerCls =
    bannerVariant === 'subtle'
      ? 'bg-bg-alt text-ink-2 border-hairline'
      : bannerVariant === 'dark'
        ? 'bg-ink text-white border-ink'
        : 'bg-accent text-white border-ink';

  // "Dust over the card" effect for sold-out / unavailable tiers —
  // opacity drop + slight desaturation pulls visual weight off the card
  // without using harsh contrast. Hover lifts the dust so users who
  // really want to read the card aren't fighting the styling.
  const dimmedCls = dimmed
    ? 'opacity-65 saturate-[0.85] hover:opacity-95 hover:saturate-100 transition-all duration-200'
    : '';

  return (
    <div
      className={`${cardBase} ${cardVariant} ${dimmedCls} ${banner ? 'overflow-hidden' : ''} ${className}`}
    >
      {/* Top banner — every tier card gets one so the row reads as a
          uniform layout (no asymmetry from "Ultra has a banner, the
          other two don't"). Variant decides loudness. */}
      {banner && (
        <div
          className={`-mt-[22px] -mx-[20px] mb-4 border-b-2 py-2 px-4 font-mono text-[11px] font-bold tracking-[0.12em] uppercase text-center leading-snug ${bannerCls}`}
        >
          {banner}
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

      {/* CTA row — only rendered when there's an actual button to show.
          When ctaText is omitted (user is on a higher tier than this
          card), the entire row including the [i] tooltip is suppressed,
          so the card ends cleanly below the feature rows as a pure
          informational tile. The [i] tooltip's content (model lineup /
          channel rates) isn't valuable for tiers the user has already
          surpassed — no need to leak it as an orphan icon. */}
      {ctaText && (
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
      )}
      {ctaHelper && ctaText && (
        <div className="mt-2 font-mono text-[10.5px] text-ink-3 leading-relaxed">
          {ctaHelper}
        </div>
      )}
    </div>
  );
}
