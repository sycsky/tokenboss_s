import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TerminalBlock } from '../components/TerminalBlock';
import { OnboardShell } from '../components/OnboardShell';
import { slockBtn } from '../lib/slockBtn';

/**
 * Step 02 — paste-and-wait. Shows the install spell as a Slock-pixel
 * terminal block, then a status card that auto-advances when the
 * backend reports the first chat call. Until polling is wired, a 3 s
 * timer simulates the detection.
 */
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
    <OnboardShell
      step="02"
      cnLabel="发咒语"
      enLabel="Send to Agent"
      title="把下面这行发给你的 Agent"
      subtitle="Agent 会自己读完 skill.md，30 秒接好。"
      width="lg"
    >
      <TerminalBlock cmd="set up tokenboss.com/skill.md" size="lg" className="mb-4" />

      <p className="font-mono text-[11px] tracking-[0.08em] text-[#A89A8D] mb-9">
        已支持 <span className="text-ink font-semibold">OpenClaw</span> ·{' '}
        <span className="text-ink font-semibold">Hermes Agent</span> ·{' '}
        <span className="text-ink font-semibold">Claude Code</span>
      </p>

      {waiting ? (
        <div className="flex items-center gap-4 px-5 py-4 bg-white border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917]">
          <span aria-hidden="true" className="relative flex-shrink-0">
            <span className="absolute inset-0 bg-accent/40 rounded-full animate-ping" />
            <span className="relative block w-3 h-3 bg-accent border-2 border-ink rounded-full" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-bold text-ink">等 Agent 回话…</div>
            <div className="text-[12px] text-[#6B5E52] mt-0.5">检测到首次调用即自动跳转</div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => nav('/onboard/success')}
          className={slockBtn('primary') + ' w-full'}
        >
          我已经发给它了 →
        </button>
      )}

      {/* Always-visible back-out so a user who picked the wrong path
          on /welcome isn't stuck — restores the previous step. */}
      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={() => nav('/onboard/welcome')}
          className="font-mono text-[11.5px] text-[#A89A8D] hover:text-ink underline underline-offset-4 decoration-2 transition-colors"
        >
          ← 我点错了，重选入口
        </button>
      </div>
    </OnboardShell>
  );
}
