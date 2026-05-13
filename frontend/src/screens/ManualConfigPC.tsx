import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TerminalBlock } from '../components/TerminalBlock';
import { AppNav, Breadcrumb } from '../components/AppNav';
import { CompatRow } from '../components/CompatRow';
import { useDocumentMeta } from '../lib/useDocumentMeta';
// RECIPES + AGENTS + shared class-string constants moved into
// `components/AdvancedManualRecipesData.tsx` so the new gh-3
// `AdvancedManualRecipes` disclosure can render the same data without
// duplicating the (large) literal. Helpers (RecipeCard / RecipeStepView
// / CodeBlock) likewise moved into `components/AdvancedManualRecipes.tsx`
// — re-exported from there for re-use here. Layout / TOC / page-level
// concerns still live in this file; Task 7 of the gh-3 plan rewrites
// the layout but doesn't touch the data.
import {
  AGENTS,
  RECIPES,
  cardClass as card,
  codeChipClass as codeChip,
} from '../components/AdvancedManualRecipesData';
import {
  RecipeCard,
  CodeBlock,
} from '../components/AdvancedManualRecipes';

/**
 * Sticky-TOC entries on the PC layout. Order = scroll order top-to-bottom,
 * which means an IntersectionObserver can highlight the active item by
 * picking the topmost intersecting section. `indent` rows nest under the
 * "按 Agent 分项" parent.
 */
interface TocItem {
  id: string;
  label: string;
  indent?: boolean;
}
const TOC_ITEMS: TocItem[] = [
  { id: 'manual', label: '两步通用' },
  { id: 'recipes', label: '按 Agent 分项' },
  { id: 'openclaw', label: 'OpenClaw', indent: true },
  { id: 'hermes', label: 'Hermes Agent', indent: true },
  { id: 'codex', label: 'Codex CLI', indent: true },
  { id: 'openai-compat', label: '其他 OpenAI 兼容', indent: true },
  { id: 'verify', label: '验证接通' },
  { id: 'spell', label: '兜底 · 两行咒语' },
];

// Stable reference for the IntersectionObserver hook below — pulling it
// out of the render avoids re-subscribing every render.
const TOC_IDS = TOC_ITEMS.map((t) => t.id);

