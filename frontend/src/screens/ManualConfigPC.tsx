import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TerminalBlock } from '../components/TerminalBlock';
import { AppNav, Breadcrumb } from '../components/AppNav';
import { CompatRow, type AgentMark } from '../components/CompatRow';
import openClawIcon from '../assets/agents/openclaw.svg';
import hermesIcon from '../assets/agents/hermes.png';

const AGENTS: AgentMark[] = [
  {
    id: 'oc',
    name: 'OpenClaw',
    className: 'bg-[#0A0807] p-1',
    icon: <img src={openClawIcon} alt="" className="w-full h-full" style={{ imageRendering: 'pixelated' }} />,
  },
  {
    id: 'hm',
    name: 'Hermes Agent',
    className: 'bg-white p-0',
    icon: <img src={hermesIcon} alt="" className="w-full h-full object-cover rounded-lg" />,
  },
];

const card = 'bg-white border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917]';
// inline-block + whitespace-nowrap so a chip stays one unbroken token —
// `break-all` (the previous setting) split short tokens like `apiKey` mid-
// word and rendered the chip's border across two lines, looking broken.
const codeChip =
  'inline-block align-baseline font-mono text-[12px] text-ink bg-bg border-2 border-ink rounded px-2 py-0.5 whitespace-nowrap';
const codeBlock =
  'font-mono text-[12.5px] text-ink bg-bg border-2 border-ink rounded p-3 ' +
  // `whitespace-pre-wrap` keeps newlines + leading indent in multi-line
  // snippets (curl with `\` continuation, JSON config, Python init, etc.)
  // while still wrapping long single lines.
  'whitespace-pre-wrap break-all leading-relaxed';

/**
 * Per-Agent recipe — full install → configure → verify flow, modeled after
 * the per-tool subpages in vendor docs (Aliyun Bailian, Volcengine Ark).
 * Each Agent gets its own ordered step list so a cold reader who hasn't
 * even installed the tool can follow it end-to-end. All snippets reference
 * the OpenAI-Chat-Completions endpoint at /v1/chat/completions — the only
 * one the backend actually serves.
 *
 * Key format: TokenBoss keys are `sk-` prefix + 48 chars (total ~51), see
 * `backend/src/lib/newapi.ts` where `sk-` is force-prepended on reveal.
 */
interface RecipeStep {
  /** "1. 安装" / "2. 编辑配置" — visually a numbered milestone. */
  title: string;
  /** Short prose under the title. ReactNode so we can inline `codeChip` spans. */
  desc?: React.ReactNode;
  /** File path or shell label rendered above the code block. */
  codeLabel?: string;
  /** The code/config block itself. Multi-line OK. */
  code?: string;
}

interface AgentRecipe {
  id: string;
  name: string;
  /** Tool homepage — rendered as a small link in the card header. */
  homepage?: string;
  /** One-line positioning under the name; helps a stranger pick the right card. */
  blurb: string;
  /** Ordered steps. Keep the count low (3–4) so the card stays scannable. */
  steps: RecipeStep[];
  /** Final smoke-test command + what success looks like. */
  verify: { code: string; desc: string };
}

