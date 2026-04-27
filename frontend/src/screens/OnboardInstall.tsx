import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TerminalBlock } from '../components/TerminalBlock';
import { OnboardShell } from '../components/OnboardShell';
import { api } from '../lib/api';
import { slockBtn } from '../lib/slockBtn';

/**
 * Step 02 — paste-and-go. The user's default API key (auto-provisioned at
 * verifyCode time) is fetched and rendered inline with the install spell so
 * a single copy lands the agent fully configured. After "我已经发给它了"
 * the flow advances to /onboard/success.
 */
export default function OnboardInstall() {
  const nav = useNavigate();
  const [waiting, setWaiting] = useState(true);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { keys } = await api.listKeys();
        if (cancelled) return;
        // Prefer a key explicitly labelled "default" (auto-created at
        // verifyCode time); fall back to the first key the user owns.
        const target = keys.find((k) => k.label === 'default') ?? keys[0];
        if (!target) {
          setKeyError('default key 未找到');
          return;
        }
        const revealed = await api.revealKey(target.keyId);
        if (cancelled) return;
        setApiKey(revealed.key);
      } catch (e) {
        if (!cancelled) setKeyError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      title="一行就接好。"
      width="lg"
    >
      <TerminalBlock
        cmd="set up tokenboss.com/skill.md"
        extra={apiKey ? `TOKENBOSS_API_KEY=${apiKey}` : undefined}
        loading={!apiKey && !keyError}
        size="lg"
        className="mb-4"
        prompt={
          <>
            <span aria-hidden="true" className="mr-1.5">↓</span>
            把这两行整体发给你的 Agent
            <span className="text-white/40 mx-1.5">·</span>
            30 秒自动接入
            <span className="text-white/40 mx-1.5">·</span>
            <span className="text-white">$10 试用立刻能用</span>
          </>
        }
      />

      {keyError && (
        <p className="font-mono text-[11px] text-accent mb-2">
          ⚠ 拉取 key 出错：{keyError}
        </p>
      )}

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
