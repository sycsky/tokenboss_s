import { TopNav } from '../components/TopNav';

/**
 * Primitive layer · v2 preview page.
 *
 * Light Slock-pixel theme (post-2026-04-27 unification): same bg-bg /
 * ink / accent system as the rest of the site, no more dark variant.
 * The "this is the future" weight comes from copy and the contrast
 * equation, not from inverting the theme.
 *
 * Hero stacks two contrasting equations:
 *   今天        · Agent + LLM       = Powerful.   (muted, italic)
 *   接入 TokenBoss · Agent + TokenBoss = Productive. (accent, bold)
 *
 * Rationale: an Agent + a model is technically capable but doesn't
 * automatically translate to value. TokenBoss closes that gap (wallet,
 * routing, primitives in v2). The page is a flag-planted teaser for
 * v2; keep it lightweight on copy, heavy on visual contrast.
 */
export default function Primitive() {
  return (
    <div className="min-h-screen bg-bg">
      <TopNav current="primitive" />

      <main className="relative max-w-[1100px] mx-auto px-6 md:px-14 pt-12 md:pt-16 pb-20 md:pb-28">
        {/* Status pill — coming soon */}
        <div className="flex items-center gap-2 mb-7">
          <span className="relative flex w-2.5 h-2.5">
            <span className="absolute inset-0 rounded-full bg-lime-stamp animate-ping opacity-75" />
            <span className="relative w-2.5 h-2.5 rounded-full bg-lime-stamp border-2 border-ink" />
          </span>
          <span className="font-mono text-[10.5px] font-bold tracking-[0.18em] uppercase text-ink-3">
            v2 · Coming Soon · 即将发布
          </span>
        </div>

        {/* Hero h1 + subtitle */}
        <h1 className="font-sans text-[72px] md:text-[108px] lg:text-[128px] font-extrabold leading-[0.95] tracking-tight text-ink mb-4">
          Primitives.
        </h1>
        <p className="text-[15px] md:text-[18px] text-ink-2 max-w-xl leading-relaxed mb-12 md:mb-16">
          让 Agent 真正解决问题。
          <br className="hidden md:block" />
          <span className="text-ink-3">
            把 LLM、Skill、第三方 API 打包成一个个原子化的能力——即装即用。
          </span>
        </p>

        {/* The contrast equations — stacked, top muted, bottom amplified */}
        <div className="space-y-5 mb-20 md:mb-24">
          {/* Top · 今天 */}
          <div className="bg-surface border-2 border-ink rounded-md p-5 md:p-6 opacity-70">
            <div className="font-mono text-[10px] font-bold tracking-[0.18em] uppercase text-ink-3 mb-3">
              今天 · TODAY
            </div>
            <div className="flex items-center gap-2.5 md:gap-4 flex-wrap text-[22px] md:text-[30px] font-bold tracking-tight">
              <Chip>Agent</Chip>
              <Op>+</Op>
              <Chip>LLM</Chip>
              <Op>=</Op>
              <span className="font-sans text-ink-2 italic">Powerful.</span>
            </div>
          </div>

          {/* Bottom · 接入 TokenBoss — full Slock-pixel + hard offset */}
          <div className="bg-surface-warm border-2 border-ink rounded-md shadow-[5px_5px_0_0_#1C1917] p-5 md:p-7">
            <div className="font-mono text-[10px] font-bold tracking-[0.18em] uppercase text-accent mb-3">
              接入 TokenBoss · WITH US
            </div>
            <div className="flex items-center gap-2.5 md:gap-4 flex-wrap text-[26px] md:text-[40px] font-extrabold tracking-tight leading-none">
              <Chip>Agent</Chip>
              <Op>+</Op>
              <ChipFeatured>TokenBoss</ChipFeatured>
              <Op>=</Op>
              <span className="font-sans text-accent">Productive.</span>
            </div>
            <div className="mt-4 font-mono text-[11px] text-ink-3 leading-relaxed">
              钱包 · 路由 · 共享额度（v1）<span className="text-ink-4 mx-1.5">+</span> 原子化能力（v2）
            </div>
          </div>
        </div>

        {/* Industries roadmap — light Slock-pixel grid */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <span className="font-mono text-[10.5px] font-bold tracking-[0.16em] uppercase text-ink-3">
              ROADMAP · INDUSTRIES
            </span>
            <span className="font-mono text-[10.5px] tracking-[0.06em] text-ink-4">
              10 / loading…
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 border-2 border-ink rounded-md overflow-hidden bg-ink/10">
            {INDUSTRIES.map((it, i) => {
              const colInRow5 = i % 5;
              const isLastCol = colInRow5 === 4;
              const isLastRow = i >= INDUSTRIES.length - 5;
              return (
                <div
                  key={it.code}
                  className={
                    'bg-surface px-4 py-5 group transition-colors hover:bg-bg-alt ' +
                    (isLastCol ? '' : 'md:border-r-2 md:border-ink/15 ') +
                    (isLastRow ? '' : 'border-b-2 border-ink/15')
                  }
                >
                  <div className="font-mono text-[9.5px] font-bold tracking-[0.14em] uppercase text-ink-3 mb-2 group-hover:text-accent transition-colors">
                    {it.code}
                  </div>
                  <div className="text-[14px] font-semibold text-ink">{it.cn}</div>
                  <div className="font-mono text-[10px] text-ink-3 mt-0.5">{it.en}</div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Sign-off */}
        <div className="mt-16 md:mt-24 text-center">
          <div className="font-mono text-[10.5px] font-bold tracking-[0.18em] uppercase text-ink-3">
            stay tuned · 敬请期待
          </div>
        </div>
      </main>
    </div>
  );
}

/* — equation primitives — */

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-3 py-1 bg-bg border-2 border-ink rounded font-sans tracking-tight">
      {children}
    </span>
  );
}

function ChipFeatured({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-3 py-1 bg-accent text-white border-2 border-ink rounded font-sans tracking-tight shadow-[2px_2px_0_0_#1C1917]">
      {children}
    </span>
  );
}

function Op({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-ink-3 font-medium leading-none">{children}</span>;
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
