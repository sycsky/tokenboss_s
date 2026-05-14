import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TerminalBlock } from '../components/TerminalBlock';
import { OnboardShell } from '../components/OnboardShell';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { slockBtn } from '../lib/slockBtn';

/**
 * Step 02 — paste-and-go. The platform never persists plaintext anywhere,
 * so the bootstrap policy here is:
 *   - 0 keys: createKey, hold the plaintext in component state for the
 *     duration of this page, render it inline. User pastes it into their
 *     Agent before navigating away.
 *   - any existing default (usable or stale): we have NO way to surface
 *     its plaintext — show a confirm prompt; on confirm, delete the old
 *     and create a fresh one (same as 0-keys path from there).
 *
 * Plaintext lives only in this component's `apiKey` state. Once the user
 * leaves the page, it's gone. Returning to /onboard/install goes through
 * the rebuild prompt because, by then, no default-yet-uncreatable state
 * is possible.
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

    async function bootstrap() {
      try {
        const { keys } = await api.listKeys();
        if (cancelled) return;

        // ANY existing default key = rebuild prompt (we can't surface
        // the plaintext anywhere, so we have to make a new one).
        const existing = keys.find((k) => k.label === 'default');
        if (existing) {
          setNeedsRebuild({ existingKeyId: String(existing.keyId) });
          return;
        }

        // 0 keys → create default + hold plaintext in state.
        await createDefaultKey();
      } catch (e) {
        if (!cancelled) setKeyError((e as Error).message);
      }
    }

    async function createDefaultKey() {
      const created = await api.createKey({ label: 'default' });
      if (cancelled) return;
      setApiKey(created.key);
    }

    bootstrap();

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
    if (!needsRebuild) return;
    setRebuilding(true);
    setKeyError(null);
    try {
      await api.deleteKey(needsRebuild.existingKeyId);
      const created = await api.createKey({ label: 'default' });
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

      <p className="font-mono text-[11px] tracking-[0.08em] text-[#A89A8D] mb-3">
        已支持 <span className="text-ink font-semibold">OpenClaw</span> ·{' '}
        <span className="text-ink font-semibold">Hermes Agent</span>
      </p>

      {/* P0-1 hot-fix: alternate path for users on Claude Code / Codex /
          OpenCode where the "paste magic command" flow above doesn't apply.
          CC Switch one-click covers all 5 Agent CLIs uniformly. Discovered
          via gh-3 Stage 7 new-user journey audit. */}
      <p className="text-[12px] text-text-secondary mb-9 leading-relaxed">
        <span className="font-bold text-ink">用 Claude Code / Codex / OpenCode？</span>{' '}
        走{' '}
        <a
          href="/install/manual"
          className="text-accent font-semibold underline underline-offset-2"
        >
          CC Switch 一键导入
        </a>
        {' '}— 5 个 CLI 都支持，免去手动改配置。
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
