import { Link } from 'react-router-dom';
import { TerminalBlock } from '../components/TerminalBlock';
import { AppNav } from '../components/AppNav';
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
const codeChip =
  'font-mono text-[12px] text-ink bg-bg border-2 border-ink rounded px-2 py-0.5 break-all';
const codeBlock =
  'font-mono text-[12.5px] text-ink bg-bg border-2 border-ink rounded p-3 ' +
  // `whitespace-pre-wrap` keeps newlines + leading indent in multi-line
  // snippets (curl with `\` continuation, JSON config, Python init, etc.)
  // while still wrapping long single lines.
  'whitespace-pre-wrap break-all leading-relaxed';

/**
 * Per-Agent recipe entry — name, where to put the config, the actual snippet
 * to paste. Snippets reference the OpenAI-compatible endpoint (the only one
 * the backend serves at /v1/chat/completions). Keys are 48-char raw tokens
 * with no `tb_live_` / `sk-` prefix — that's what /console actually shows.
 */
interface AgentRecipe {
  id: string;
  name: string;
  where: string;
  snippet: string;
  language?: 'json' | 'shell' | 'python';
}

const RECIPES: AgentRecipe[] = [
  {
    id: 'openclaw',
    name: 'OpenClaw',
    where: '设置 → 模型供应商 → 自定义 OpenAI 兼容',
    snippet: `Base URL:    https://api.tokenboss.co/v1
API Key:     <你的 TokenBoss key>
Model:       gpt-5.5`,
  },
  {
    id: 'hermes',
    name: 'Hermes Agent',
    where: '环境变量（在 shell rc 里 export，或一次性放在前面）',
    snippet: `export OPENAI_BASE_URL=https://api.tokenboss.co/v1
export OPENAI_API_KEY=<你的 TokenBoss key>`,
    language: 'shell',
  },
  {
    id: 'sdk-python',
    name: 'OpenAI SDK (Python)',
    where: '初始化 client 时传 base_url + api_key',
    snippet: `from openai import OpenAI

client = OpenAI(
    base_url="https://api.tokenboss.co/v1",
    api_key="<你的 TokenBoss key>",
)`,
    language: 'python',
  },
  {
    id: 'sdk-node',
    name: 'OpenAI SDK (Node.js)',
    where: '初始化 client 时传 baseURL + apiKey',
    snippet: `import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://api.tokenboss.co/v1',
  apiKey: '<你的 TokenBoss key>',
});`,
    language: 'json',
  },
];

