import type { ReactNode } from 'react';

export interface AgentMark {
  id: string;
  /** Optional: short text label fallback when no glyph/icon is provided. */
  label?: string;
  /** Optional: single Unicode glyph (rendered larger than label, more iconographic). */
  glyph?: string;
  /** Optional: arbitrary inline node (e.g. inline SVG) — wins over glyph/label. */
  icon?: ReactNode;
  /** Tooltip / accessibility name. */
  name: string;
  /** Tailwind classes for the chip background (gradient or solid). */
  className?: string;
}

export interface CompatRowProps {
  label: string;
  agents: AgentMark[];
  className?: string;
}

export function CompatRow({ label, agents, className = '' }: CompatRowProps) {
  return (
    <div className={`flex items-center gap-3 py-2 ${className}`}>
      <span className="font-mono text-[9.5px] font-bold tracking-[0.16em] uppercase text-ink-3 flex-shrink-0">
        {label}
      </span>
      <div className="flex gap-2 flex-wrap">
        {agents.map(a => {
          const content = a.icon
            ? a.icon
            : a.glyph
              ? <span className="text-[18px] leading-none font-light">{a.glyph}</span>
              : a.label
                ? <span className="font-mono text-[9.5px] font-bold tracking-wide">{a.label}</span>
                : null;
          return (
            <div
              key={a.id}
              title={a.name}
              aria-label={a.name}
              className={`w-9 h-9 rounded-lg flex items-center justify-center text-white shadow-[0_1px_0_rgba(0,0,0,0.05),0_4px_12px_-4px_rgba(60,40,20,0.2)] ${a.className ?? 'bg-ink'}`}
            >
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
