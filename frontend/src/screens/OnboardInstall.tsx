import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TerminalBlock } from '../components/TerminalBlock';
import { OnboardShell } from '../components/OnboardShell';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { getCachedKey, setCachedKey } from '../lib/keyCache';
import { isExpired } from '../lib/keyExpiry';
import { slockBtn } from '../lib/slockBtn';

/**
 * Step 02 — paste-and-go. Resolves the user's default API key plaintext:
 * 1) cache hit → render (most common after first visit)
 * 2) no key yet → createKey + cache + render
 * 3) edge: existing default but cache miss → confirm rebuild, then 1+2
 *
 * The page itself IS the "shown once" moment: user is about to paste the
 * key into their AI client. We write to localStorage immediately on receipt.
 */
export default function OnboardInstall() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [waiting, setWaiting] = useState(true);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [needsRebuild, setNeedsRebuild] = useState<{ existingKeyId: string } | null>(null);
  const [rebuilding, setRebuilding] = useState(false);

  useEffect(() => {
    if (!user?.email) return;
    let cancelled = false;

    async function bootstrap(email: string) {
      try {
        const { keys } = await api.listKeys();
        if (cancelled) return;

        // Look for a USABLE existing default — not disabled, not expired.
        const existing = keys.find(
          (k) => k.label === 'default' && !k.disabled && !isExpired(k),
        );
        if (existing) {
          const cached = getCachedKey(email, String(existing.keyId));
          if (cached) {
            setApiKey(cached);
            return;
          }
          // Edge: stale default, plaintext lost on this browser. Ask user.
          setNeedsRebuild({ existingKeyId: String(existing.keyId) });
          return;
        }
        // If only disabled/expired defaults exist, prompt rebuild for the
        // first such key so the user can replace it instead of getting
        // silently stuck.
        const stale = keys.find((k) => k.label === 'default');
        if (stale) {
          setNeedsRebuild({ existingKeyId: String(stale.keyId) });
          return;
        }

        // Normal new-user path: 0 keys → create default
        await createDefaultKey(email);
      } catch (e) {
        if (!cancelled) setKeyError((e as Error).message);
      }
    }

    async function createDefaultKey(email: string) {
      const created = await api.createKey({ label: 'default' });
      if (cancelled) return;
      setCachedKey(email, String(created.keyId), created.key);
      setApiKey(created.key);
    }

    bootstrap(user.email);

    return () => {
      cancelled = true;
    };
  }, [user?.email]);

  // Eventually replaced by polling /v1/usage for the first chat call.
  useEffect(() => {
    if (!apiKey) return;
    const timer = setTimeout(() => setWaiting(false), 3000);
    return () => clearTimeout(timer);
  }, [apiKey]);

  async function handleConfirmRebuild() {
    if (!user?.email || !needsRebuild) return;
    setRebuilding(true);
    setKeyError(null);
    try {
      await api.deleteKey(needsRebuild.existingKeyId);
      const created = await api.createKey({ label: 'default' });
      setCachedKey(user.email, String(created.keyId), created.key);
      setApiKey(created.key);
      setNeedsRebuild(null);
    } catch (e) {
      setKeyError((e as Error).message);
    } finally {
      setRebuilding(false);
    }
  }

  return (
    <OnboardShell
      step="02"
      cnLabel="发咒语"
      enLabel="Send to Agent"
      title="一行就接好。"
      width="lg"
    >
      <TerminalBlock
        cmd="set up tokenboss.co/skill.md"
        extra={apiKey ? `TOKENBOSS_API_KEY=${apiKey}` : undefined}
        loading={!apiKey && !keyError && !needsRebuild}
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

      {apiKey && (
        <p className="font-mono text-[10.5px] text-[#A89A8D] mt-1 mb-3">
          这是你第一次也是唯一一次看到完整 Key — 装好客户端后请妥善保存。
        </p>
      )}

      {keyError && (
        <p className="font-mono text-[11px] text-accent mb-2">{keyError}</p>
      )}

      {needsRebuild && (
        <div className="mt-3 border-2 border-ink rounded-md bg-amber-50 p-4">
          <div className="text-[14px] font-bold text-ink mb-2">要重新生成 Key 吗？</div>
          <p className="text-[13px] text-[#6B5E52] leading-relaxed mb-2">
            你之前的 default Key 还在 newapi 那边可用，但<strong>这个浏览器没有它的明文缓存</strong>
            ——为了你的安全，明文不能在新设备上再次显示。
          </p>
          <p className="text-[13px] text-[#6B5E52] leading-relaxed mb-3">
            继续的话，<strong>旧 Key 将被吊销</strong>，任何已经绑定它的客户端都会停止工作。
          </p>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => nav('/onboard/welcome')}
              disabled={rebuilding}
              className={
                'px-3 py-1.5 bg-white text-ink font-bold text-[13px] border-2 border-ink rounded ' +
                'shadow-[2px_2px_0_0_#1C1917] ' +
                'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
                'disabled:opacity-50 disabled:cursor-not-allowed transition-all'
              }
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirmRebuild}
              disabled={rebuilding}
              className={
                'px-3 py-1.5 bg-ink text-white font-bold text-[13px] border-2 border-ink rounded ' +
                'shadow-[2px_2px_0_0_#E8692A] ' +
                'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#E8692A] ' +
                'disabled:opacity-50 disabled:cursor-not-allowed transition-all'
              }
            >
              {rebuilding ? '处理中…' : '吊销旧 Key 并生成新的'}
            </button>
          </div>
        </div>
      )}

      <p className="font-mono text-[11px] tracking-[0.08em] text-[#A89A8D] mb-9">
        已支持 <span className="text-ink font-semibold">OpenClaw</span> ·{' '}
        <span className="text-ink font-semibold">Hermes Agent</span>
      </p>

      {waiting || !apiKey ? (
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
          type="button"
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
