/**
 * Shared payment-channel selector card. Used by both the plan checkout
 * (Payment.tsx) and the topup checkout (Topup.tsx). Visual identical to
 * the original inline component in Payment.tsx pre-extraction; behaviour
 * is just (active, onClick, title, subtitle, tag).
 */

interface Props {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
  tag: string;
}

export function ChannelOption({ active, onClick, title, subtitle, tag }: Props) {
  const base =
    'block w-full text-left p-5 border-2 border-ink rounded-md transition-all';
  const onState = active
    ? 'bg-ink text-bg shadow-[3px_3px_0_0_#1C1917]'
    : 'bg-white text-ink shadow-[3px_3px_0_0_#1C1917] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_0_#1C1917]';

  return (
    <button onClick={onClick} className={`${base} ${onState}`} type="button">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <span className="text-[16px] font-bold">{title}</span>
        <span
          className={
            'font-mono text-[10px] tracking-[0.08em] px-1.5 py-0.5 rounded border-2 ' +
            (active
              ? 'border-bg text-bg'
              : 'border-ink text-ink-2')
          }
        >
          {tag}
        </span>
      </div>
      <div
        className={
          'text-[12.5px] ' + (active ? 'text-bg/80' : 'text-text-secondary')
        }
      >
        {subtitle}
      </div>
    </button>
  );
}
