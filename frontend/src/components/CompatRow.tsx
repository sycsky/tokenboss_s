export interface AgentMark {
  id: string;
  label: string;
  name: string;
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
      <div className="flex gap-1.5 flex-wrap">
        {agents.map(a => (
          <div
            key={a.id}
            title={a.name}
            className={`w-[30px] h-[30px] rounded-[7px] flex items-center justify-center font-mono text-[9.5px] font-bold text-white tracking-wide ${a.className ?? 'bg-ink'}`}
          >
            {a.label}
          </div>
        ))}
      </div>
    </div>
  );
}
