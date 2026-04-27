import { useNavigate } from 'react-router-dom';
import { OnboardShell } from '../components/OnboardShell';

/**
 * Step 01 — pick the onboarding path. Two big Slock-pixel choice cards:
 * the recommended "Agent 用户" path (accent fill) and the "manual" escape
 * hatch for users who want to wire base_url + API key by hand.
 */
export default function OnboardWelcome() {
  const nav = useNavigate();

  return (
    <OnboardShell
      step="01"
      cnLabel="接入方式"
      enLabel="Pick your path"
      title="怎么接入？"
      subtitle="告诉我们你的使用场景，给你最合适的引导。"
    >
      <div className="space-y-4">
        <ChoiceCard
          variant="recommended"
          tag="推荐 · RECOMMENDED"
          title="我是 Agent 用户"
          desc="在 OpenClaw / Hermes / Claude Code 终端粘贴一行咒语，30 秒搞定。"
          onClick={() => nav('/onboard/install')}
        />
        <ChoiceCard
          variant="alt"
          tag="手动 · ADVANCED"
          title="我自己配置"
          desc="看详细步骤，手动配 API key + base_url。"
          onClick={() => nav('/install/manual')}
        />
      </div>
    </OnboardShell>
  );
}

interface ChoiceCardProps {
  variant: 'recommended' | 'alt';
  tag: string;
  title: string;
  desc: string;
  onClick: () => void;
}

function ChoiceCard({ variant, tag, title, desc, onClick }: ChoiceCardProps) {
  const isReco = variant === 'recommended';
  const fill = isReco ? 'bg-accent text-white' : 'bg-white text-ink';
  const tagColor = isReco ? 'text-white/70' : 'text-[#A89A8D]';
  const descColor = isReco ? 'text-white/85' : 'text-[#6B5E52]';

  return (
    <button
      onClick={onClick}
      className={
        `w-full text-left ${fill} border-2 border-ink rounded-lg p-6 ` +
        'shadow-[4px_4px_0_0_#1C1917] ' +
        'hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_0_#1C1917] ' +
        'active:translate-x-[3px] active:translate-y-[3px] active:shadow-[1px_1px_0_0_#1C1917] ' +
        'transition-all'
      }
    >
      <div className={`font-mono text-[10px] tracking-[0.18em] uppercase font-bold mb-3 ${tagColor}`}>
        {tag}
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex-1">
          <div className="text-[22px] font-bold tracking-tight mb-1">{title}</div>
          <div className={`text-[13.5px] leading-relaxed ${descColor}`}>{desc}</div>
        </div>
        <span aria-hidden="true" className="text-[24px] font-bold leading-none flex-shrink-0">→</span>
      </div>
    </button>
  );
}
