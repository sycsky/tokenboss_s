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

        {/* The morphing equation — loops between two states.
            State A: Agent = Powerful.  (capability)
            State B: Agent + TokenBoss = Productive.  (value)
            Motion is the argument — capability ≠ value, TokenBoss
            closes the gap. Opt-out for prefers-reduced-motion in CSS. */}
        <div className="bg-surface-warm border-2 border-ink rounded-md shadow-[5px_5px_0_0_#1C1917] p-6 md:p-9 mb-10 md:mb-12">
          <div className="eq-row flex items-center gap-2.5 md:gap-4 flex-wrap text-[26px] md:text-[40px] font-extrabold tracking-tight leading-none">
            <Chip>Agent</Chip>

            {/* "+ TokenBoss" — collapses to zero width in State A */}
            <span className="eq-boss inline-flex items-center gap-2.5 md:gap-4 overflow-hidden whitespace-nowrap">
              <Op>+</Op>
              <ChipFeatured>TokenBoss</ChipFeatured>
            </span>

            <Op>=</Op>

            {/* Answer slot — two states stacked, opacity swaps in sync with the chip morph */}
            <span className="eq-answer relative inline-block leading-none">
              {/* State B sets the slot width (it's the longer string). */}
              <span className="invisible" aria-hidden="true">Productive.</span>
              <span className="eq-powerful absolute inset-0 font-sans text-ink-2 italic">
                Powerful.
              </span>
              <span className="eq-productive absolute inset-0 font-sans text-accent">
                Productive.
              </span>
            </span>
          </div>
        </div>

        {/* What "TokenBoss" actually means — anchors the chip in real capabilities. */}
        <div className="font-mono text-[11.5px] text-ink-3 leading-relaxed mb-20 md:mb-24">
          <span className="text-ink-4 mr-2">v1</span>钱包 · 路由 · 共享额度
          <span className="mx-3 text-ink-4">+</span>
          <span className="text-ink-4 mr-2">v2</span>原子化能力（Primitives）
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

      {/* Equation morph keyframes — pure CSS, 7s loop.
          0–14%   Powerful (hold)
          14–28%  morph: + TokenBoss slides in, answer Powerful → Productive
          28–71%  Productive (hold — the message)
          71–86%  morph back: + TokenBoss slides out, answer reverts
          86–100% Powerful (hold)
          Honors prefers-reduced-motion: pin to State B static. */}
      <style>{`
        .eq-boss {
          max-width: 0;
          opacity: 0;
          transform: translateX(-8px);
          margin-left: 0;
          animation: eq-boss 7s ease-in-out infinite;
        }
        @keyframes eq-boss {
          0%, 14%   { max-width: 0;     opacity: 0; transform: translateX(-8px); margin-left: 0;        }
          28%, 71%  { max-width: 360px; opacity: 1; transform: translateX(0);    margin-left: 0.625rem; }
          86%, 100% { max-width: 0;     opacity: 0; transform: translateX(-8px); margin-left: 0;        }
        }
        .eq-powerful   { animation: eq-powerful   7s ease-in-out infinite; }
        .eq-productive { animation: eq-productive 7s ease-in-out infinite; opacity: 0; }
        @keyframes eq-powerful {
          0%, 14%   { opacity: 1; transform: translateY(0);   }
          22%, 78%  { opacity: 0; transform: translateY(-4px); }
          86%, 100% { opacity: 1; transform: translateY(0);   }
        }
        @keyframes eq-productive {
          0%, 18%   { opacity: 0; transform: translateY(4px); }
          28%, 71%  { opacity: 1; transform: translateY(0);   }
          82%, 100% { opacity: 0; transform: translateY(4px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .eq-boss       { animation: none; max-width: 360px; opacity: 1; transform: none; margin-left: 0.625rem; }
          .eq-powerful   { animation: none; opacity: 0; }
          .eq-productive { animation: none; opacity: 1; transform: none; }
        }
      `}</style>
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
