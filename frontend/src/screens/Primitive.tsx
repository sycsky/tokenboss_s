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

        {/* The unfolding equation — one-directional 8s cycle.
            empty → Agent appears → bar fills to 及格 (60%) → State A held →
            + Primitive enters with "Powered by TokenBoss" credit →
            bar shoots to 优秀 (100%) → State B held → fade out → loop.
            No reverse motion: the message is a build-up. */}
        <div className="eq-card bg-surface-warm border-2 border-ink rounded-md shadow-[5px_5px_0_0_#1C1917] p-6 md:p-9 mb-10 md:mb-12">
          <div className="eq-row flex items-center gap-2.5 md:gap-4 flex-wrap text-[26px] md:text-[40px] font-extrabold tracking-tight leading-none">
            <span className="eq-agent">
              <Chip>Agent</Chip>
            </span>

            {/* "+ Primitive" group. eq-boss collapses to zero width in
                State A via overflow-hidden + max-width 0. The credit
                lives OUTSIDE eq-boss (sibling) so its width isn't
                clipped — it's positioned absolutely against the
                relative outer wrapper, which sizes to eq-boss's content. */}
            <span className="eq-boss-anchor relative inline-flex items-baseline">
              <span className="eq-boss inline-flex items-center gap-2.5 md:gap-4 overflow-hidden whitespace-nowrap">
                <Op>+</Op>
                <ChipFeatured>Primitive</ChipFeatured>
              </span>
              <span className="eq-credit absolute left-1/2 -translate-x-1/2 top-full mt-2 whitespace-nowrap font-mono text-[9px] md:text-[10px] font-bold tracking-[0.14em] uppercase text-accent">
                Powered by TokenBoss
              </span>
            </span>

            <span className="eq-equals"><Op>=</Op></span>

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

          {/* Energy bar — track + 及格 tick + 优秀 tick + animated fill */}
          <div className="mt-9 md:mt-10">
            <div className="relative h-3 bg-bg border-2 border-ink rounded-sm overflow-hidden">
              {/* Passing line at 60% */}
              <div className="absolute inset-y-0 left-[60%] w-[2px] bg-ink/35" aria-hidden="true" />
              {/* Fill */}
              <div className="eq-bar-fill absolute inset-y-0 left-0 bg-accent border-r-2 border-ink" />
            </div>

            {/* Tick labels — 及格 (60%) and 优秀 (100%), both static */}
            <div className="relative mt-2 h-4">
              <span className="absolute left-[60%] -translate-x-1/2 font-mono text-[10px] font-bold tracking-[0.14em] uppercase text-ink-3">
                及格
              </span>
              <span className="absolute right-0 font-mono text-[10px] font-bold tracking-[0.14em] uppercase text-ink-3">
                优秀
              </span>
            </div>
          </div>
        </div>

        <div className="mb-20 md:mb-24" />

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

      {/* Equation cycle — pure CSS, 8s, one-directional (no reverse).
          Beats:
            0–10%   card fades in, contents start invisible (empty)
            10–22%  Agent chip fades in
            22–32%  "= Powerful." fades in, bar fills 0 → 60% (及格)
            32–50%  Hold A · Agent = Powerful · bar at 及格
            50–58%  + Primitive slides in, "Powered by TokenBoss" credit
                    fades in under it, Powerful → Productive flip starts
            58–72%  bar fills 60 → 100% (优秀), answer settled on Productive
            72–90%  Hold B · Agent + Primitive = Productive · bar at 优秀
            90–100% card fades out (parent opacity 1 → 0). All width/transform
                    snap-resets at the cycle boundary happen while the card
                    is invisible, so the user never sees a reverse motion.
          prefers-reduced-motion: pins to State B static. */}
      <style>{`
        .eq-card {
          animation: eq-card 8s ease-in-out infinite;
          opacity: 0;
        }
        @keyframes eq-card {
          0%, 8%    { opacity: 0; }
          12%, 90%  { opacity: 1; }
          100%      { opacity: 0; }
        }

        .eq-agent, .eq-equals {
          opacity: 0;
          animation: eq-agent 8s ease-in-out infinite;
        }
        .eq-equals { animation-name: eq-equals; }
        @keyframes eq-agent {
          0%, 10%   { opacity: 0; transform: translateY(2px); }
          22%, 100% { opacity: 1; transform: translateY(0);   }
        }
        @keyframes eq-equals {
          0%, 18%   { opacity: 0; }
          28%, 100% { opacity: 1; }
        }

        .eq-boss {
          max-width: 0;
          opacity: 0;
          margin-left: 0;
          animation: eq-boss 8s ease-in-out infinite;
        }
        @keyframes eq-boss {
          0%, 50%   { max-width: 0;     opacity: 0; margin-left: 0;        }
          58%, 100% { max-width: 380px; opacity: 1; margin-left: 0.625rem; }
        }

        .eq-credit {
          opacity: 0;
          transform: translateY(-3px);
          animation: eq-credit 8s ease-in-out infinite;
        }
        @keyframes eq-credit {
          0%, 52%   { opacity: 0; transform: translateY(-3px); }
          62%, 100% { opacity: 1; transform: translateY(0);    }
        }

        .eq-powerful {
          opacity: 0;
          animation: eq-powerful 8s ease-in-out infinite;
        }
        @keyframes eq-powerful {
          0%, 18%   { opacity: 0; }
          28%, 50%  { opacity: 1; }
          60%, 100% { opacity: 0; }
        }

        .eq-productive {
          opacity: 0;
          animation: eq-productive 8s ease-in-out infinite;
        }
        @keyframes eq-productive {
          0%, 50%   { opacity: 0; }
          62%, 100% { opacity: 1; }
        }

        .eq-bar-fill {
          width: 0%;
          animation: eq-bar-fill 8s ease-in-out infinite;
        }
        @keyframes eq-bar-fill {
          0%, 18%   { width: 0%;   }
          32%, 50%  { width: 60%;  }
          72%, 100% { width: 100%; }
        }

        @media (prefers-reduced-motion: reduce) {
          .eq-card       { animation: none; opacity: 1; }
          .eq-agent      { animation: none; opacity: 1; transform: none; }
          .eq-equals     { animation: none; opacity: 1; }
          .eq-boss       { animation: none; max-width: 380px; opacity: 1; margin-left: 0.625rem; }
          .eq-credit     { animation: none; opacity: 1; transform: none; }
          .eq-powerful   { animation: none; opacity: 0; }
          .eq-productive { animation: none; opacity: 1; }
          .eq-bar-fill   { animation: none; width: 100%; }
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
