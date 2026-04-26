export type UsageEventType = 'consume' | 'reset' | 'expire' | 'topup' | 'refund';

export interface UsageRowProps {
  time: string;           // e.g. "2026/04/26 9:41"
  eventType: UsageEventType;
  source?: string;
  model?: string;
  amount: string;         // "−$0.027" or "+$30.00"
  variant?: 'mobile' | 'desktop';
}

const TYPE_STYLES: Record<UsageEventType, { pill: string; amount: string; label: string }> = {
  consume: { pill: 'bg-accent-soft text-accent-ink', amount: 'text-accent-deep', label: '消耗' },
  reset:   { pill: 'bg-green-soft text-green-ink', amount: 'text-green-ink', label: '重置' },
  expire:  { pill: 'bg-surface-2 text-ink-3 border border-border', amount: 'text-ink-3', label: '作废' },
  topup:   { pill: 'bg-green-soft text-green-ink', amount: 'text-green-ink', label: '充值' },
  refund:  { pill: 'bg-surface-2 text-ink-3', amount: 'text-ink-3', label: '退款' },
};

export function UsageRow({ time, eventType, source, model, amount, variant = 'desktop' }: UsageRowProps) {
  const styles = TYPE_STYLES[eventType];
  if (variant === 'mobile') {
    return (
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-hairline">
        <div className="font-mono text-[10.5px] text-ink-3 w-12 flex-shrink-0">{time}</div>
        <div className="flex-1 min-w-0">
          {model && <div className="text-[12.5px] font-semibold text-ink truncate">{model}</div>}
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`font-mono text-[10px] font-bold tracking-wide px-1.5 py-0.5 rounded ${styles.pill}`}>{styles.label}</span>
            {source && <span className="font-mono text-[10px] text-ink-3">{source}</span>}
          </div>
        </div>
        <div className={`font-mono text-[12px] font-bold ${styles.amount}`}>{amount}</div>
      </div>
    );
  }
  // desktop: table-row layout (assume parent <table>)
  return (
    <tr className="border-b border-hairline hover:bg-surface-2">
      <td className="font-mono text-[12.5px] text-ink-2 px-4 py-2.5">{time}</td>
      <td className="px-4 py-2.5">
        <span className={`font-mono text-[10px] font-bold tracking-wide px-2 py-0.5 rounded ${styles.pill}`}>{styles.label}</span>
      </td>
      <td className="font-mono text-[11px] text-ink-3 px-4 py-2.5">{source || '—'}</td>
      <td className="text-[13.5px] font-semibold text-ink px-4 py-2.5">{model || '—'}</td>
      <td className={`text-right font-mono text-[13px] font-bold px-4 py-2.5 ${styles.amount}`}>{amount}</td>
    </tr>
  );
}
