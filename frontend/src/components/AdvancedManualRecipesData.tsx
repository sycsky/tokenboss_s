/**
 * Recipe + Agent literals for the manual-config flow on /install/manual.
 *
 * Extracted from `screens/ManualConfigPC.tsx` so the new
 * `AdvancedManualRecipes` disclosure (gh-3 CC Switch building block)
 * can render the same RECIPES + AGENTS list without duplicating the
 * (large) literal — `ManualConfigPC.tsx` imports from here too.
 *
 * Why `.tsx` and not `.ts`: the recipe `desc` fields are ReactNodes with
 * inline `<Link>` + `<span>` chips for typographic chrome. Authoring
 * them as raw JSX is the ergonomic choice; we accept the JSX-shaped file.
 *
 * Shared Tailwind class strings (cardClass / codeChipClass) live here
 * too so the legacy page and the new disclosure render visually
 * identical chips.
 *
 * 参考: openspec/changes/gh-3-tokenboss-cc-switch-integration/design.md §2
 */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import openClawIcon from "../assets/agents/openclaw.svg";
import hermesIcon from "../assets/agents/hermes.png";
import type { AgentMark } from "./CompatRow";

// ---------- shared visual chrome ----------

export const cardClass =
  "bg-white border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917]";

// inline-block + whitespace-nowrap so a chip stays one unbroken token —
// `break-all` (the previous setting) split short tokens like `apiKey` mid-
// word and rendered the chip's border across two lines, looking broken.
export const codeChipClass =
  "inline-block align-baseline font-mono text-[12px] text-ink bg-bg border-2 border-ink rounded px-2 py-0.5 whitespace-nowrap";

export const codeBlockClass =
  "font-mono text-[12.5px] text-ink bg-bg border-2 border-ink rounded p-3 " +
  // `whitespace-pre-wrap` keeps newlines + leading indent in multi-line
  // snippets (curl with `\` continuation, JSON config, Python init, etc.)
  // while still wrapping long single lines.
  "whitespace-pre-wrap break-all leading-relaxed";

// ---------- recipe shape ----------

export interface RecipeStep {
  /** "1. 安装" / "2. 编辑配置" — visually a numbered milestone. */
  title: string;
  /** Short prose under the title. ReactNode so we can inline `codeChip` spans. */
  desc?: ReactNode;
  /** File path or shell label rendered above the code block. */
  codeLabel?: string;
  /** The code/config block itself. Multi-line OK. */
  code?: string;
}

