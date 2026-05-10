import { useEffect, useState } from 'react';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧'];

function Spinner({ offset = 0 }: { offset?: number }) {
  const [i, setI] = useState(offset % FRAMES.length);
  useEffect(() => {
    const id = setInterval(() => setI(p => (p + 1) % FRAMES.length), 100);
    return () => clearInterval(id);
  }, []);
  return <span className="text-accent">{FRAMES[i]}</span>;
}

export interface MonoLogLoaderProps {
  /** Header label. Defaults to "tokenboss · syncing". */
  title?: string;
  /** 1-3 endpoint labels. Each renders as a line with a stagger-offset spinner. */
  endpoints: string[];
}

/**
 * Black mono-log loading block with braille spinners. Used on Dashboard /
 * UsageHistory / Settings / OrderStatus so the brand voice of the install
 * spell ("set up tokenboss.co/skill.md") shows up at every login-gated
 * page's loading moment too.
 */
export function MonoLogLoader({
  title = 'tokenboss · syncing',
  endpoints,
}: MonoLogLoaderProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="bg-ink text-bg border-2 border-ink rounded-lg shadow-[4px_4px_0_0_#1C1917] px-6 py-5 sm:px-7 sm:py-6 min-h-[148px]"
    >
      <div className="font-mono text-[9.5px] tracking-[0.18em] uppercase font-bold text-bg/55 mb-3">
        {title}
      </div>
      {endpoints.map((endpoint, i) => (
        <div key={endpoint} className="font-mono text-[13px] leading-[1.95]">
          <span className="text-bg/40 mr-2.5">›</span>
          {endpoint} <Spinner offset={i * 3} />
        </div>
      ))}
      <span className="sr-only">正在加载</span>
    </div>
  );
}