const RECIPES: AgentRecipe[] = [
  {
    id: 'openclaw',
    name: 'OpenClaw',
    homepage: 'https://openclaw.ai',
    blurb: '本地 Agent + Gateway，一条命令安装、Web 控制台',
    steps: [
      {
        title: '1. 安装 OpenClaw',
        desc: <>macOS / Linux 一键脚本——自动装依赖、装 daemon、走 onboarding。已装可跳过。</>,
        codeLabel: '终端',
        code: 'curl -fsSL https://openclaw.ai/install.sh | bash',
      },
      {
        title: '2. 编辑配置文件',
        desc: <>把下面的 JSON merge 进 <span className={codeChip}>~/.openclaw/openclaw.json</span>。已有的 <span className={codeChip}>models.providers</span> / <span className={codeChip}>agents.defaults</span> 节点保留，只覆盖 <span className={codeChip}>tokenboss</span> 这把 key。把 <span className={codeChip}>{'<你的 TokenBoss key>'}</span> 换成 <Link to="/console" className="text-accent font-semibold underline underline-offset-2">控制台</Link> 复制的那串字符。</>,
        codeLabel: '~/.openclaw/openclaw.json',
        code: `{
  "models": {
    "providers": {
      "tokenboss": {
        "baseUrl": "https://api.tokenboss.co/v1",
        "api": "openai-completions",
        "apiKey": "<你的 TokenBoss key>",
        "models": [
          { "id": "gpt-5.5",            "name": "GPT 5.5" },
          { "id": "gpt-5.4",            "name": "GPT 5.4" },
          { "id": "gpt-5.4-mini",       "name": "GPT 5.4 Mini" },
          { "id": "claude-opus-4-7",    "name": "Claude Opus 4.7" },
          { "id": "claude-opus-4-6",    "name": "Claude Opus 4.6" },
          { "id": "claude-sonnet-4-6",  "name": "Claude Sonnet 4.6" }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "tokenboss/gpt-5.5",
        "fallbacks": [
          "tokenboss/gpt-5.4",
          "tokenboss/gpt-5.4-mini",
          "tokenboss/claude-opus-4-7",
          "tokenboss/claude-opus-4-6",
          "tokenboss/claude-sonnet-4-6"
        ]
      }
    }
  }
}`,
      },
      {
        title: '3. 重载 Gateway',
        desc: '保存后 OpenClaw 一般自动 reload。不放心就手动重启一次：',
        codeLabel: '终端',
        code: 'openclaw gateway restart',
      },
    ],
    verify: {
      code: 'openclaw models list | grep tokenboss',
      desc: '能看到 tokenboss/gpt-5.5 等 6 行 → 配置已生效。回控制台刷新会出现第一条调用记录。',
    },
  },
  {
    id: 'hermes',
    name: 'Hermes Agent',
    homepage: 'https://hermes-agent.nousresearch.com',
    blurb: 'Nous Research 出品的本地 Agent，TUI / CLI 双形态',
    steps: [
      {
        title: '1. 安装 Hermes',
        desc: <>macOS / Linux / WSL2 一键脚本。已装跳过。</>,
        codeLabel: '终端',
        code: `curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
source ~/.zshrc   # 或 source ~/.bashrc`,
      },
      {
        title: '2. 编辑配置文件',
        desc: <>把下面两块写到 <span className={codeChip}>~/.hermes/config.yaml</span> 顶层（已有的 <span className={codeChip}>providers</span> / <span className={codeChip}>toolsets</span> 等节点不要动）。Hermes 当前每会话只支持 <strong>一个</strong> fallback，这里默认让它跌回 <span className={codeChip}>gpt-5.4</span>。</>,
        codeLabel: '~/.hermes/config.yaml',
        code: `model:
  default: gpt-5.5
  provider: custom
  base_url: https://api.tokenboss.co/v1
  api_mode: chat_completions
  key_env: TOKENBOSS_API_KEY

fallback_model:
  provider: custom
  model: gpt-5.4
  base_url: https://api.tokenboss.co/v1
  key_env: TOKENBOSS_API_KEY`,
      },
      {
        title: '3. 写 API Key 到 .env',
        desc: <>Hermes 从这里读 <span className={codeChip}>TOKENBOSS_API_KEY</span>。如果 <span className={codeChip}>~/.hermes/.env</span> 在 git 跟踪范围内，先把 <span className={codeChip}>.env</span> 加进 <span className={codeChip}>.gitignore</span> 再写。</>,
        codeLabel: '终端',
        code: 'echo \'TOKENBOSS_API_KEY=<你的 TokenBoss key>\' >> ~/.hermes/.env',
      },
    ],
    verify: {
      code: 'hermes model',
      desc: '显示 custom / gpt-5.5 / api.tokenboss.co/v1 即生效。再 hermes 启动跑一句对话，控制台会出现首条调用。',
    },
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    homepage: 'https://github.com/openai/codex',
    blurb: 'OpenAI 官方 CLI，TOML 配置 + 环境变量，wire_api = chat',
    steps: [
      {
        title: '1. 安装 Codex',
        desc: <>需要 Node.js 18+。已装可跳过。</>,
        codeLabel: '终端',
        code: 'npm install -g @openai/codex',
      },
      {
        title: '2. 编辑配置文件',
        desc: <>把下面这段写到 <span className={codeChip}>~/.codex/config.toml</span>（TOML 格式，注意不是 JSON）。已有的别的 <span className={codeChip}>[model_providers.*]</span> 表保留，只新增 <span className={codeChip}>tokenboss</span> 这一表 + 修改顶层两行。</>,
        codeLabel: '~/.codex/config.toml',
        code: `model_provider = "tokenboss"
model = "gpt-5.5"

[model_providers.tokenboss]
name = "TokenBoss"
base_url = "https://api.tokenboss.co/v1"
env_key = "OPENAI_API_KEY"
wire_api = "chat"`,
      },
      {
        title: '3. 设置 OPENAI_API_KEY',
        desc: <>Codex 从 <span className={codeChip}>OPENAI_API_KEY</span> 读 key（即使你的 key 是 TokenBoss 的）。写到 shell profile 让每次开终端都生效。</>,
        codeLabel: '终端',
        code: `echo 'export OPENAI_API_KEY=<你的 TokenBoss key>' >> ~/.zshrc   # 或 ~/.bashrc
source ~/.zshrc`,
      },
    ],
    verify: {
      code: 'codex',
      desc: '启动后跑一句 "ping" — 拿到回应就接通了。控制台 /console 会出现首条调用。',
    },
  },
  {
    id: 'openai-compat',
    name: '其他 OpenAI 兼容',
    blurb: 'Cherry Studio / Chatbox / LobeChat / OpenAI SDK 等 — 任何能填自定义 OpenAI endpoint 的工具',
    steps: [
      {
        title: '1. 找到"自定义 OpenAI Endpoint"设置',
        desc: <>不同客户端入口不同：Cherry Studio / Chatbox 在<strong>设置 → 模型服务 → 添加自定义</strong>；OpenAI SDK 在初始化时传 <span className={codeChip}>baseURL</span> + <span className={codeChip}>apiKey</span>。</>,
      },
      {
        title: '2. 填这四个字段',
        codeLabel: '通用配置',
        code: `Base URL:    https://api.tokenboss.co/v1
API Key:     <你的 TokenBoss key>
Auth header: Authorization: Bearer <你的 TokenBoss key>
Models:      gpt-5.5 · gpt-5.4 · gpt-5.4-mini
             claude-opus-4-7 · claude-opus-4-6 · claude-sonnet-4-6`,
      },
      {
        title: '3. 选一个模型保存',
        desc: <>所有 6 个模型走的都是同一个 endpoint + 同一把 key，请求 body 里 <span className={codeChip}>"model"</span> 字段填哪个就用哪个。</>,
      },
    ],
    verify: {
      code: 'curl -H "Authorization: Bearer <key>" https://api.tokenboss.co/v1/models',
      desc: '返回 JSON 里能看到上面 6 个 model id 即接通。客户端里发条消息，控制台会出现首条调用。',
    },
  },
];

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