export interface AgentRecipe {
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

// ---------- AGENTS — compat-row marks for the spell fallback ----------

export const AGENTS: AgentMark[] = [
  {
    id: "oc",
    name: "OpenClaw",
    className: "bg-[#0A0807] p-1",
    icon: <img src={openClawIcon} alt="" className="w-full h-full" style={{ imageRendering: "pixelated" }} />,
  },
  {
    id: "hm",
    name: "Hermes Agent",
    className: "bg-white p-0",
    icon: <img src={hermesIcon} alt="" className="w-full h-full object-cover rounded-lg" />,
  },
];

// ---------- RECIPES — 4 entries ----------
//
// Endpoint URL: https://api.tokenboss.co/v1 (production gateway).
// Key format: TokenBoss keys are `sk-` prefix + 48 chars (total ~51), see
// `backend/src/lib/newapi.ts` where `sk-` is force-prepended on reveal.

export const RECIPES: AgentRecipe[] = [
  {
    id: "openclaw",
    name: "OpenClaw",
    homepage: "https://openclaw.ai",
    blurb: "本地 Agent + Gateway，一条命令安装、Web 控制台",
    steps: [
      {
        title: "1. 安装 OpenClaw",
        desc: <>macOS / Linux 一键脚本——自动装依赖、装 daemon、走 onboarding。已装可跳过。</>,
        codeLabel: "终端",
        code: "curl -fsSL https://openclaw.ai/install.sh | bash",
      },
      {
        title: "2. 编辑配置文件",
        desc: (
          <>
            把下面的 JSON merge 进 <span className={codeChipClass}>~/.openclaw/openclaw.json</span>。已有的{" "}
            <span className={codeChipClass}>models.providers</span> /{" "}
            <span className={codeChipClass}>agents.defaults</span> 节点保留，只覆盖{" "}
            <span className={codeChipClass}>tokenboss</span> 这把 key。把{" "}
            <span className={codeChipClass}>{"<你的 TokenBoss key>"}</span> 换成{" "}
            <Link to="/console" className="text-accent font-semibold underline underline-offset-2">
              控制台
            </Link>{" "}
            复制的那串字符。
          </>
        ),
        codeLabel: "~/.openclaw/openclaw.json",
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
        title: "3. 重载 Gateway",
        desc: "保存后 OpenClaw 一般自动 reload。不放心就手动重启一次：",
        codeLabel: "终端",
        code: "openclaw gateway restart",
      },
    ],
    verify: {
      code: "openclaw models list | grep tokenboss",
      desc: "能看到 tokenboss/gpt-5.5 等 6 行 → 配置已生效。回控制台刷新会出现第一条调用记录。",
    },
  },
  {
    id: "hermes",
    name: "Hermes Agent",
    homepage: "https://hermes-agent.nousresearch.com",
    blurb: "Nous Research 出品的本地 Agent，TUI / CLI 双形态",
    steps: [
      {
        title: "1. 安装 Hermes",
        desc: <>macOS / Linux / WSL2 一键脚本。已装跳过。</>,
        codeLabel: "终端",
        code: `curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
source ~/.zshrc   # 或 source ~/.bashrc`,
      },
      {
        title: "2. 编辑配置文件",
        desc: (
          <>
            把下面两块写到 <span className={codeChipClass}>~/.hermes/config.yaml</span> 顶层（已有的{" "}
            <span className={codeChipClass}>providers</span> /{" "}
            <span className={codeChipClass}>toolsets</span> 等节点不要动）。Hermes 当前每会话只支持{" "}
            <strong>一个</strong> fallback，这里默认让它跌回{" "}
            <span className={codeChipClass}>gpt-5.4</span>。
          </>
        ),
        codeLabel: "~/.hermes/config.yaml",
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
        title: "3. 写 API Key 到 .env",
        desc: (
          <>
            Hermes 从这里读 <span className={codeChipClass}>TOKENBOSS_API_KEY</span>。如果{" "}
            <span className={codeChipClass}>~/.hermes/.env</span> 在 git 跟踪范围内，先把{" "}
            <span className={codeChipClass}>.env</span> 加进{" "}
            <span className={codeChipClass}>.gitignore</span> 再写。
          </>
        ),
        codeLabel: "终端",
        code: "echo 'TOKENBOSS_API_KEY=<你的 TokenBoss key>' >> ~/.hermes/.env",
      },
    ],
    verify: {
      code: "hermes model",
      desc: "显示 custom / gpt-5.5 / api.tokenboss.co/v1 即生效。再 hermes 启动跑一句对话，控制台会出现首条调用。",
    },
  },
  {
    id: "codex",
    name: "Codex CLI",
    homepage: "https://github.com/openai/codex",
    blurb: "OpenAI 官方 CLI · 走 Responses API（TokenBoss 后端原生支持 /v1/responses，无需锁版本）",
    steps: [
      {
        title: "1. 安装 Codex CLI",
        desc: <>需要 Node.js 18+。装最新版即可（后端已经支持 Responses API）。</>,
        codeLabel: "终端",
        code: "npm install -g @openai/codex",
      },
      {
        title: "2. 创建配置目录",
        desc: (
          <>
            清理旧配置（如果之前装过别的 Codex provider），新建{" "}
            <span className={codeChipClass}>~/.codex</span>。
          </>
        ),
        codeLabel: "终端",
        code: `# 删除旧的配置目录（如果存在）
rm -rf ~/.codex

# 创建新的配置目录
mkdir ~/.codex`,
      },
      {
        title: "3. 创建 auth.json",
        desc: (
          <>
            把 <span className={codeChipClass}>{"<你的 TokenBoss key>"}</span> 替换成{" "}
            <Link to="/console" className="text-accent font-semibold underline underline-offset-2">
              控制台
            </Link>{" "}
            复制的密钥。
          </>
        ),
        codeLabel: "~/.codex/auth.json",
        code: `cat > ~/.codex/auth.json << 'EOF'
{
  "OPENAI_API_KEY": "<你的 TokenBoss key>"
}
EOF`,
      },
      {
        title: "4. 创建 config.toml",
        desc: <>这段配置告诉 Codex 把请求发到 TokenBoss 的 Responses API 端点。</>,
        codeLabel: "~/.codex/config.toml",
        code: `cat > ~/.codex/config.toml << 'EOF'
model_provider = "tokenboss"
model = "gpt-5.5"
model_reasoning_effort = "high"
disable_response_storage = true
preferred_auth_method = "apikey"

[model_providers.tokenboss]
name = "tokenboss"
base_url = "https://api.tokenboss.co/v1"
wire_api = "responses"
EOF`,
      },
      {
        title: "5. 配置推理预算（可选）",
        desc: (
          <>
            修改 <span className={codeChipClass}>model_reasoning_effort</span> 控制推理深度，重启 Codex 后生效：
            <br />· <strong>high</strong> — 复杂算法、架构规划、疑难问题
            <br />· <strong>medium</strong> — 常规开发、代码重构
            <br />· <strong>low</strong> — 简单代码、快速问答
          </>
        ),
      },
    ],
    verify: {
      code: "codex",
      desc: '启动后跑一句 "ping" — 拿到回应就接通了。控制台 /console 会出现首条调用。',
    },
  },
  {
    id: "openai-compat",
    name: "其他 OpenAI 兼容",
    blurb: "Cherry Studio / Chatbox / LobeChat / OpenAI SDK 等 — 任何能填自定义 OpenAI endpoint 的工具",
    steps: [
      {
        title: "1. 找到\"自定义 OpenAI Endpoint\"设置",
        desc: (
          <>
            不同客户端入口不同：Cherry Studio / Chatbox 在<strong>设置 → 模型服务 → 添加自定义</strong>；OpenAI SDK 在初始化时传{" "}
            <span className={codeChipClass}>baseURL</span> +{" "}
            <span className={codeChipClass}>apiKey</span>。
          </>
        ),
      },
      {
        title: "2. 填这四个字段",
        codeLabel: "通用配置",
        code: `Base URL:    https://api.tokenboss.co/v1
API Key:     <你的 TokenBoss key>
Auth header: Authorization: Bearer <你的 TokenBoss key>
Models:      gpt-5.5 · gpt-5.4 · gpt-5.4-mini
             claude-opus-4-7 · claude-opus-4-6 · claude-sonnet-4-6`,
      },
      {
        title: "3. 选一个模型保存",
        desc: (
          <>
            所有 6 个模型走的都是同一个 endpoint + 同一把 key，请求 body 里{" "}
            <span className={codeChipClass}>"model"</span> 字段填哪个就用哪个。
          </>
        ),
      },
    ],
    verify: {
      code: 'curl -H "Authorization: Bearer <key>" https://api.tokenboss.co/v1/models',
      desc: "返回 JSON 里能看到上面 6 个 model id 即接通。客户端里发条消息，控制台会出现首条调用。",
    },
  },
];
