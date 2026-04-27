/**
 * Slock-pixel inline balance display. Lives in places like the page
 * hero of UsageHistory where the number is informational, not the
 * primary visual focus (the Dashboard hero handles that).
 */
export function BalancePill({ amount, label = '余额' }: { amount: string; label?: string }) {
  return (
    <span className="inline-flex items-baseline gap-2.5 px-4 py-2 bg-white border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917] font-mono">
      <span className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#A89A8D]">{label}</span>
      <span className="text-[15px] font-bold text-ink">{amount}</span>
    </span>
  );
}
