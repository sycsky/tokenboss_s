export type UsageEventType = 'consume' | 'reset' | 'expire' | 'topup' | 'refund';

export interface UsageRowProps {
  time: string;           // e.g. "2026/04/26 9:41"
  eventType: UsageEventType;
  source?: string;
  model?: string;
  amount: string;         // "−$0.027" or "+$30.00"
  variant?: 'mobile' | 'desktop';
}

// Each event type carries a "stamp" pill (matching Slock-pixel — solid fill +
// 2px ink border) and an amount color. Consume is brand orange to call out the
// most common case; positive movements (reset / topup) lean green; expire and
// refund are quieter neutrals.
const TYPE_STYLES: Record<UsageEventType, { pill: string; amount: string; label: string }> = {
  consume: { pill: 'bg-accent text-white border-2 border-ink', amount: 'text-accent-deep', label: '消耗' },
  reset:   { pill: 'bg-[#16A34A] text-white border-2 border-ink', amount: 'text-[#15803D]', label: '重置' },
  expire:  { pill: 'bg-bg text-ink border-2 border-ink', amount: 'text-[#A89A8D]', label: '作废' },
  topup:   { pill: 'bg-[#16A34A] text-white border-2 border-ink', amount: 'text-[#15803D]', label: '充值' },
  refund:  { pill: 'bg-bg text-ink border-2 border-ink', amount: 'text-[#A89A8D]', label: '退款' },
};

export function UsageRow({ time, eventType, source, model, amount, variant = 'desktop' }: UsageRowProps) {
  const styles = TYPE_STYLES[eventType];
  if (variant === 'mobile') {
    return (
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b-2 border-ink/10 last:border-b-0">
        <div className="font-mono text-[10.5px] text-[#A89A8D] w-12 flex-shrink-0">{time}</div>
        <div className="flex-1 min-w-0">
          {model && <div className="text-[12.5px] font-semibold text-ink truncate">{model}</div>}
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`font-mono text-[9.5px] font-bold tracking-wider uppercase px-1.5 py-px rounded ${styles.pill}`}>
              {styles.label}
            </span>
            {source && <span className="font-mono text-[10px] text-[#A89A8D]">{source}</span>}
          </div>
        </div>
        <div className={`font-mono text-[12px] font-bold ${styles.amount}`}>{amount}</div>
      </div>
    );
  }
  // desktop: table-row layout (assume parent <table>)
  return (
    <tr className="border-b-2 border-ink/10 last:border-b-0 hover:bg-bg/50">
      <td className="font-mono text-[12.5px] text-ink-2 px-4 py-2.5">{time}</td>
      <td className="px-4 py-2.5">
        <span className={`font-mono text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded ${styles.pill}`}>
          {styles.label}
        </span>
      </td>
      <td className="font-mono text-[11px] text-[#A89A8D] px-4 py-2.5">{source || '—'}</td>
      <td className="text-[13.5px] font-semibold text-ink px-4 py-2.5">{model || '—'}</td>
      <td className={`text-right font-mono text-[13px] font-bold px-4 py-2.5 ${styles.amount}`}>{amount}</td>
    </tr>
  );
}
