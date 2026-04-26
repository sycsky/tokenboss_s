import { Link } from 'react-router-dom';
import { CompatRow, AgentMark } from '../components/CompatRow';
import { TerminalBlock } from '../components/TerminalBlock';
import { TopNav } from '../components/TopNav';
import { useAuth } from '../lib/auth';
import openClawIcon from '../assets/agents/openclaw.svg';
import openAiIcon from '../assets/agents/openai.svg';
import hermesIcon from '../assets/agents/hermes.png';
import anthropicIcon from '../assets/agents/anthropic.svg';

const AGENTS: AgentMark[] = [
  {
    id: 'oc',
    name: 'OpenClaw',
    className: 'bg-[#0A0807] p-1',
    icon: <img src={openClawIcon} alt="" className="w-full h-full" style={{ imageRendering: 'pixelated' }} />,
  },
  {
    id: 'cx',
    name: 'Codex',
    className: 'bg-ink p-1.5',
    icon: <img src={openAiIcon} alt="" className="w-full h-full" />,
  },
  {
    id: 'hm',
    name: 'Hermes Agent',
    className: 'bg-white p-0',
    icon: <img src={hermesIcon} alt="" className="w-full h-full object-cover rounded-lg" />,
  },
  {
    id: 'cc',
    name: 'Claude Code',
    className: 'bg-transparent p-0',
    icon: <img src={anthropicIcon} alt="" className="w-full h-full rounded-lg" />,
  },
];

// v2 preview · industries the Primitives layer will cover. Used by the
// horizontal marquee in PrimitiveSection — array is duplicated at render
// time so the scroll loop has a seamless wrap.
const INDUSTRIES = [
  '短视频脚本', '投资研究', '办公自动化', '代码评审', '客户支持',
  '数据分析', '法律文档', '教育辅导', '内容运营', '招聘筛选',
];

/**
 * v2 preview · soft-entry section pitching the Primitives layer.
 * Two stacked equations (Agent = POWERFUL → Agent + Primitives = PRODUCTIVE)
 * + an industry marquee. No CTA — keeps it as a flag-planting teaser, not
 * a clickable promise we can't ship yet.
 */
