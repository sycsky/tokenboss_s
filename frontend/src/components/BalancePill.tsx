export function BalancePill({ amount, label = '余额' }: { amount: string; label?: string }) {
  return (
    <span className="inline-flex items-baseline gap-2 px-3.5 py-1.5 bg-surface border border-border rounded-lg font-mono">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{label}</span>
      <span className="text-[15px] font-bold text-ink">{amount}</span>
    </span>
  );
}