export default function ManualConfigPC() {
  return (
    <div className="min-h-screen bg-bg pb-12">
      <AppNav current="console" />

      <main className="max-w-[820px] mx-auto px-5 sm:px-9 pt-6">
        {/* Breadcrumb */}
        <div className="font-mono text-[11px] tracking-[0.06em] text-[#A89A8D] mb-4">
          <Link to="/console" className="hover:text-ink transition-colors">控制台</Link>
          <span className="mx-2 text-[#D9CEC2]">/</span>
          <span className="text-ink-2">接入文档</span>
        </div>

        <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[#A89A8D] mb-2 font-bold">
          INSTALL · 接入文档
        </div>
        <h1 className="text-[40px] md:text-[48px] font-bold tracking-tight leading-[1.05] mb-3">
          一行咒语，接通你的 Agent。
        </h1>
        <p className="text-[14px] text-text-secondary mb-9 max-w-[560px] leading-relaxed">
          大部分 Agent 都能识别"自然语言安装"——粘一行进终端，Agent 自己拉文档、自己问你要 Key、自己写配置。
          下面也有按 Agent 分的手动配置入口。
        </p>

        {/* 01 · One-liner spell (the recommended path) */}
        <section className="mb-10">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-3 flex items-center gap-2">
            <span className="bg-lime-stamp text-lime-stamp-ink border-2 border-ink rounded px-1.5 py-0.5 tracking-[0.12em]">
              推荐
            </span>
            <span>一行咒语</span>
          </div>
          <div className={`${card} p-6`}>
            <p className="text-[13.5px] text-text-secondary mb-4 leading-relaxed">
              在你的 Agent 终端里粘这行——它会自己拉 <span className={codeChip}>skill.md</span> 完成接入。
            </p>
            <TerminalBlock cmd="set up tokenboss.co/skill.md" size="lg" />
            <CompatRow label="已支持" agents={AGENTS} className="mt-4" />
          </div>
        </section>

        {/* 02 · Manual config — keep two foundational steps (key + endpoint),
            then per-Agent recipes that put the snippet in the right place
            for each tool. Replaces the old "传统 4 步" wall of text. */}
        <section className="mb-10">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-3 flex items-center gap-2">
            <span className="bg-bg-alt text-ink-2 border-2 border-ink rounded px-1.5 py-0.5 tracking-[0.12em]">
              手动
            </span>
            <span>不识别咒语？两步搞定</span>
          </div>

          <div className={`${card} p-6 space-y-5 mb-5`}>
            <Step
              n="1"
              title="拿一把 API Key"
              body={
                <span>
                  到 <Link to="/console" className="text-accent font-semibold underline underline-offset-2">控制台</Link> 右栏 API KEY 标签旁的 <span className="font-semibold text-ink">+</span>。
                  弹窗里直接 <span className="font-semibold text-ink">复制 API Key</span>；之后回 default 那行点复制图标也能再拿。
                  <span className="block mt-1.5 font-mono text-[11px] text-[#A89A8D]">
                    Key 是一串 48 位字符（无前缀），形如 <span className={codeChip}>AVtIT7M3aMM7…zBAu</span>
                  </span>
                </span>
              }
            />
            <Step
              n="2"
              title="把 Base URL 指到 TokenBoss"
              body={
                <div className="space-y-2">
                  <p>所有支持 OpenAI 兼容协议的 Agent 都通过这个地址走我们：</p>
                  <div className={codeBlock}>https://api.tokenboss.co/v1</div>
                  <p className="font-mono text-[11px] text-[#A89A8D]">
                    OpenClaw / Hermes Agent / OpenAI SDK 任何 Agent 都能接——下面有按 Agent 的填写位置和模板。
                  </p>
                </div>
              }
              last
            />
          </div>

          {/* Per-Agent recipes */}
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-3">
            按你的 Agent 选
          </div>
          <div className="space-y-3">
            {RECIPES.map((r) => (
              <RecipeCard key={r.id} recipe={r} />
            ))}
          </div>
        </section>

        {/* 03 · Smoke test */}
        <section className="mb-10">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-3">
            验证
          </div>
          <div className={`${card} p-6`}>
            <p className="text-[13.5px] text-text-secondary mb-2.5 leading-relaxed">
              填完之后在终端跑一下，看看 base URL 是否能访问、key 是否生效：
            </p>
            <div className={codeBlock}>{'curl -H "Authorization: Bearer <你的 key>" \\\n     https://api.tokenboss.co/v1/models'}</div>
            <p className="font-mono text-[11px] text-[#A89A8D] mt-2.5">
              返回带 model 列表的 JSON 即接通成功。回到 <Link to="/console" className="text-accent font-semibold underline underline-offset-2">控制台</Link> 会看到第一条调用记录。
            </p>
          </div>
        </section>

        {/* Footer help line */}
        <div className="mt-10 font-mono text-[11.5px] text-ink-3 max-w-[560px] leading-relaxed">
          配置不顺？发 <span className={codeChip}>tokenboss.co/skill.md</span> 给你的 Agent，让它读完整 spec 帮你诊断；
          或回到 <Link to="/console" className="text-accent font-semibold underline underline-offset-2">控制台</Link> 看是否已有调用记录。
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
  return (
    <details className={`${card} group`}>
      <summary className="flex items-center justify-between gap-3 px-5 py-3.5 cursor-pointer list-none">
        <span className="text-[14px] font-bold text-ink">{recipe.name}</span>
        <span className="font-mono text-[11px] text-[#A89A8D] tracking-tight truncate max-w-[60%] hidden sm:inline">
          {recipe.where}
        </span>
        <span
          aria-hidden="true"
          className="font-mono text-[11px] text-[#A89A8D] flex-shrink-0 transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="px-5 pb-5 pt-0">
        <p className="text-[12.5px] text-text-secondary mb-2.5 leading-relaxed sm:hidden">
          {recipe.where}
        </p>
        <div className={codeBlock}>{recipe.snippet}</div>
      </div>
    </details>
  );
}