function RecipeCard({ recipe }: { recipe: AgentRecipe }) {
  // Named group (`group/recipe`) so the chevron's `group-open:` doesn't
  // bleed into nested `.group` wrappers (e.g. CodeBlock's hover-reveal).
  return (
    <details id={recipe.id} className={`${card} group/recipe scroll-mt-20`}>
      <summary className="flex items-center justify-between gap-3 px-5 py-4 cursor-pointer list-none hover:bg-bg-alt/40 transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-bold text-ink">{recipe.name}</span>
            {recipe.homepage && (
              <a
                href={recipe.homepage}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="font-mono text-[10px] text-[#A89A8D] hover:text-accent"
                aria-label={`${recipe.name} 官网`}
              >
                ↗
              </a>
            )}
          </div>
          <div className="font-mono text-[11.5px] text-[#A89A8D] mt-1 truncate">
            {recipe.blurb}
          </div>
        </div>
        <span
          aria-hidden="true"
          className="font-mono text-[11px] text-[#A89A8D] flex-shrink-0 transition-transform group-open/recipe:rotate-180"
        >
          ▾
        </span>
      </summary>

      <div className="px-5 pb-6 pt-2">
        <ol className="m-0 p-0">
          {recipe.steps.map((s, i) => (
            <RecipeStepView
              key={i}
              step={s}
              n={i + 1}
              last={i === recipe.steps.length - 1}
            />
          ))}
        </ol>

        {/* Verify — capstone with cyan stamp + cyan-edged code block, makes
            "did it work?" feel like the natural payoff of the recipe. */}
        <div className="border-t-2 border-ink/10 pt-4 mt-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-2 flex items-center gap-2">
            <span className="bg-cyan-stamp text-cyan-stamp-ink border-2 border-ink rounded px-1.5 py-0.5 tracking-[0.12em]">
              验证
            </span>
            <span>检查接通</span>
          </div>
          <CodeBlock code={recipe.verify.code} />
          <p className="text-[12.5px] text-text-secondary mt-2 leading-relaxed">
            {recipe.verify.desc}
          </p>
        </div>
      </div>
    </details>
  );
}

