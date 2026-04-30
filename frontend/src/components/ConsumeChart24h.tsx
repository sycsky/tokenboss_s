import { useState } from 'react';

export interface HourBucket {
  hour: number;       // 0-23
  consumeUsd: number;
}

export interface ConsumeChart24hProps {
  buckets: HourBucket[];
  variant?: 'mobile' | 'desktop';
  className?: string;
}

/** Format an hour-of-day as a [HH:00, HH+1:00) range. Wraps 23 → 00. */
function hourRange(h: number): string {
  const next = (h + 1) % 24;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:00 - ${pad(next)}:00`;
}

/**
 * 24-hour consumption bar chart. Each bar is sharp-edged terracotta on a
 * Slock-pixel card; the peak hour gets a deeper accent shade so it
 * registers without needing a legend dot. Hovering a bar pops a small
 * Slock-pixel card with the hour's range + USD spent.
 */
export function ConsumeChart24h({ buckets, variant = 'desktop', className = '' }: ConsumeChart24hProps) {
  const peakValue = Math.max(...buckets.map((b) => b.consumeUsd), 0.01);
  const heightPct = (v: number) => Math.max(2, (v / peakValue) * 100);
  const barHeight = variant === 'mobile' ? 'h-[60px]' : 'h-[160px]';
  const [hover, setHover] = useState<number | null>(null);

  return (
    <div className={`bg-white border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917] p-4 ${className}`}>
      <div className={`relative flex items-end gap-1 ${barHeight} border-b-2 border-ink`}>
        {buckets.map((b, i) => {
          const isPeak = b.consumeUsd === peakValue && b.consumeUsd > 0.01;
          const isHover = hover === i;
          return (
            <div
              key={i}
              data-bar
              data-peak={isPeak ? 'true' : 'false'}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
              className={
                'flex-1 cursor-pointer transition-colors ' +
                (isHover ? 'bg-ink' : isPeak ? 'bg-accent-deep' : 'bg-accent')
              }
              style={{ height: `${heightPct(b.consumeUsd)}%`, minHeight: '2px' }}
            />
          );
        })}

        {/* Tooltip — absolutely positioned above the hovered bar.
            Centered on the bar via translateX(-50%); pointer-events none
            so it doesn't steal hover from the bar underneath. */}
        {hover !== null && buckets[hover] && (
          <div
            className={
              'absolute -top-1 -translate-y-full -translate-x-1/2 pointer-events-none ' +
              'bg-white border-2 border-ink rounded shadow-[2px_2px_0_0_#1C1917] ' +
              'px-2.5 py-1.5 whitespace-nowrap'
            }
            style={{ left: `${((hover + 0.5) / buckets.length) * 100}%` }}
          >
            <div className="font-mono text-[10px] tracking-[0.08em] uppercase text-[#A89A8D] font-bold">
              {hourRange(buckets[hover].hour)}
            </div>
            <div className="font-mono text-[12.5px] font-bold text-ink">
              ${buckets[hover].consumeUsd.toFixed(4)}
              <span className="ml-1 text-[10px] text-[#A89A8D] font-normal">消耗</span>
            </div>
          </div>
        )}
      </div>
      {variant === 'desktop' && (
        <div className="flex gap-1 mt-2 font-mono text-[10px] text-[#A89A8D] tracking-tight">
          {buckets.map((b, i) => (
            <span key={i} className="flex-1 text-center">{b.hour}</span>
          ))}
        </div>
      )}
    </div>
  );
}
