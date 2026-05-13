/**
 * `/docs/protocols/anthropic-shim` — public docs page.
 *
 * 解释 TokenBoss 对 Claude（Anthropic）客户端的接入方式：服务端
 * 没有暴露 Anthropic 原生 `/v1/messages` 端点，而是在后端做了
 * 双向协议 shim（Anthropic format ↔ OpenAI Chat Completions
 * format），所以 Claude Code / 其他用 ANTHROPIC_BASE_URL 的工具
 * 可以指向 `https://api.tokenboss.co`（不带 /v1）直接接入。
 *
 * Design D8 (gh-3): ANTHROPIC_BASE_URL 不带 /v1。
 *
 * 参考: openspec/changes/gh-3-tokenboss-cc-switch-integration/tasks.md §Task 8.3
 *      openspec/changes/gh-3-tokenboss-cc-switch-integration/design.md D8
 */

import { Link } from 'react-router-dom';
import { AppNav, Breadcrumb } from '../../components/AppNav';
import { CodeBlock } from '../../components/AdvancedManualRecipes';
import { useDocumentMeta } from '../../lib/useDocumentMeta';

export default function ProtocolAnthropicShim() {
  useDocumentMeta({
    title: 'Claude 协议接入（Anthropic shim） · 协议文档 | TokenBoss',
    description:
      'Claude Code 等用 Anthropic Messages API 的客户端如何接入 TokenBoss：服务端做了双向协议转换，ANTHROPIC_BASE_URL 设为 https://api.tokenboss.co（不带 /v1）即可。',
  });

  return (
    <div className="min-h-screen bg-bg pb-16">
      <AppNav />
      <main className="max-w-3xl mx-auto px-5 sm:px-9 pt-6">
        <Breadcrumb
          items={[
            { label: '首页', to: '/' },
            { label: '协议文档', to: '/install/manual' },
            { label: 'Claude (Anthropic shim)' },
          ]}
        />

        <header className="mt-2 mb-10">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-ink-3 font-bold mb-2">
            协议文档 · ANTHROPIC SHIM
          </div>
          <h1 className="text-[32px] md:text-[40px] font-bold tracking-tight leading-[1.1] mb-3">
            Claude Code 接入 TokenBoss
          </h1>
          <p className="text-[14.5px] text-text-secondary leading-relaxed max-w-[640px]">
            Claude Code、以及任何使用
            <code className="font-mono mx-1">ANTHROPIC_BASE_URL</code>
            环境变量的客户端，可以经 TokenBoss 后端的「Anthropic
            ↔ OpenAI」协议转换层接入。本文解释这层 shim 怎么工作，以及环境变量该怎么填。
          </p>
          <div className="mt-4 text-[12.5px] text-ink-3">
            想跳过手动配置？回到{' '}
            <Link to="/install/manual" className="underline hover:text-ink">
              一键导入页
            </Link>
            ，通过 CC Switch 桌面端一键导入，Claude Code 自动配好。
          </div>
        </header>

        {/* §1 工作原理 */}
        <section className="mb-12">
          <h2 className="text-[20px] font-bold text-ink mb-4">1. 工作原理</h2>
          <p className="text-[14px] text-text-secondary leading-relaxed mb-3">
            TokenBoss <strong className="text-ink">不直接暴露</strong>{' '}
            Anthropic 原生的
            <code className="font-mono mx-1">/v1/messages</code>
            端点。但很多工具（Claude Code、Anthropic SDK 等）只认 Anthropic
            协议，所以后端做了一层双向协议 shim：
          </p>
          <ol className="space-y-2.5 text-[13.5px] text-text-secondary leading-relaxed list-decimal pl-5 mb-4">
            <li>
              客户端用 Anthropic Messages API 格式发请求到
              <code className="font-mono mx-1">api.tokenboss.co/v1/messages</code>
              。
            </li>
            <li>
              后端把请求体从 Anthropic format 转换成 OpenAI Chat Completions
              format，路由到上游模型。
            </li>
            <li>
              收到上游响应后，把响应转回 Anthropic format 再返回给客户端。
            </li>
            <li>
              SSE streaming 在两个方向上都是逐 chunk 实时转换的，延迟和原生 API
              基本对齐。
            </li>
          </ol>
          <p className="text-[14px] text-text-secondary leading-relaxed">
            对客户端来说，看到的就是一个标准的 Anthropic 端点；TokenBoss
            的多模型路由、虚拟档位（auto / eco / premium / agentic）这些
            OpenAI-compat 接口已有的能力，在 Anthropic 协议下同样可用——
            模型名照填即可。
          </p>
        </section>

        {/* §2 Claude Code 配置 */}
        <section className="mb-12">
          <h2 className="text-[20px] font-bold text-ink mb-4">
            2. Claude Code 配置
          </h2>
          <p className="text-[14px] text-text-secondary leading-relaxed mb-4">
            最省事的方式是用 <strong className="text-ink">CC Switch 桌面端</strong>
            一键导入（见{' '}
            <Link to="/install/manual" className="underline hover:text-ink">
              /install/manual
            </Link>
            ）。如果你想手动配，需要三个环境变量：
          </p>

          <CodeBlock
            code={[
              'ANTHROPIC_BASE_URL=https://api.tokenboss.co',
              'ANTHROPIC_AUTH_TOKEN=sk-你的TokenBoss密钥',
              'ANTHROPIC_MODEL=claude-sonnet-4-5',
            ].join('\n')}
            label="环境变量"
          />

          <div className="mt-5 bg-yellow-stamp/30 border-2 border-ink rounded-md p-4">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink font-bold mb-2">
              注意 · ANTHROPIC_BASE_URL 不带 /v1
            </div>
            <p className="text-[13px] text-ink leading-relaxed">
              Claude Code 自己会在 BASE_URL 后面拼上
              <code className="font-mono mx-1">/v1/messages</code>。如果你写成
              <code className="font-mono mx-1">.../v1</code>
              ，请求路径会变成
              <code className="font-mono mx-1">/v1/v1/messages</code>
              并 404。
            </p>
          </div>

          <h3 className="text-[15px] font-bold text-ink mt-6 mb-2">写到 shell rc</h3>
          <p className="text-[13.5px] text-text-secondary leading-relaxed mb-3">
            macOS / Linux 把上面三行写进
            <code className="font-mono mx-1">~/.zshrc</code>
            （或
            <code className="font-mono mx-1">~/.bashrc</code>
            ）：
          </p>
          <CodeBlock
            code={[
              "cat >> ~/.zshrc <<'EOF'",
              'export ANTHROPIC_BASE_URL=https://api.tokenboss.co',
              'export ANTHROPIC_AUTH_TOKEN=sk-你的TokenBoss密钥',
              'export ANTHROPIC_MODEL=claude-sonnet-4-5',
              'EOF',
              'source ~/.zshrc',
            ].join('\n')}
          />

          <h3 className="text-[15px] font-bold text-ink mt-6 mb-2">Windows (PowerShell)</h3>
          <CodeBlock
            code={[
              '[Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL","https://api.tokenboss.co","User")',
              '[Environment]::SetEnvironmentVariable("ANTHROPIC_AUTH_TOKEN","sk-你的TokenBoss密钥","User")',
              '[Environment]::SetEnvironmentVariable("ANTHROPIC_MODEL","claude-sonnet-4-5","User")',
            ].join('\n')}
          />

          <h3 className="text-[15px] font-bold text-ink mt-6 mb-2">验证</h3>
          <p className="text-[13.5px] text-text-secondary leading-relaxed mb-3">
            打开新终端，跑：
          </p>
          <CodeBlock code="claude --version && claude" />
          <p className="text-[12.5px] text-ink-3 leading-relaxed mt-2">
            进入交互后随便问一句话。能返回响应即接通；返回 401
            说明密钥错了，404 通常是 BASE_URL 多带了 /v1。
          </p>
        </section>

        {/* §3 CC Switch 手动配 fallback */}
        <section className="mb-12">
          <h2 className="text-[20px] font-bold text-ink mb-4">
            3. CC Switch 内手动添加（fallback）
          </h2>
          <p className="text-[14px] text-text-secondary leading-relaxed mb-4">
            如果一键导入按钮在你机器上不工作（CC Switch 没装，或者深链协议
            处理失败），可以在 CC Switch 桌面端里手动添加一个 Claude provider：
          </p>
          <ol className="space-y-2.5 text-[13.5px] text-text-secondary leading-relaxed list-decimal pl-5">
            <li>
              打开 CC Switch → Providers → <strong className="text-ink">Add Provider</strong>。
            </li>
            <li>
              Provider Type 选 <strong className="text-ink">Claude / Anthropic</strong>。
            </li>
            <li>Name 填 TokenBoss。</li>
            <li>
              Base URL 填{' '}
              <code className="font-mono text-[12.5px] bg-bg-alt border border-ink/10 rounded px-1.5 py-0.5">
                https://api.tokenboss.co
              </code>
              （
              <strong className="text-ink">不带 /v1</strong>
              ，CC Switch 会自己拼 <code className="font-mono">/v1/messages</code>）。
            </li>
            <li>API Key 粘贴你的 TokenBoss 密钥。</li>
            <li>
              Default Model 填 <code className="font-mono">claude-sonnet-4-5</code> 或{' '}
              <code className="font-mono">auto</code>。
            </li>
            <li>保存后回主界面，把 active provider 切到 TokenBoss。</li>
            <li>
              CC Switch 会自动把环境变量注入 Claude Code 的启动环境，下次开终端就生效。
            </li>
          </ol>
        </section>

        {/* §4 限制 */}
        <section className="mb-8">
          <h2 className="text-[20px] font-bold text-ink mb-4">4. 限制</h2>
          <ul className="space-y-2.5 text-[13.5px] text-text-secondary leading-relaxed list-disc pl-5">
            <li>
              <strong className="text-ink">不支持 legacy /v1/complete</strong>
              。只支持现行 Messages API（
              <code className="font-mono">/v1/messages</code>
              ）。Anthropic SDK 2023 年下半年之前的写法走不通。
            </li>
            <li>
              <strong className="text-ink">tool_use 高级变种</strong>
              ：基础的 tool_use / tool_result 流程已实测打通；少量更新的
              tool_choice 字段（如
              <code className="font-mono mx-1">disable_parallel_tool_use</code>
              ）在转换层里会被忽略或近似映射，不会报错，但行为可能与原生 API 不完全一致。
            </li>
            <li>
              <strong className="text-ink">SSE streaming</strong>
              ：已实测，所有 event type（
              <code className="font-mono">message_start</code> /
              <code className="font-mono mx-1">content_block_delta</code> /
              <code className="font-mono">message_stop</code>
              等）都按 Anthropic 规范输出。
            </li>
            <li>
              <strong className="text-ink">prompt caching</strong>
              ：转换层会把
              <code className="font-mono mx-1">cache_control</code>
              标记传递给支持的上游模型；不支持的上游会静默忽略。
            </li>
          </ul>
        </section>

        <footer className="mt-12 pt-6 border-t-2 border-ink/10 text-[12.5px] text-ink-3">
          相关阅读：
          <Link to="/docs/protocols/openai-compat" className="underline hover:text-ink mx-1.5">
            OpenAI-compat 协议
          </Link>
          ·
          <Link to="/docs/protocols/gemini-proxy" className="underline hover:text-ink mx-1.5">
            Gemini 协议接入
          </Link>
          ·
          <Link to="/install/manual" className="underline hover:text-ink mx-1.5">
            一键导入页
          </Link>
        </footer>
      </main>
    </div>
  );
}
