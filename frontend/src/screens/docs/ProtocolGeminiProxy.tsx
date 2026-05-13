/**
 * `/docs/protocols/gemini-proxy` — public docs page.
 *
 * 解释 Gemini 协议为什么不在 TokenBoss v1 的一键导入清单里，以及
 * 想用 Gemini CLI 的用户可以怎么通过 CC Switch 的「local proxy
 * + Gemini → OpenAI 协议转换」手动接入。
 *
 * v1 没做 Gemini-native shim 的原因写在第一节里：成本/收益判断，
 * 等数据说话决定 v2 是否补。
 *
 * 参考: openspec/changes/gh-3-tokenboss-cc-switch-integration/tasks.md §Task 8.4
 */

import { Link } from 'react-router-dom';
import { AppNav, Breadcrumb } from '../../components/AppNav';
import { CodeBlock } from '../../components/AdvancedManualRecipes';
import { useDocumentMeta } from '../../lib/useDocumentMeta';

export default function ProtocolGeminiProxy() {
  useDocumentMeta({
    title: 'Gemini 协议接入 · 协议文档 | TokenBoss',
    description:
      'Gemini 不在 TokenBoss v1 一键导入里。本文说明为什么，以及通过 CC Switch local proxy + Gemini→OpenAI 协议转换手动接入 Gemini CLI 的步骤。',
  });

  return (
    <div className="min-h-screen bg-bg pb-16">
      <AppNav />
      <main className="max-w-3xl mx-auto px-5 sm:px-9 pt-6">
        <Breadcrumb
          items={[
            { label: '首页', to: '/' },
            { label: '协议文档', to: '/install/manual' },
            { label: 'Gemini proxy' },
          ]}
        />

        <header className="mt-2 mb-10">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-ink-3 font-bold mb-2">
            协议文档 · GEMINI PROXY
          </div>
          <h1 className="text-[32px] md:text-[40px] font-bold tracking-tight leading-[1.1] mb-3">
            Gemini 协议接入（手动）
          </h1>
          <p className="text-[14.5px] text-text-secondary leading-relaxed max-w-[640px]">
            Gemini 是 TokenBoss v1 五大一键导入工具里
            <strong className="text-ink">唯一</strong>
            需要手动配置的协议。本文解释为什么，以及通过 CC Switch
            的 local proxy 接入 Gemini CLI 的步骤。
          </p>
          <div className="mt-4 text-[12.5px] text-ink-3">
            想接入 Claude Code、OpenClaw、Hermes、Codex、OpenCode？回到{' '}
            <Link to="/install/manual" className="underline hover:text-ink">
              一键导入页
            </Link>
            ，那五个走 CC Switch 5 秒接入。
          </div>
        </header>

        {/* §1 为什么不在一键导入里 */}
        <section className="mb-12">
          <h2 className="text-[20px] font-bold text-ink mb-4">
            1. 为什么 Gemini 不在一键导入里？
          </h2>
          <p className="text-[14px] text-text-secondary leading-relaxed mb-3">
            一句话：
            <strong className="text-ink"> 协议差距大，v1 没做 Gemini-native shim</strong>
            ——决策是等数据说话。
          </p>
          <ul className="space-y-2.5 text-[13.5px] text-text-secondary leading-relaxed list-disc pl-5">
            <li>
              Gemini 的 GenerateContent API 与 OpenAI Chat Completions
              在「消息结构、tool calling、媒体附件、安全过滤参数」上都不一样，做一层稳定的
              <strong className="text-ink"> 双向转换层</strong>
              需要的工程量明显高于 Anthropic shim。
            </li>
            <li>
              对比 Claude Code（覆盖了我们目前绝大多数活跃用户）和 Gemini CLI
              （早期产品、用户基数小），v1 优先做 Anthropic shim 是显然的取舍。
            </li>
            <li>
              对真正想用 Gemini 的用户：CC Switch 内置了「local proxy +
              Gemini ↔ OpenAI 协议转换」能力，**手动配三步**就能跑通；
              没必要在 TokenBoss 服务端也再做一份。
            </li>
            <li>
              如果后续数据显示 Gemini 用户体量上来了，v2 会补一层服务端的
              Gemini-native shim，让这条流程也能走一键导入。
            </li>
          </ul>
        </section>

        {/* §2 CC Switch local proxy 手动配置 */}
        <section className="mb-12">
          <h2 className="text-[20px] font-bold text-ink mb-4">
            2. 通过 CC Switch local proxy 手动接入
          </h2>
          <p className="text-[14px] text-text-secondary leading-relaxed mb-4">
            CC Switch 桌面端能在本地起一个轻量 proxy
            服务，把 Gemini 协议请求转成 OpenAI 协议再转发到上游。整体路径是：
          </p>
          <CodeBlock
            code={[
              'Gemini CLI',
              '   ↓ Gemini GenerateContent 协议',
              'CC Switch local proxy (127.0.0.1:<port>)',
              '   ↓ 协议转换 → OpenAI Chat Completions',
              'TokenBoss (https://api.tokenboss.co/v1)',
              '   ↓ 多模型路由',
              '上游模型（Gemini / Claude / GPT / ...）',
            ].join('\n')}
            label="数据流"
          />

          <h3 className="text-[15px] font-bold text-ink mt-6 mb-2">
            Step 1 · 在 CC Switch 内启用 Gemini local proxy
          </h3>
          <ol className="space-y-2 text-[13.5px] text-text-secondary leading-relaxed list-decimal pl-5">
            <li>
              打开 CC Switch → 左侧选 <strong className="text-ink">Local Proxy</strong> 标签。
            </li>
            <li>
              新建一个 proxy，protocol 选
              <strong className="text-ink"> Gemini → OpenAI</strong>
              。CC Switch 会自动分配一个本机端口（默认 8403，可改）。
            </li>
            <li>
              Upstream URL 填{' '}
              <code className="font-mono text-[12.5px] bg-bg-alt border border-ink/10 rounded px-1.5 py-0.5">
                https://api.tokenboss.co/v1
              </code>
              。
            </li>
            <li>API Key 粘贴你的 TokenBoss 密钥。</li>
            <li>
              Default Model 填 <code className="font-mono">gemini-2.5-pro</code> 或
              {' '}<code className="font-mono">auto</code>
              （让 TokenBoss 服务端按场景挑）。
            </li>
            <li>
              保存并启动 proxy。CC Switch 状态变成 RUNNING 后，本机就能从
              {' '}<code className="font-mono">http://127.0.0.1:8403</code>
              {' '}走 Gemini 协议入口。
            </li>
          </ol>

          <h3 className="text-[15px] font-bold text-ink mt-6 mb-2">
            Step 2 · 把 Gemini CLI 指向本地 proxy
          </h3>
          <p className="text-[13.5px] text-text-secondary leading-relaxed mb-3">
            Gemini CLI 通过环境变量切换 endpoint。把下面两行写进 shell rc：
          </p>
          <CodeBlock
            code={[
              'export GEMINI_API_BASE_URL=http://127.0.0.1:8403',
              'export GOOGLE_API_KEY=sk-你的TokenBoss密钥',
            ].join('\n')}
          />
          <p className="text-[12.5px] text-ink-3 mt-2 leading-relaxed">
            注意：CLI 会读
            <code className="font-mono mx-1">GOOGLE_API_KEY</code>
            ，但 CC Switch proxy 验证用的是 TokenBoss 密钥。这里只是占位让 CLI
            不报「缺 key」，实际鉴权在 proxy 层完成。
          </p>

          <h3 className="text-[15px] font-bold text-ink mt-6 mb-2">Step 3 · 验证</h3>
          <CodeBlock
            code={[
              '# 打开新终端，让环境变量生效',
              'gemini --version',
              "gemini chat 'ping'",
            ].join('\n')}
          />
          <p className="text-[12.5px] text-ink-3 mt-2 leading-relaxed">
            返回响应即接通。如果报 connection refused，回 CC Switch
            看 proxy 状态是不是 RUNNING；如果报 401，密钥不对。
          </p>
        </section>

        {/* §3 限制 */}
        <section className="mb-12">
          <h2 className="text-[20px] font-bold text-ink mb-4">3. 限制</h2>
          <ul className="space-y-2.5 text-[13.5px] text-text-secondary leading-relaxed list-disc pl-5">
            <li>
              <strong className="text-ink">不在 v1 实测范围</strong>
              ：CC Switch 的 Gemini → OpenAI 转换由 CC Switch 团队维护，
              TokenBoss 这边只保证 OpenAI-compat 后端是稳定的。极少数 Gemini
              特性（safety settings 细粒度配置、grounding 等）走到这条路径上
              可能行为不一致。
            </li>
            <li>
              <strong className="text-ink">多模态附件</strong>
              ：图片/文件附件经协议转换可能丢失部分元数据，建议先用纯文本对话验证再上多模态。
            </li>
            <li>
              <strong className="text-ink">本地 proxy 必须常驻</strong>
              ：CC Switch 关掉，proxy 也跟着停。如果你需要长期后台跑，
              用 CC Switch 的「随系统启动」选项。
            </li>
          </ul>
        </section>

        {/* §4 路线图 */}
        <section className="mb-8">
          <h2 className="text-[20px] font-bold text-ink mb-4">4. 路线图</h2>
          <p className="text-[14px] text-text-secondary leading-relaxed mb-3">
            v2 的优先级取决于数据：
          </p>
          <ul className="space-y-2.5 text-[13.5px] text-text-secondary leading-relaxed list-disc pl-5">
            <li>
              如果 Gemini 协议的使用占比起来了（埋点上能看到 N 个用户走上面这条手动路径），
              我们会在 TokenBoss 后端补一层
              <strong className="text-ink"> Gemini-native shim</strong>
              ，类似现在的 Anthropic shim，让 Gemini CLI 也能走一键导入。
            </li>
            <li>
              如果数据显示没什么人用，我们会把这条路径维持在当前「文档化但不主推」的状态，
              把工程预算投到收益更高的方向。
            </li>
          </ul>
          <p className="text-[12.5px] text-ink-3 mt-4 leading-relaxed">
            如果你是 Gemini CLI 用户、希望我们优先做 Gemini-native
            shim，欢迎在控制台「反馈」入口告诉我们——投票会算进 v2 的优先级排序。
          </p>
        </section>

        <footer className="mt-12 pt-6 border-t-2 border-ink/10 text-[12.5px] text-ink-3">
          相关阅读：
          <Link to="/docs/protocols/openai-compat" className="underline hover:text-ink mx-1.5">
            OpenAI-compat 协议
          </Link>
          ·
          <Link to="/docs/protocols/anthropic-shim" className="underline hover:text-ink mx-1.5">
            Claude 协议接入
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