export default function ManualConfigPC() {
  useDocumentMeta({
    title: 'TokenBoss 接入手册 · OpenClaw / Hermes / Codex / OpenAI 兼容',
    description:
      '一份手册讲清楚：怎么把 TokenBoss 接到你的 Agent。OpenClaw、Hermes、Codex、Claude Code 全覆盖，配置一次到位。',
    ogImage: 'https://tokenboss.co/og-cover.png',
  });
  // Track which section is currently in view so the TOC can highlight it.
  // Section ids on the dom: spell / manual / recipes / openclaw / hermes /
  // codex / openai-compat / verify — all anchored below.
  const activeId = useActiveSection(TOC_IDS);

  /**
   * Smooth-scroll to a section id, opening it first if it's a <details>.
   * Uses window.scrollTo (not scrollIntoView) so behavior is consistent
   * across embedded preview environments.
   */
  function jumpTo(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === 'DETAILS') (el as HTMLDetailsElement).open = true;
    const top = el.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({ top, behavior: 'smooth' });
  }

  return (
    <div className="min-h-screen bg-bg pb-12">
      <AppNav current="console" />

      <main className="max-w-[1180px] mx-auto px-5 sm:px-9 pt-6">
        {/* Header strip — breadcrumb + label + h1 must NOT repeat the same
            phrase. Users land here because the spell didn't auto-install,
            so the page leads with "manual" framing — the spell falls to
            the bottom as a fallback they can still grab. */}
        <Breadcrumb items={[{ label: '控制台', to: '/console' }, { label: '手动接入' }]} />
        <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[#A89A8D] mb-2 font-bold">
          MANUAL SETUP · 按步骤接通
        </div>
        <h1 className="text-[40px] md:text-[52px] font-bold tracking-tight leading-[1.02] mb-3">
          手动接入 TokenBoss。
        </h1>
        <p className="text-[14px] text-text-secondary mb-9 max-w-[640px] leading-relaxed">
          你的 Agent 不认识"两行咒语"？这里有按工具分的完整步骤——挑你用的那个，跟着做。
          自动接入的两行也放在页面底部，外面没看见的也能在这里取。
        </p>

        {/* PC: 2-col grid (sticky TOC + main content).
            Mobile: TOC hidden — chips inside the manual section + the
            in-page anchor scrolls cover the same ground. */}
        <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-12">
          <aside className="hidden lg:block">
            <div className="sticky top-6">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-3">
                目录
              </div>
              <nav className="border-l-2 border-ink/10 -ml-[2px]">
                {TOC_ITEMS.map((t) => {
                  const isActive = activeId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => jumpTo(t.id)}
                      className={[
                        'w-full text-left block font-mono text-[12px] py-1.5 transition-colors',
                        t.indent ? 'pl-7' : 'pl-3',
                        // Active: thick orange left rule + bold + cream-tinted bg.
                        // Replaces the soft 10% ink rule for the active row.
                        isActive
                          ? 'text-accent border-l-2 border-accent font-bold bg-accent/5'
                          : 'text-text-secondary hover:text-ink border-l-2 border-transparent',
                      ].join(' ')}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </nav>

              <div className="mt-6 pt-4 border-t-2 border-ink/10 font-mono text-[11px] text-[#A89A8D] leading-relaxed">
                配不顺？发{' '}
                <a
                  href="https://tokenboss.co/skill.md"
                  target="_blank"
                  rel="noreferrer"
                  className="text-ink font-bold underline underline-offset-2 decoration-2 hover:text-accent break-all"
                >
                  skill.md
                </a>
                {' '}给 Agent 帮你诊断。
              </div>
            </div>
          </aside>

          {/* Main column — min-w-0 lets long code blocks wrap correctly
              inside the grid cell. */}
          <div className="min-w-0">
            {/* 01 · Manual base — primary content for this page. Users
                land here because their Agent didn't pick up the spell, so
                the per-Agent recipes lead. The spell falls to the bottom
                as a quietly-styled fallback. */}
            <section id="manual" className="mb-10 scroll-mt-20">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-3 flex items-center gap-2">
                <span className="bg-bg-alt text-ink-2 border-2 border-ink rounded px-1.5 py-0.5 tracking-[0.12em]">
                  手动
                </span>
                <span>不识别咒语？两步通用</span>
              </div>

              {/* PC: 2 cols (Key + Base URL side by side, both quick-grab
                  reference cards). Mobile: stack vertically. */}
              <div className="grid gap-3 mb-8 lg:grid-cols-2">
                <div className={`${card} p-5 lg:p-6`}>
                  <Step
                    n="1"
                    title="拿一把 API Key"
                    body={
                      <span>
                        到 <Link to="/console" className="text-accent font-semibold underline underline-offset-2">控制台</Link> 右栏 API KEY 标签旁的 <span className="font-semibold text-ink">+</span>。
                        弹窗里直接 <span className="font-semibold text-ink">复制 API Key</span>；之后回 default 那行点复制图标也能再拿。
                        <span className="block mt-1.5 font-mono text-[11px] text-[#A89A8D]">
                          Key 以 <span className={codeChip}>sk-</span> 开头，形如 <span className={codeChip}>sk-ADrM…aCvC</span>
                        </span>
                      </span>
                    }
                    last
                  />
                </div>
                <div className={`${card} p-5 lg:p-6`}>
                  <Step
                    n="2"
                    title="把 Base URL 指到 TokenBoss"
                    body={
                      <div className="space-y-2">
                        <p>所有支持 OpenAI 兼容协议的 Agent 都通过这个地址走我们：</p>
                        <CodeBlock code="https://api.tokenboss.co/v1" />
                        <p className="font-mono text-[11px] text-[#A89A8D]">
                          OpenClaw / Hermes / Codex / OpenAI SDK 都接得上——下面按 Agent 给完整模板。
                        </p>
                      </div>
                    }
                    last
                  />
                </div>
              </div>

              {/* Per-Agent recipes — anchor + chip jumps + cards. */}
              <div
                id="recipes"
                className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-3 flex items-center gap-2 scroll-mt-20"
              >
                <span>按你的 Agent 选</span>
                <span className="font-mono text-[10px] text-[#A89A8D] font-normal normal-case tracking-normal">点击展开完整步骤</span>
              </div>

              <div className="flex flex-wrap gap-2 mb-4">
                {RECIPES.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => jumpTo(r.id)}
                    className="font-mono text-[12px] text-ink bg-white border-2 border-ink rounded px-2.5 py-1 shadow-[2px_2px_0_0_#1C1917] hover:bg-accent hover:text-white transition-colors"
                  >
                    {r.name}
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                {RECIPES.map((r) => (
                  <RecipeCard key={r.id} recipe={r} />
                ))}
              </div>
            </section>

            {/* 02 · Verify */}
            <section id="verify" className="mb-10 scroll-mt-20">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-3 flex items-center gap-2">
                <span className="bg-cyan-stamp text-cyan-stamp-ink border-2 border-ink rounded px-1.5 py-0.5 tracking-[0.12em]">
                  验证
                </span>
                <span>看是否接通</span>
              </div>
              <div className={`${card} p-6`}>
                <p className="text-[13.5px] text-text-secondary mb-3 leading-relaxed">
                  通用 smoke test——配完之后在终端跑一下，看 base URL 能不能访问、key 是否生效：
                </p>
                <CodeBlock
                  code={'curl -H "Authorization: Bearer <你的 key>" \\\n     https://api.tokenboss.co/v1/models'}
                />
                <p className="font-mono text-[11px] text-[#A89A8D] mt-3">
                  返回带 model 列表的 JSON 即接通成功。回到 <Link to="/console" className="text-accent font-semibold underline underline-offset-2">控制台</Link> 会看到第一条调用记录。
                </p>
              </div>
            </section>

            {/* 03 · Spell fallback — for users who didn't see the spell
                on /console or somewhere else. De-emphasized: muted "兜底"
                stamp instead of green "推荐", tighter copy, smaller card.
                Sits at the bottom because this page's primary job is the
                manual recipe above. */}
            <section id="spell" className="mb-12 scroll-mt-20">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-3 flex items-center gap-2">
                <span className="bg-bg-alt text-ink-2 border-2 border-ink rounded px-1.5 py-0.5 tracking-[0.12em]">
                  兜底
                </span>
                <span>自动接入 · 两行咒语</span>
              </div>
              <div className={`${card} p-6`}>
                <p className="text-[13px] text-text-secondary mb-4 leading-relaxed max-w-[680px]">
                  你的 Agent 听得懂自然语言？粘这两行让它自己拉 <span className={codeChip}>skill.md</span> 装好，能跳过上面那一长串手动步骤。
                </p>
                <TerminalBlock
                  cmd="set up tokenboss.co/skill.md"
                  extra="TOKENBOSS_API_KEY=<你的 TokenBoss key>"
                  size="lg"
                />
                <CompatRow label="已支持" agents={AGENTS} className="mt-5" />
              </div>
            </section>

            {/* Mobile-only footer help — PC has the same line in the TOC. */}
            <div className="mt-10 lg:hidden font-mono text-[11.5px] text-ink-3 max-w-[560px] leading-relaxed">
              配置不顺？发 <span className={codeChip}>tokenboss.co/skill.md</span> 给你的 Agent，让它读完整 spec 帮你诊断；
              或回到 <Link to="/console" className="text-accent font-semibold underline underline-offset-2">控制台</Link> 看是否已有调用记录。
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Step({
  n,
  title,
  body,
  last = false,
}: {
  n: string;
  title: string;
  body: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`flex items-start gap-4 ${last ? '' : 'pb-5 border-b-2 border-ink/10'}`}>
      <span className="w-8 h-8 flex-shrink-0 bg-ink text-bg border-2 border-ink rounded-md font-mono text-[14px] font-bold flex items-center justify-center shadow-[2px_2px_0_0_#1C1917]/30 mt-0.5">
        {n}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-bold text-ink mb-2 leading-snug">{title}</div>
        <div className="text-[13.5px] text-text-secondary leading-relaxed">{body}</div>
      </div>
    </div>
  );
}


/**
 * Tracks which section id is currently in view. The IntersectionObserver
 * config (rootMargin -25% top / -65% bottom) fires when a section's top
 * crosses the upper quarter of the viewport — feels right for a docs page
 * where the current heading should already be near the top of the screen.
 *
 * Returns the topmost intersecting id; updates as the user scrolls.
 */
function useActiveSection(ids: string[]): string | undefined {
  const [activeId, setActiveId] = useState<string | undefined>();

  useEffect(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-25% 0px -65% 0px', threshold: [0, 0.5, 1] },
    );

    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [ids]);

  return activeId;
}