function PrimitiveSection() {
  const agentChip = (
    <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-ink text-white shadow-[0_8px_24px_-10px_rgba(60,40,20,0.45)]">
      <span className="text-[18px] leading-none">🤖</span>
      <div className="leading-tight">
        <div className="text-[13px] font-bold tracking-tight">AI AGENT</div>
        <div className="font-mono text-[8.5px] font-bold tracking-[0.14em] uppercase text-ink-4 mt-0.5">
          AUTONOMOUS SYSTEM
        </div>
      </div>
    </div>
  );
  const primitiveChip = (
    <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-ink text-white border border-accent shadow-[0_0_0_1px_rgba(232,105,42,0.55),0_10px_28px_-8px_rgba(232,105,42,0.5)]">
      <span className="text-[18px] leading-none">◇</span>
      <div className="leading-tight">
        <div className="text-[13px] font-bold tracking-tight">PRIMITIVES</div>
        <div className="font-mono text-[8.5px] font-bold tracking-[0.14em] uppercase text-accent mt-0.5">
          BY TOKENBOSS
        </div>
      </div>
    </div>
  );
  const op = (s: string) => (
    <span className="font-mono text-[26px] md:text-[32px] text-ink-3 font-light leading-none px-1">{s}</span>
  );
  return (
    <section className="border-t border-hairline py-20 md:py-28">
      <div className="max-w-[1100px] mx-auto px-6 md:px-14">
        <p className="text-center font-mono text-[10.5px] font-bold tracking-[0.16em] uppercase text-ink-3 mb-12 md:mb-16">
          COMING SOON · v2
        </p>

        {/* Equation 1 · Agent = POWERFUL */}
        <div className="flex flex-col md:flex-row items-center justify-center gap-3 md:gap-5 mb-7 md:mb-10">
          {agentChip}
          {op('=')}
          <span className="text-[44px] md:text-[64px] lg:text-[80px] font-extrabold tracking-tight text-ink leading-[0.95]">
            POWERFUL.
          </span>
        </div>

        {/* Equation 2 · Agent + Primitives = PRODUCTIVE */}
        <div className="flex flex-col md:flex-row items-center justify-center gap-3 md:gap-5 mb-14 md:mb-20">
          {agentChip}
          {op('+')}
          {primitiveChip}
          {op('=')}
          <span className="text-[44px] md:text-[64px] lg:text-[80px] font-extrabold tracking-tight bg-gradient-to-r from-accent to-accent-deep bg-clip-text text-transparent leading-[0.95]">
            PRODUCTIVE.
          </span>
        </div>

        {/* Industry marquee */}
        <div className="relative overflow-hidden mb-10 md:mb-14">
          <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-16 md:w-24 bg-gradient-to-r from-bg to-transparent z-10" />
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-16 md:w-24 bg-gradient-to-l from-bg to-transparent z-10" />
          <div className="flex gap-3 industry-marquee w-max">
            {[...INDUSTRIES, ...INDUSTRIES].map((tag, i) => (
              <span
                key={i}
                className="font-mono text-[11px] tracking-wide text-ink-2 bg-surface border border-hairline rounded-full px-4 py-2 whitespace-nowrap"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        <p className="text-center font-mono text-[10.5px] font-bold tracking-[0.16em] uppercase text-ink-3">
          敬请期待 ·
        </p>
      </div>
    </section>
  );
}

/**
 * Animated terminal demo on the hero right side. Pure CSS keyframes loop a
 * 6-second cycle showing the four steps after a user runs the install
 * command in their Agent: typing the command → fetching → registering skill
 * → activating $10 trial → idle waiting for instructions.
 */
function HeroTerminalDemo() {
  return (
    <div className="font-mono text-[13px] leading-relaxed bg-[#1C1917] rounded-2xl border border-[#3A332D] shadow-[0_30px_60px_-30px_rgba(60,40,20,0.45),0_8px_24px_-10px_rgba(60,40,20,0.25)] overflow-hidden select-none">
      {/* chrome */}
      <div className="px-4 py-2.5 bg-[#0F0D0B] border-b border-[#3A332D] flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full bg-[#FB7185]"></span>
        <span className="w-2.5 h-2.5 rounded-full bg-[#FBBF24]"></span>
        <span className="w-2.5 h-2.5 rounded-full bg-[#34D399]"></span>
        <span className="ml-3 font-mono text-[10px] text-[#A89A8D] tracking-[0.16em] uppercase">claude-code · agent</span>
      </div>

      {/* body */}
      <div className="p-5 min-h-[260px] text-[#A89A8D]">
        <div className="flex items-baseline gap-2">
          <span className="text-accent font-semibold">$</span>
          <span className="text-[#FFF8F0] td-typing whitespace-nowrap overflow-hidden inline-block">set up tokenboss.com/skill.md</span>
          <span className="td-cursor inline-block w-[7px] h-[14px] bg-[#FFF8F0] -mb-[2px]"></span>
        </div>

        <div className="td-line td-line-1 mt-2 flex items-center gap-2">
          <span className="text-[#34D399]">→</span>
          <span>fetching <span className="text-[#FFF8F0]">tokenboss.com/skill.md</span></span>
        </div>

        <div className="td-line td-line-2 mt-1 flex items-center gap-2">
          <span className="text-[#34D399]">✓</span>
          <span>registered skill <span className="text-accent">tokenboss</span> <span className="opacity-60">v1.0.0</span></span>
        </div>

        <div className="td-line td-line-3 mt-1 flex items-center gap-2">
          <span className="text-[#34D399]">✓</span>
          <span>activated <span className="text-[#FFF8F0]">$10</span> · <span className="opacity-60">24 h trial</span></span>
        </div>

        <div className="td-line td-line-4 mt-4 flex items-center gap-2 text-[#FFF8F0]">
          <span className="text-accent">›</span>
          <span>ready for instructions</span>
          <span className="td-cursor-blink inline-block w-[7px] h-[14px] bg-[#FFF8F0] -mb-[2px]"></span>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  const { user } = useAuth();
  const isLoggedIn = !!user;
  return (
    <div className="min-h-screen bg-bg overflow-hidden">
      <TopNav current="home" />

      {/* Hero */}
      <section className="max-w-[1200px] mx-auto px-6 md:px-14 pt-12 md:pt-20 pb-10 md:pb-12">
        <CompatRow label="适配你喜欢的 Agent" agents={AGENTS} className="mb-7" />

        {/* 2-col on lg+, single col stacked on mobile */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] gap-x-12 gap-y-10 items-start">
          {/* LEFT: H1 + terminal + meta + CTA */}
          <div>
            <h1 className="font-sans text-[44px] md:text-[64px] lg:text-[72px] font-extrabold leading-none tracking-tight">
              你的 Agent<br />
              <span className="text-accent">钱包</span>
            </h1>

            <TerminalBlock cmd="set up tokenboss.com/skill.md" size="lg" className="mt-7 max-w-[520px]" />

            <p className="font-mono text-[11px] sm:text-xs text-ink-3 max-w-[520px] mt-3 leading-relaxed">
              在 <span className="text-ink-2 font-semibold">OpenClaw / Codex / Hermes / Claude Code</span> 终端粘贴一行 ·
              ¥ 人民币付款 · $ 美金额度计费
            </p>

            <div className="flex flex-wrap items-center gap-4 mt-8">
              {isLoggedIn ? (
                <Link
                  to="/dashboard"
                  className="px-5 py-3 bg-accent text-white rounded-lg font-semibold hover:bg-accent-deep transition-colors shadow-[0_8px_28px_-10px_rgba(232,105,42,0.55)]"
                >
                  去控制台 →
                </Link>
              ) : (
                <>
                  <Link
                    to="/register"
                    className="px-5 py-3 bg-accent text-white rounded-lg font-semibold hover:bg-accent-deep transition-colors shadow-[0_8px_28px_-10px_rgba(232,105,42,0.55)]"
                  >
                    免费开始 · 送 $10 体验
                  </Link>
                  <span className="text-[13px] text-ink-2">
                    已有账户？<Link to="/login" className="text-accent hover:underline">登录</Link>
                  </span>
                </>
              )}
            </div>
          </div>

          {/* RIGHT: animated terminal demo (lg+ only) */}
          <div className="hidden lg:block lg:pl-2">
            <HeroTerminalDemo />
          </div>
        </div>
      </section>

      <PrimitiveSection />

      {/* Footer */}
      <footer className="border-t border-border py-7 text-center font-mono text-[10.5px] text-ink-3 max-w-[1200px] mx-auto px-6">
        <div className="flex flex-wrap justify-center gap-3.5 mb-2.5">
          <Link to="/pricing" className="hover:text-ink transition-colors">套餐</Link>
        </div>
        <div>© 2026 TokenBoss</div>
      </footer>

      {/* Animated terminal demo keyframes (scoped via CSS class names, single 6s loop) */}
      <style>{`
        @keyframes td-type {
          0%   { width: 0; }
          15%  { width: 100%; }
          90%  { width: 100%; }
          100% { width: 0; }
        }
        @keyframes td-fadeup {
          0%, 100% { opacity: 0; transform: translateY(-3px); }
          /* hold visible 25-90% of cycle */
        }
        @keyframes td-cursor {
          0%, 12%   { opacity: 1; }
          12.01%, 100% { opacity: 0; }
        }
        @keyframes td-cursor-blink {
          0%, 60%   { opacity: 0; }
          70%, 100% { opacity: 1; }
          85%       { opacity: 0; }
        }
        .td-typing  { animation: td-type 6s steps(30, end) infinite; }
        .td-cursor  { animation: td-cursor 6s steps(1, end) infinite; }
        .td-line    { opacity: 0; animation-iteration-count: infinite; animation-duration: 6s; animation-timing-function: ease-out; animation-fill-mode: forwards; }
        .td-line-1  { animation-name: td-line-1; }
        .td-line-2  { animation-name: td-line-2; }
        .td-line-3  { animation-name: td-line-3; }
        .td-line-4  { animation-name: td-line-4; }
        @keyframes td-line-1 {
          0%, 24%  { opacity: 0; transform: translateY(-2px); }
          28%, 92% { opacity: 1; transform: translateY(0); }
          100%     { opacity: 0; transform: translateY(-2px); }
        }
        @keyframes td-line-2 {
          0%, 36%  { opacity: 0; transform: translateY(-2px); }
          40%, 92% { opacity: 1; transform: translateY(0); }
          100%     { opacity: 0; transform: translateY(-2px); }
        }
        @keyframes td-line-3 {
          0%, 48%  { opacity: 0; transform: translateY(-2px); }
          52%, 92% { opacity: 1; transform: translateY(0); }
          100%     { opacity: 0; transform: translateY(-2px); }
        }
        @keyframes td-line-4 {
          0%, 62%  { opacity: 0; transform: translateY(-2px); }
          66%, 92% { opacity: 1; transform: translateY(0); }
          100%     { opacity: 0; transform: translateY(-2px); }
        }
        .td-cursor-blink { animation: td-cursor-blink 1s steps(2, end) infinite; }
        @media (prefers-reduced-motion: reduce) {
          .td-typing, .td-cursor, .td-line, .td-cursor-blink { animation: none !important; opacity: 1 !important; width: 100% !important; }
        }
        @keyframes industry-marquee {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        .industry-marquee { animation: industry-marquee 30s linear infinite; }
        @media (prefers-reduced-motion: reduce) {
          .industry-marquee { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
