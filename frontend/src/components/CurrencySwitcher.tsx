import { useCurrency, type Currency } from '../lib/currency';

/**
 * Two-segment Slock-pixel pill: ¥ RMB · $ USD. Active segment is
 * ink-filled; inactive is bg-bg with hover depress. Lives in the
 * top-right of pricing sections (Plans hero, Landing 套餐 SectionHeader,
 * /billing/pay header) — never in global nav, since currency is a
 * local-to-this-section decision.
 *
 * Reads + writes the same context, so toggling on any surface mirrors
 * everywhere immediately (and across tabs via the storage event).
 */
export function CurrencySwitcher({ className = '' }: { className?: string }) {
  const { currency, setCurrency } = useCurrency();

  return (
    <div
      role="radiogroup"
      aria-label="结算货币"
      className={`inline-flex items-stretch border-2 border-ink rounded shadow-[2px_2px_0_0_#1C1917] overflow-hidden ${className}`}
    >
      <Segment
        value="rmb"
        active={currency === 'rmb'}
        label="¥ RMB"
        onSelect={setCurrency}
      />
      <span aria-hidden="true" className="w-[2px] bg-ink self-stretch" />
      <Segment
        value="usd"
        active={currency === 'usd'}
        label="$ USD"
        onSelect={setCurrency}
      />
    </div>
  );
}

function Segment({
  value,
  active,
  label,
  onSelect,
}: {
  value: Currency;
  active: boolean;
  label: string;
  onSelect: (c: Currency) => void;
}) {
  const base =
    'px-2.5 py-1 font-mono text-[10.5px] font-bold tracking-[0.12em] uppercase transition-colors';
  const cls = active
    ? `${base} bg-ink text-bg`
    : `${base} bg-bg text-ink-2 hover:text-ink hover:bg-bg-alt`;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={() => onSelect(value)}
      className={cls}
    >
      {label}
    </button>
  );
}
