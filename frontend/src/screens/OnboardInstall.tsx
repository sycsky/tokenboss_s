import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TerminalBlock } from '../components/TerminalBlock';

export default function OnboardInstall() {
  const nav = useNavigate();
  const [waiting, setWaiting] = useState(true);

  // TODO(production): replace this 3-second simulation with polling /v1/usage
  // for the first chat call — when the API returns at least one usage record,
  // setWaiting(false) and auto-advance to /onboard/success.
  useEffect(() => {
    const timer = setTimeout(() => setWaiting(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-bg p-6 flex flex-col">
      <div className="max-w-lg mx-auto w-full mt-12">
        <div className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-3 mb-3">第二步 · STEP 02</div>
        <h1 className="text-3xl font-bold mb-2 tracking-tight">复制下面这行</h1>
        <p className="text-ink-2 text-sm mb-8">在你的 Agent 终端里粘贴 → Agent 自动拉取 skill.md 并接入</p>

        <TerminalBlock cmd="set up tokenboss.com/skill.md" size="lg" className="mb-4" />

        <p className="font-mono text-xs text-ink-3 mb-10">
          在 <span className="text-ink-2 font-semibold">OpenClaw / Hermes / Claude Code</span> 等 Agent 终端里粘贴
        </p>

        {waiting ? (
          <div className="bg-surface border border-border rounded-xl p-5 flex items-center gap-3">
            <div className="w-3 h-3 bg-accent rounded-full animate-pulse" />
            <div>
              <div className="text-sm font-semibold">等待 Agent 拉取 skill.md…</div>
              <div className="text-xs text-ink-3 mt-0.5">检测到首次调用即自动跳转</div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => nav('/onboard/success')}
            className="w-full py-3 bg-accent text-white font-semibold rounded-lg"
          >
            我已经粘贴好了 →
          </button>
        )}
      </div>
    </div>
  );
}
