export interface HourBucket {
  hour: number;       // 0-23
  consumeUsd: number;
}

export interface ConsumeChart24hProps {
  buckets: HourBucket[];
  variant?: 'mobile' | 'desktop';
  className?: string;
}

export function ConsumeChart24h({ buckets, variant = 'desktop', className = '' }: ConsumeChart24hProps) {
  const peakValue = Math.max(...buckets.map(b => b.consumeUsd), 0.01);
  const heightPct = (v: number) => Math.max(2, (v / peakValue) * 100);
  const barHeight = variant === 'mobile' ? 'h-[60px]' : 'h-[160px]';

  return (
    <div className={`bg-surface border border-border rounded-xl p-4 ${className}`}>
      <div className={`flex items-end gap-1 ${barHeight} border-b border-hairline`}>
        {buckets.map((b, i) => {
          const isPeak = b.consumeUsd === peakValue && b.consumeUsd > 0.01;
          return (
            <div
              key={i}
              data-bar
              data-peak={isPeak ? 'true' : 'false'}
              className={`flex-1 rounded-t-sm ${isPeak ? 'bg-accent-deep' : 'bg-accent'}`}
              style={{ height: `${heightPct(b.consumeUsd)}%`, minHeight: '2px' }}
              title={`${b.hour}:00 - $${b.consumeUsd.toFixed(2)}`}
            />
          );
        })}
      </div>
      {variant === 'desktop' && (
        <div className="flex gap-1 mt-1.5 font-mono text-[10px] text-ink-3 tracking-tight">
          {buckets.map((b, i) => (
            <span key={i} className="flex-1 text-center">{b.hour}</span>
          ))}
        </div>
      )}
    </div>
  );
}