function RecipeStepView({
  step,
  n,
  last,
}: {
  step: RecipeStep;
  n: number;
  last: boolean;
}) {
  // The data writes titles as "1. xxx" / "2. xxx" — strip the prefix
  // since the numbered badge below now owns the numbering visually.
  const title = step.title.replace(/^\d+\.\s*/, '');

  return (
    <li className="relative pl-10 pb-6 last:pb-0 list-none">
      {/* Numbered badge — same Slock-pixel ink-on-bg block used elsewhere. */}
      <span className="absolute left-0 top-0 w-7 h-7 bg-ink text-bg border-2 border-ink rounded-md font-mono text-[12px] font-bold flex items-center justify-center shadow-[2px_2px_0_0_rgba(28,25,23,0.3)]">
        {n}
      </span>
      {/* Timeline line down to the next step — soft ink rule.
          Hidden on the last step so the rule doesn't run into the verify divider. */}
      {!last && (
        <span
          aria-hidden="true"
          className="absolute left-[13px] top-8 w-0.5 h-[calc(100%-16px)] bg-ink/15"
        />
      )}

      <div>
        <div className="text-[14.5px] font-bold text-ink mb-1.5 leading-snug">
          {title}
        </div>
        {step.desc && (
          <div className="text-[13px] text-text-secondary mb-2.5 leading-relaxed">
            {step.desc}
          </div>
        )}
        {step.code && <CodeBlock code={step.code} label={step.codeLabel} />}
      </div>
    </li>
  );
}

/**
 * One-shot copy-to-clipboard code block. The COPY button is hidden by
 * default and revealed on hover (or keyboard focus, for a11y). After a
 * successful copy it flips to "COPIED ✓" in green for 1.5s, then resets.
 *
 * Why a button reveal-on-hover rather than always-on: code blocks are
 * dense reading targets and an always-visible button competes with the
 * code itself for attention. Hover-reveal keeps the resting state clean.
 */
function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — fail silently.
    }
  }

  return (
    <div>
      {label && (
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#A89A8D] mb-1">
          {label}
        </div>
      )}
      <div className="relative group/copy">
        <div className={codeBlock}>{code}</div>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? '已复制' : '复制代码'}
          className={[
            'absolute top-2 right-2 font-mono text-[10px] uppercase tracking-wider px-2 py-1',
            'border-2 rounded transition-all duration-150',
            // Named group so a hover here only reveals THIS COPY button —
            // not every COPY inside the surrounding RecipeCard `<details>`.
            'opacity-0 group-hover/copy:opacity-100 focus-visible:opacity-100',
            copied
              ? 'bg-[#16A34A] text-white border-[#16A34A] shadow-[2px_2px_0_0_rgba(22,163,74,0.3)]'
              : 'bg-white text-ink border-ink shadow-[2px_2px_0_0_#1C1917] hover:bg-accent hover:text-white active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_0_#1C1917]',
          ].join(' ')}
        >
          {copied ? 'COPIED ✓' : 'COPY'}
        </button>
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
