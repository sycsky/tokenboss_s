import { TopNav } from '../components/TopNav';

/**
 * Primitive layer · v2 preview page.
 * Visual style borrows from blockrun.ai: pure dark bg, neon-green
 * accent, mono everywhere, terminal-style live data feel. We deliberately
 * keep this page light-weight — it's a flag-planted teaser, not a feature.
 */
export default function Primitive() {
  return (
    <div className="min-h-screen bg-[#0A0807] text-white selection:bg-[#34D399]/30">
      <TopNav current="primitive" theme="dark" />

      {/* Subtle dotted-grid background */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(255,255,255,0.4) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      <main className="relative max-w-[1100px] mx-auto px-6 md:px-14 pt-16 md:pt-24 pb-20 md:pb-28">
        {/* Status pill */}
        <div className="flex items-center gap-2 mb-8">
          <span className="relative flex w-2 h-2">
            <span className="absolute inset-0 rounded-full bg-[#34D399] animate-ping opacity-75" />
            <span className="relative w-2 h-2 rounded-full bg-[#34D399]" />
          </span>
          <span className="font-mono text-[10.5px] font-bold tracking-[0.16em] uppercase text-[#34D399]">
            Coming Soon · 即将发布
          </span>
        </div>

        {/* Hero */}
        <h1 className="font-sans text-[80px] md:text-[120px] lg:text-[140px] font-extrabold leading-[0.92] tracking-tight mb-6">
          <span className="bg-gradient-to-r from-[#34D399] via-[#5EEAD4] to-[#34D399] bg-clip-text text-transparent">
            Primitives.
          </span>
        </h1>

        <p className="text-white/60 max-w-xl text-[16px] md:text-[18px] leading-relaxed mb-12 md:mb-16">
          让 Agent 真正解决问题。
          <br className="hidden md:block" />
          <span className="text-white/40">
            把 LLM、Skill、第三方 API 打包成一个个原子化的能力 — 即装即用。
          </span>
        </p>

        {/* Equation */}
        <div className="flex flex-col md:flex-row items-start md:items-center gap-3 md:gap-5 mb-16 md:mb-20">
          <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 backdrop-blur">
            <span className="text-[18px] leading-none">🤖</span>
            <div className="leading-tight">
              <div className="text-[13px] font-bold tracking-tight">AI AGENT</div>
              <div className="font-mono text-[8.5px] font-bold tracking-[0.14em] uppercase text-white/40 mt-0.5">
                AUTONOMOUS SYSTEM
              </div>
            </div>
          </div>
          <span className="font-mono text-[26px] md:text-[28px] text-white/35 font-light leading-none">+</span>
          <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-[#34D399]/10 border border-[#34D399]/40 shadow-[0_0_0_1px_rgba(52,211,153,0.2),0_10px_28px_-8px_rgba(52,211,153,0.4)]">
            <span className="text-[18px] leading-none">◇</span>
            <div className="leading-tight">
              <div className="text-[13px] font-bold tracking-tight">PRIMITIVES</div>
              <div className="font-mono text-[8.5px] font-bold tracking-[0.14em] uppercase text-[#34D399] mt-0.5">
                BY TOKENBOSS
              </div>
            </div>
          </div>
          <span className="font-mono text-[26px] md:text-[28px] text-white/35 font-light leading-none">=</span>
          <span className="text-[40px] md:text-[56px] font-extrabold tracking-tight bg-gradient-to-r from-[#34D399] to-[#5EEAD4] bg-clip-text text-transparent leading-[0.95]">
            PRODUCTIVE.
          </span>
        </div>

        {/* Industry preview grid · placeholder cards in mono terminal style */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <span className="font-mono text-[10.5px] font-bold tracking-[0.16em] uppercase text-white/45">
              ROADMAP · INDUSTRIES
            </span>
            <span className="font-mono text-[10.5px] tracking-[0.06em] text-white/30">
              10 / loading...
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-white/5 border border-white/10 rounded-lg overflow-hidden">
            {INDUSTRIES.map((it) => (
              <div
                key={it.code}
                className="bg-[#0A0807] px-4 py-5 hover:bg-white/[0.03] transition-colors group"
              >
                <div className="font-mono text-[9.5px] font-bold tracking-[0.14em] uppercase text-white/30 mb-2 group-hover:text-[#34D399] transition-colors">
                  {it.code}
                </div>
                <div className="text-[14px] font-semibold text-white/85">{it.cn}</div>
                <div className="font-mono text-[10px] text-white/35 mt-0.5">{it.en}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom signoff */}
        <div className="mt-20 md:mt-28 text-center">
          <div className="font-mono text-[10.5px] font-bold tracking-[0.18em] uppercase text-white/35">
            stay tuned · 敬请期待
          </div>
        </div>
      </main>
    </div>
  );
}

interface Industry {
  code: string;
  cn: string;
  en: string;
}
const INDUSTRIES: Industry[] = [
  { code: 'P-01', cn: '短视频脚本', en: 'short video' },
  { code: 'P-02', cn: '投资研究', en: 'investing' },
  { code: 'P-03', cn: '办公自动化', en: 'office ops' },
  { code: 'P-04', cn: '代码评审', en: 'code review' },
  { code: 'P-05', cn: '客户支持', en: 'support' },
  { code: 'P-06', cn: '数据分析', en: 'analytics' },
  { code: 'P-07', cn: '法律文档', en: 'legal' },
  { code: 'P-08', cn: '教育辅导', en: 'tutoring' },
  { code: 'P-09', cn: '内容运营', en: 'content ops' },
  { code: 'P-10', cn: '招聘筛选', en: 'recruiting' },
];
