/**
 * `/docs/protocols/openai-compat` — public docs page.
 *
 * 解释 TokenBoss 作为 OpenAI-compatible 厂商的协议契约：base URL、鉴权、
 * /v1/models、/v1/chat/completions、SSE streaming，以及在主流 OpenAI
 * 兼容客户端（Cursor / Cherry Studio / Chatbox / NextChat / LobeChat /
 * OpenWebUI / Dify / FastGPT）里如何接入。
 *
 * 信息源是 docs/AI配置指令-TokenBoss厂商.md（写给 AI 的执行清单），
 * 这里改写成「给人读」的解释文档：去掉 TASK / DONE_CRITERIA / 命令语气，
 * 改成陈述+示例，并把 base URL 统一更正为 `api.tokenboss.co/v1`。
 *
 * 参考: openspec/changes/gh-3-tokenboss-cc-switch-integration/tasks.md §Task 8.2
 */

import { Link } from 'react-router-dom';
import { AppNav, Breadcrumb } from '../../components/AppNav';
import { CodeBlock } from '../../components/AdvancedManualRecipes';
import { useDocumentMeta } from '../../lib/useDocumentMeta';

export default function ProtocolOpenAICompat() {
  useDocumentMeta({
    title: 'OpenAI-compat 协议接入 · 协议文档 | TokenBoss',
    description:
      'TokenBoss 是 OpenAI-compatible provider。本文说明 base URL、鉴权头、/v1/models 与 /v1/chat/completions 端点，以及在 Cursor / Cherry Studio / Chatbox 等客户端的配置方式。',
  });

  return (
    <div className="min-h-screen bg-bg pb-16">
      <AppNav />
      <main className="max-w-3xl mx-auto px-5 sm:px-9 pt-6">
        <Breadcrumb
          items={[
            { label: '首页', to: '/' },
            { label: '协议文档', to: '/install/manual' },
            { label: 'OpenAI-compat' },
          ]}
        />

        <header className="mt-2 mb-10">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-ink-3 font-bold mb-2">
            协议文档 · OPENAI-COMPATIBLE
          </div>
          <h1 className="text-[32px] md:text-[40px] font-bold tracking-tight leading-[1.1] mb-3">
            把 TokenBoss 当作 OpenAI 厂商接入
          </h1>
          <p className="text-[14.5px] text-text-secondary leading-relaxed max-w-[640px]">
            TokenBoss 后端实现了完整的 OpenAI Chat Completions
            协议子集，任何「支持自定义 OpenAI 端点」的客户端都能把
            TokenBoss 当成 OpenAI 厂商接入。本文解释协议契约和主流客户端的配置方式。
          </p>
          <div className="mt-4 text-[12.5px] text-ink-3">
            想跳过手动配置？回到{' '}
            <Link to="/install/manual" className="underline hover:text-ink">
              一键导入页
            </Link>
            ，五个主流 Agent CLI 走 CC Switch 5 秒接入。
          </div>
        </header>

        {/* §1 协议总览 */}
        <section className="mb-12">
          <h2 className="text-[20px] font-bold text-ink mb-4">1. 协议总览</h2>
          <p className="text-[14px] text-text-secondary leading-relaxed mb-4">
            TokenBoss 暴露的是 <strong className="text-ink">OpenAI 兼容端点</strong>
            ，不是 Anthropic 原生 Messages API。任何能填「Base URL +
            API Key」的客户端都能直接用。
          </p>
          <ul className="space-y-2 text-[13.5px] text-text-secondary leading-relaxed">
            <li>
              <strong className="text-ink">Base URL</strong>：
              <code className="font-mono text-[12.5px] bg-bg-alt border border-ink/10 rounded px-1.5 py-0.5 mx-1">
                https://api.tokenboss.co/v1
              </code>
            </li>
            <li>
              <strong className="text-ink">鉴权</strong>：Bearer Token，放在
              <code className="font-mono text-[12.5px] bg-bg-alt border border-ink/10 rounded px-1.5 py-0.5 mx-1">
                Authorization
              </code>
              请求头里
            </li>
            <li>
              <strong className="text-ink">列模型</strong>：
              <code className="font-mono text-[12.5px] bg-bg-alt border border-ink/10 rounded px-1.5 py-0.5 mx-1">
                GET /v1/models
              </code>
            </li>
            <li>
              <strong className="text-ink">对话</strong>：
              <code className="font-mono text-[12.5px] bg-bg-alt border border-ink/10 rounded px-1.5 py-0.5 mx-1">
                POST /v1/chat/completions
              </code>
            </li>
            <li>
              <strong className="text-ink">流式</strong>：SSE，请求体加
              <code className="font-mono text-[12.5px] bg-bg-alt border border-ink/10 rounded px-1.5 py-0.5 mx-1">
                stream: true
              </code>
              即可
            </li>
          </ul>
        </section>

        {/* §2 关键参数 */}
        <section className="mb-12">
          <h2 className="text-[20px] font-bold text-ink mb-4">2. 关键参数</h2>
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-[13px] border-2 border-ink rounded-md overflow-hidden">
              <thead className="bg-bg-alt">
                <tr>
                  <th className="text-left font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 font-bold px-3 py-2 border-b-2 border-ink">
                    参数
                  </th>
                  <th className="text-left font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 font-bold px-3 py-2 border-b-2 border-ink">
                    值
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white">
                <tr className="border-b border-ink/10">
                  <td className="px-3 py-2.5 font-mono text-[12.5px]">base_url</td>
                  <td className="px-3 py-2.5 font-mono text-[12.5px] text-ink">
                    https://api.tokenboss.co/v1
                  </td>
                </tr>
                <tr className="border-b border-ink/10">
                  <td className="px-3 py-2.5 font-mono text-[12.5px]">auth_header</td>
                  <td className="px-3 py-2.5 font-mono text-[12.5px] text-ink">
                    Authorization: Bearer &lt;API_KEY&gt;
                  </td>
                </tr>
                <tr className="border-b border-ink/10">
                  <td className="px-3 py-2.5 font-mono text-[12.5px]">models_endpoint</td>
                  <td className="px-3 py-2.5 font-mono text-[12.5px] text-ink">
                    GET /v1/models
                  </td>
                </tr>
                <tr className="border-b border-ink/10">
                  <td className="px-3 py-2.5 font-mono text-[12.5px]">chat_endpoint</td>
                  <td className="px-3 py-2.5 font-mono text-[12.5px] text-ink">
                    POST /v1/chat/completions
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2.5 font-mono text-[12.5px]">streaming</td>
                  <td className="px-3 py-2.5 font-mono text-[12.5px] text-ink">
                    SSE，stream: true
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[12.5px] text-ink-3 mt-3 leading-relaxed">
            部分客户端（如 Cherry Studio / NextChat）会自动给 Base URL 拼
            <code className="font-mono mx-1">/v1</code>
            。如果填了
            <code className="font-mono mx-1">.../v1</code>
            后请求路径出现重复
            <code className="font-mono mx-1">/v1/v1/</code>
            ，去掉末尾的 <code className="font-mono mx-1">/v1</code> 即可。
          </p>
        </section>

        {/* §3 推荐模型 */}
        <section className="mb-12">
          <h2 className="text-[20px] font-bold text-ink mb-4">3. 推荐模型</h2>
          <p className="text-[14px] text-text-secondary leading-relaxed mb-4">
            完整模型表通过
            <code className="font-mono mx-1 text-[12.5px] bg-bg-alt border border-ink/10 rounded px-1.5 py-0.5">
              GET /v1/models
            </code>
            实时拉取。下面是写客户端模型列表时常用的几条：
          </p>

          <div className="mb-3">
            <h3 className="text-[14.5px] font-bold text-ink mb-2">真实模型</h3>
            <CodeBlock
              code={[
                'claude-sonnet-4-5',
                'claude-opus-4',
                'gpt-5',
                'gpt-4o',
                'gemini-2.5-pro',
                'deepseek-v3',
              ].join('\n')}
            />
          </div>

          <div className="mt-4">
            <h3 className="text-[14.5px] font-bold text-ink mb-2">
              虚拟档位（服务端自动路由 + fallback）
            </h3>
            <CodeBlock
              code={[
                'auto       # 默认推荐，让服务端按场景挑',
                'eco        # 省钱档',
                'premium    # 旗舰档',
                'agentic    # 工具调用 / agent 场景',
              ].join('\n')}
            />
            <p className="text-[12.5px] text-ink-3 mt-3 leading-relaxed">
              不确定填哪个模型时，先填{' '}
              <code className="font-mono">auto</code>
              。服务端会按你的套餐挑当前可用的最佳模型，单点故障也会自动 fallback。
            </p>
          </div>
        </section>

        {/* §4 Cursor */}
        <section className="mb-12">
          <h2 className="text-[20px] font-bold text-ink mb-4">4. Cursor</h2>
          <ol className="space-y-2.5 text-[13.5px] text-text-secondary leading-relaxed list-decimal pl-5">
            <li>打开 Cursor Settings → Models。</li>
            <li>
              展开 <strong className="text-ink">OpenAI API Key</strong> 区域，勾上
              <strong className="text-ink"> Override OpenAI Base URL</strong>。
            </li>
            <li>
              Base URL 填{' '}
              <code className="font-mono text-[12.5px] bg-bg-alt border border-ink/10 rounded px-1.5 py-0.5">
                https://api.tokenboss.co/v1
              </code>
              。
            </li>
            <li>
              API Key 粘贴你的 TokenBoss 密钥（
              <code className="font-mono">sk-</code> 开头）。
            </li>
            <li>
              <strong className="text-ink">Custom Models</strong>
              {' '}里把上面「推荐模型」逐行添加。Cursor 不会自动从
              <code className="font-mono mx-1">/v1/models</code>
              拉，必须手动加。
            </li>
            <li>点 Verify 按钮，绿对勾即接通。</li>
          </ol>
        </section>

        {/* §5 Cherry Studio */}
        <section className="mb-12">
          <h2 className="text-[20px] font-bold text-ink mb-4">5. Cherry Studio</h2>
          <ol className="space-y-2.5 text-[13.5px] text-text-secondary leading-relaxed list-decimal pl-5">
            <li>设置 → 模型服务 → 添加 → 选 OpenAI。</li>
            <li>名称：TokenBoss。</li>
            <li>
              API Host：
              <code className="font-mono text-[12.5px] bg-bg-alt border border-ink/10 rounded px-1.5 py-0.5">
                https://api.tokenboss.co
              </code>
              <strong className="text-ink"> 不要</strong>带 /v1
              ——Cherry Studio 会自己拼。
            </li>
            <li>API Key：你的 TokenBoss 密钥。</li>
            <li>点「管理」按钮 → 添加上面「推荐模型」里的条目。</li>
          </ol>
        </section>

        {/* §6 Chatbox */}
        <section className="mb-12">
          <h2 className="text-[20px] font-bold text-ink mb-4">6. Chatbox</h2>
          <ol className="space-y-2.5 text-[13.5px] text-text-secondary leading-relaxed list-decimal pl-5">
            <li>
              Settings → Model Provider → 选 <strong className="text-ink">OpenAI API Compatible</strong>。
            </li>
            <li>
              API Host：
              <code className="font-mono text-[12.5px] bg-bg-alt border border-ink/10 rounded px-1.5 py-0.5">
                https://api.tokenboss.co/v1
              </code>
              （Chatbox 不会自动拼 /v1，必须带）。
            </li>
            <li>API Key：你的 TokenBoss 密钥。</li>
            <li>
              Model：先填 <code className="font-mono">claude-sonnet-4-5</code> 测一句。
            </li>
          </ol>
        </section>

        {/* §7 简略配置表 */}
        <section className="mb-12">
          <h2 className="text-[20px] font-bold text-ink mb-4">
            7. 其他常见客户端
          </h2>
          <p className="text-[14px] text-text-secondary leading-relaxed mb-4">
            下面这些客户端都按相同的「OpenAI 兼容」入口配，只是字段名稍有差异。
          </p>
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-[12.5px] border-2 border-ink rounded-md overflow-hidden">
              <thead className="bg-bg-alt">
                <tr>
                  <th className="text-left font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3 font-bold px-3 py-2 border-b-2 border-ink">
                    客户端
                  </th>
                  <th className="text-left font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3 font-bold px-3 py-2 border-b-2 border-ink">
                    入口
                  </th>
                  <th className="text-left font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3 font-bold px-3 py-2 border-b-2 border-ink">
                    Base URL 填法
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white">
                <tr className="border-b border-ink/10">
                  <td className="px-3 py-2.5 font-bold text-ink">NextChat</td>
                  <td className="px-3 py-2.5">自定义接口 → OpenAI</td>
                  <td className="px-3 py-2.5 font-mono">https://api.tokenboss.co</td>
                </tr>
                <tr className="border-b border-ink/10">
                  <td className="px-3 py-2.5 font-bold text-ink">LobeChat</td>
                  <td className="px-3 py-2.5">设置 → 语言模型 → OpenAI</td>
                  <td className="px-3 py-2.5 font-mono">https://api.tokenboss.co/v1</td>
                </tr>
                <tr className="border-b border-ink/10">
                  <td className="px-3 py-2.5 font-bold text-ink">Open WebUI</td>
                  <td className="px-3 py-2.5">Settings → Connections → OpenAI API</td>
                  <td className="px-3 py-2.5 font-mono">https://api.tokenboss.co/v1</td>
                </tr>
                <tr className="border-b border-ink/10">
                  <td className="px-3 py-2.5 font-bold text-ink">Dify</td>
                  <td className="px-3 py-2.5">模型供应商 → OpenAI-API-compatible</td>
                  <td className="px-3 py-2.5 font-mono">https://api.tokenboss.co/v1</td>
                </tr>
                <tr>
                  <td className="px-3 py-2.5 font-bold text-ink">FastGPT</td>
                  <td className="px-3 py-2.5">模型 → OneAPI / 自定义</td>
                  <td className="px-3 py-2.5 font-mono">https://api.tokenboss.co/v1</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[12.5px] text-ink-3 mt-3 leading-relaxed">
            如果你用的客户端不在表里：找它的「OpenAI Compatible / 自定义模型 / Custom Provider」入口，
            按 §2 的参数填即可。一条铁律：
            <strong className="text-ink"> 绝不要选 Anthropic 原生协议</strong>
            （TokenBoss 不暴露 <code className="font-mono">/v1/messages</code>，详见{' '}
            <Link to="/docs/protocols/anthropic-shim" className="underline hover:text-ink">
              Anthropic-shim 协议页
            </Link>
            ）。
          </p>
        </section>

        {/* §8 错误码 */}
        <section className="mb-8">
          <h2 className="text-[20px] font-bold text-ink mb-4">8. 错误码速查</h2>
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-[12.5px] border-2 border-ink rounded-md overflow-hidden">
              <thead className="bg-bg-alt">
                <tr>
                  <th className="text-left font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3 font-bold px-3 py-2 border-b-2 border-ink">
                    码
                  </th>
                  <th className="text-left font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3 font-bold px-3 py-2 border-b-2 border-ink">
                    含义
                  </th>
                  <th className="text-left font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3 font-bold px-3 py-2 border-b-2 border-ink">
                    处理
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white">
                <tr className="border-b border-ink/10">
                  <td className="px-3 py-2.5 font-mono font-bold text-ink">401</td>
                  <td className="px-3 py-2.5">密钥无效 / 已被删</td>
                  <td className="px-3 py-2.5">回控制台重新生成密钥</td>
                </tr>
                <tr className="border-b border-ink/10">
                  <td className="px-3 py-2.5 font-mono font-bold text-ink">402</td>
                  <td className="px-3 py-2.5">套餐余额耗尽</td>
                  <td className="px-3 py-2.5">控制台续费或充值</td>
                </tr>
                <tr className="border-b border-ink/10">
                  <td className="px-3 py-2.5 font-mono font-bold text-ink">404</td>
                  <td className="px-3 py-2.5">路径里出现 /v1/v1/</td>
                  <td className="px-3 py-2.5">Base URL 末尾去掉 /v1，让客户端自己拼</td>
                </tr>
                <tr className="border-b border-ink/10">
                  <td className="px-3 py-2.5 font-mono font-bold text-ink">429</td>
                  <td className="px-3 py-2.5">触发限流</td>
                  <td className="px-3 py-2.5">指数退避重试，降低并发</td>
                </tr>
                <tr className="border-b border-ink/10">
                  <td className="px-3 py-2.5 font-mono font-bold text-ink">5xx</td>
                  <td className="px-3 py-2.5">上游故障</td>
                  <td className="px-3 py-2.5">
                    内部已自动 fallback；持续出现请记录时间+模型名反馈
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2.5 font-mono font-bold text-ink">
                    model_not_found
                  </td>
                  <td className="px-3 py-2.5">该模型当前未启用</td>
                  <td className="px-3 py-2.5">
                    改用 <code className="font-mono">auto</code> 让服务端自动选可用模型
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <footer className="mt-12 pt-6 border-t-2 border-ink/10 text-[12.5px] text-ink-3">
          相关阅读：
          <Link to="/docs/protocols/anthropic-shim" className="underline hover:text-ink mx-1.5">
            Claude 协议接入
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
