import { useNavigate } from 'react-router-dom';

export default function OnboardWelcome() {
  const nav = useNavigate();
  return (
    <div className="min-h-screen bg-bg p-6 flex flex-col">
      <div className="max-w-md mx-auto w-full mt-12">
        <div className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-3 mb-3">第一步 · STEP 01</div>
        <h1 className="text-3xl font-bold mb-2 tracking-tight">怎么接入？</h1>
        <p className="text-ink-2 text-sm mb-10">告诉我们你的使用场景，给你最合适的引导</p>

        <button
          onClick={() => nav('/onboard/install')}
          className="w-full bg-accent text-white rounded-2xl p-6 mb-4 text-left hover:bg-accent-deep transition"
        >
          <div className="font-mono text-[10px] tracking-widest uppercase opacity-70 mb-2">推荐</div>
          <div className="text-2xl font-bold mb-1">我是 Agent 用户</div>
          <div className="text-sm opacity-80">在 OpenClaw / Hermes / Claude Code 终端粘贴一行咒语，30 秒搞定</div>
        </button>

        <button
          onClick={() => nav('/install/manual')}
          className="w-full bg-surface border border-border rounded-2xl p-6 text-left hover:border-ink-2 transition"
        >
          <div className="font-mono text-[10px] tracking-widest uppercase text-ink-3 mb-2">手动</div>
          <div className="text-xl font-bold mb-1 text-ink">我自己配置</div>
          <div className="text-sm text-ink-2">看详细步骤，手动配 API key + base_url</div>
        </button>
      </div>
    </div>
  );
}
