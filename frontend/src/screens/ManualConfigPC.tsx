import { Link } from 'react-router-dom';
import { TerminalBlock } from '../components/TerminalBlock';

export default function ManualConfigPC() {
  return (
    <div className="min-h-screen bg-bg">
      <nav className="px-9 py-4 flex items-center justify-between border-b border-border max-w-[1200px] mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-accent rounded-md flex items-center justify-center text-white font-mono text-[10px] font-bold">TB</div>
          <span className="font-bold">TokenBoss</span>
        </div>
        <div className="flex gap-6 text-[13px] text-ink-2">
          <Link to="/console">控制台</Link>
          <Link to="/pricing">套餐</Link>
        </div>
      </nav>

      <main className="max-w-[840px] mx-auto px-6 py-12">
        <div className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-3 mb-3">手动接入文档</div>
        <h1 className="text-4xl font-bold tracking-tight mb-3">在你的工具里接入 TokenBoss</h1>
        <p className="text-ink-2 mb-8">大部分用户用一行咒语即可。下面也提供传统的 4 步配置方式。</p>

        <section className="mb-12">
          <h2 className="text-lg font-bold mb-3">推荐：一行咒语</h2>
          <p className="text-sm text-ink-2 mb-3">在 Agent 终端粘贴这行，Agent 会自动拉 skill.md 并完成接入：</p>
          <TerminalBlock cmd="set up tokenboss.com/skill.md" size="lg" />
          <p className="font-mono text-xs text-ink-3 mt-3">
            支持 OpenClaw / Hermes / Claude Code / Codex 等。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold mb-3">备选：传统配置 4 步</h2>
          <ol className="list-decimal list-inside space-y-3 text-sm text-ink-2">
            <li>在 <Link to="/console" className="text-accent">控制台</Link> 创建一个 API key（仅显示一次，请立即复制）</li>
            <li>设置 base URL: <code className="font-mono bg-surface px-2 py-0.5 rounded text-xs">https://api.tokenboss.com/v1</code></li>
            <li>设置 API key 环境变量: <code className="font-mono bg-surface px-2 py-0.5 rounded text-xs">TOKENBOSS_API_KEY=tb_...</code></li>
            <li>测试调用: <code className="font-mono bg-surface px-2 py-0.5 rounded text-xs">curl -H "Authorization: Bearer $TOKENBOSS_API_KEY" https://api.tokenboss.com/v1/models</code></li>
          </ol>
        </section>
      </main>
    </div>
  );
}
