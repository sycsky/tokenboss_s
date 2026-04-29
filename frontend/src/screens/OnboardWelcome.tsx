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
      cnLabel="接入"
      enLabel="Get connected"
      title="你是 Agent，还是人类？"
      subtitle="一分钟接好。挑一个最顺手的入口。"
    >
      <div className="space-y-4">
        <ChoiceCard
          variant="recommended"
          tag="推荐 · RECOMMENDED"
          title="我是 Agent"
          en="I'M AN AGENT"
          footnote="已支持 OpenClaw · Hermes Agent"
          onClick={() => nav('/onboard/install')}
        />
        <ChoiceCard
          variant="alt"
          tag="手动 · ADVANCED"
          title="我是人类"
          en="I'M A HUMAN"
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
  en: string;
  /** Optional small mono line under the title — used for the
   * supported-Agents list on the recommended card. */
  footnote?: string;
  onClick: () => void;
}

function ChoiceCard({ variant, tag, title, en, footnote, onClick }: ChoiceCardProps) {
  const isReco = variant === 'recommended';
  const fill = isReco ? 'bg-accent text-white' : 'bg-white text-ink';
  const tagColor = isReco ? 'text-white/70' : 'text-[#A89A8D]';
  const enColor = isReco ? 'text-white/55' : 'text-[#A89A8D]';
  const footColor = isReco ? 'text-white/70' : 'text-[#A89A8D]';

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
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[22px] font-bold tracking-tight">{title}</span>
            <span className={`font-mono text-[10px] font-bold tracking-[0.18em] ${enColor}`}>{en}</span>
          </div>
          {footnote && (
            <div className={`font-mono text-[11px] tracking-tight mt-1.5 ${footColor}`}>{footnote}</div>
          )}
        </div>
        <span aria-hidden="true" className="text-[24px] font-bold leading-none flex-shrink-0">→</span>
      </div>
    </button>
  );
}
