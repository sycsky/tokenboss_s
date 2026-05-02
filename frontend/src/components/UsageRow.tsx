export type UsageEventType = 'consume' | 'reset' | 'expire' | 'topup' | 'refund';

export interface UsageRowProps {
  time: string;              // e.g. "2026/04/26 9:41"
  eventType: UsageEventType;
  source?: string;
  /** Which API key the call billed to (e.g. "default", "ci-bot"). When
   *  the user has multiple keys this disambiguates "which key spent
   *  this $". Rendered as a secondary line under `source` on desktop,
   *  and as a small chip on mobile when `showSourceOnMobile` is on. */
  keyHint?: string;
  model?: string;
  /** Absolute USD value of the change. Sign is derived from eventType
   *  (consume / expire are negatives, reset / topup / refund are positives)
   *  so the backend can keep storing magnitudes and the UI owns presentation. */
  amountUsd: number;
  variant?: 'mobile' | 'desktop';
  /** Mobile-only: whether to render `source` as a secondary chip after the
   *  type pill. Off by default so Dashboard's compact "最近使用" rows stay
   *  visually dense; UsageHistory's full mobile list opts in. */
  showSourceOnMobile?: boolean;
  /** Hide the source cell entirely (both desktop column and mobile span).
   *  Used while UA-based attribution is unreliable — Hermes / Codex / Claude
   *  Code all use the openai-python SDK, so their UA is `OpenAI/Python ...`
   *  and our regex bucket falls through to 'other'. Re-enable this prop
   *  (or just drop the explicit `false`) once X-Source header propagation
   *  is wired into each agent's install snippet. */
  showSourceColumn?: boolean;
}

// Each event type carries a "stamp" pill (matching Slock-pixel — solid fill +
// 2px ink border), an amount color, and the sign used to render the change.
// Consume / expire are negatives in red; reset / topup / refund are positives
// in green. Spec credits-economy § 8 mandates these semantics.
const TYPE_STYLES: Record<UsageEventType, {
  pill: string;
  amount: string;
  label: string;
  sign: '+' | '−';
}> = {
  consume: { pill: 'bg-accent text-white border-2 border-ink', amount: 'text-red-600', label: '消耗', sign: '−' },
  reset:   { pill: 'bg-[#16A34A] text-white border-2 border-ink', amount: 'text-[#15803D]', label: '重置', sign: '+' },
  expire:  { pill: 'bg-bg text-ink border-2 border-ink', amount: 'text-[#A89A8D]', label: '作废', sign: '−' },
  topup:   { pill: 'bg-[#16A34A] text-white border-2 border-ink', amount: 'text-[#15803D]', label: '充值', sign: '+' },
  refund:  { pill: 'bg-bg text-ink border-2 border-ink', amount: 'text-[#A89A8D]', label: '退款', sign: '+' },
};

export function UsageRow({ time, eventType, source, keyHint, model, amountUsd, variant = 'desktop', showSourceOnMobile = false, showSourceColumn = true }: UsageRowProps) {
  const styles = TYPE_STYLES[eventType];
  const amount = `${styles.sign}$${Math.abs(amountUsd).toFixed(6)}`;
  if (variant === 'mobile') {
    // Compact list rows. Time auto-sizes (whitespace-nowrap) so longer
    // formats like "今天 14:30" or "5月1日 14:30" fit. Source vs keyHint
    // are visually distinguished (source = plain mono text, keyHint =
    // chip with `key:` prefix) so a user whose API key happens to share
    // a name with their agent terminal can still tell them apart.
    return (
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b-2 border-ink/10 last:border-b-0">
        <div className="font-mono text-[10.5px] text-[#A89A8D] flex-shrink-0 whitespace-nowrap">{time}</div>
        <div className="flex-1 min-w-0">
          {model && <div className="text-[12.5px] font-semibold text-ink truncate">{model}</div>}
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className={`font-mono text-[9.5px] font-bold tracking-wider uppercase px-1.5 py-px rounded ${styles.pill}`}>
              {styles.label}
            </span>
            {showSourceOnMobile && showSourceColumn && source && (
              <span className="font-mono text-[10px] text-[#A89A8D] truncate">{source}</span>
            )}
            {showSourceOnMobile && keyHint && (
              <span className="inline-flex items-center gap-0.5 font-mono text-[10px] text-ink-3 bg-bg border border-ink/15 rounded px-1.5 py-px truncate">
                <span className="text-ink-4 text-[8.5px] uppercase tracking-wider">key</span>
                <span>{keyHint}</span>
              </span>
            )}
          </div>
        </div>
        <div className={`font-mono text-[12px] font-bold flex-shrink-0 ${styles.amount}`}>{amount}</div>
      </div>
    );
  }
  // desktop: table-row layout (assume parent <table>). Source and API key
  // get their own columns now — previously they shared a single "来源" cell
  // with keyHint as a small secondary line, which made user-named keys
  // ("Hermes" → looks like "Hermes Agent") visually indistinguishable
  // from the actual source attribution.
  return (
    <tr className="border-b-2 border-ink/10 last:border-b-0 hover:bg-bg/50">
      <td className="font-mono text-[12.5px] text-ink-2 px-4 py-2.5">{time}</td>
      <td className="px-4 py-2.5">
        <span className={`font-mono text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded ${styles.pill}`}>
          {styles.label}
        </span>
      </td>
      {showSourceColumn && (
        <td className="font-mono text-[11px] text-[#A89A8D] px-4 py-2.5">
          {source || '—'}
        </td>
      )}
      <td className="px-4 py-2.5">
        {keyHint ? (
          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-ink-3 bg-bg border border-ink/15 rounded px-1.5 py-0.5 max-w-[160px] truncate">
            <span className="text-ink-4 text-[9px] uppercase tracking-wider flex-shrink-0">key</span>
            <span className="truncate">{keyHint}</span>
          </span>
        ) : (
          <span className="font-mono text-[11px] text-[#A89A8D]">—</span>
        )}
      </td>
      <td className="text-[13.5px] font-semibold text-ink px-4 py-2.5">{model || '—'}</td>
      <td className={`text-right font-mono text-[13px] font-bold px-4 py-2.5 ${styles.amount}`}>{amount}</td>
    </tr>
  );
}
