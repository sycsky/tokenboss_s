import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, type CreatedProxyKey, type ProxyKeySummary } from '../lib/api';
import { setCachedKey } from '../lib/keyCache';

/**
 * Slock-pixel modal shell — backdrop dim + ink-bordered card. Shared by
 * the three key-related modals. ESC + click-outside dismiss; body scroll
 * locks while open. Header gets the small mono uppercase tag + close ×.
 */
function ModalShell({
  open,
  onClose,
  tag,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  tag: string;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-5" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/55" onClick={onClose} aria-hidden="true" />
      <div className="relative bg-white border-2 border-ink rounded-lg shadow-[6px_6px_0_0_#1C1917] max-w-[440px] w-full p-6">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[#A89A8D] font-bold mb-1">
              {tag}
            </div>
            <h2 className="text-[20px] font-bold tracking-tight text-ink leading-tight">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="font-mono text-[18px] leading-none text-[#A89A8D] hover:text-ink transition-colors flex-shrink-0 mt-1"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Variant of ModalShell for moments where dismissing without an explicit
 * action is unsafe (e.g., the "show once" plaintext reveal). No backdrop
 * click, no ×, no ESC — only the explicit acknowledge button can close it.
 */
function StickyModalShell({
  open,
  tag,
  title,
  children,
}: {
  open: boolean;
  tag: string;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-5" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/55" aria-hidden="true" />
      <div className="relative bg-white border-2 border-ink rounded-lg shadow-[6px_6px_0_0_#1C1917] max-w-[440px] w-full p-6">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[#A89A8D] font-bold mb-1">
              {tag}
            </div>
            <h2 className="text-[20px] font-bold tracking-tight text-ink leading-tight">{title}</h2>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Stage 1: name input. On submit, calls api.createKey, then transitions
 * the parent to the reveal stage by handing back the freshly-minted key.
 * v1 has no rotation / scopes UX — just a label. The backend tolerates
 * an empty label (defaults to 'default'), but UI nudges a real name.
 */
export function CreateKeyModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (created: CreatedProxyKey) => void;
}) {
  const [label, setLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Expiry as days-from-now. '' = permanent (default), or a positive int.
  const [expiresInDays, setExpiresInDays] = useState<string>('');

  // Reset on each open + autofocus.
  useEffect(() => {
    if (!open) return;
    setLabel('');
    setError(null);
    setSubmitting(false);
    setExpiresInDays('');  // NEW
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const days = expiresInDays.trim();
      const created = await api.createKey({
        label: label.trim() || undefined,
        ...(days ? { expiresInDays: Number(days) } : {}),
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `创建失败: ${(err as Error).message}`);
      setSubmitting(false);
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} tag="CREATE" title="新建 API Key">
      <form onSubmit={handleSubmit}>
        <label className="block font-mono text-[10.5px] tracking-[0.16em] uppercase text-[#A89A8D] font-bold mb-2">
          名字
        </label>
        <input
          ref={inputRef}
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={64}
          placeholder="例如：my-laptop · openclaw · hermes"
          className={
            'w-full px-3.5 py-2.5 bg-white border-2 border-ink rounded text-[14px] text-ink ' +
            'shadow-[2px_2px_0_0_#1C1917] ' +
            'focus:outline-none focus:translate-x-[1px] focus:translate-y-[1px] focus:shadow-[1px_1px_0_0_#1C1917] ' +
            'transition-all placeholder:text-[#A89A8D]'
          }
        />

        <label
          htmlFor="key-expires"
          className="block font-mono text-[10.5px] tracking-[0.16em] uppercase text-[#A89A8D] font-bold mt-4 mb-2"
        >
          有效期
        </label>
        <select
          id="key-expires"
          value={expiresInDays}
          onChange={(e) => setExpiresInDays(e.target.value)}
          className={
            'w-full px-3.5 py-2.5 bg-white border-2 border-ink rounded text-[14px] text-ink ' +
            'shadow-[2px_2px_0_0_#1C1917] ' +
            'focus:outline-none focus:translate-x-[1px] focus:translate-y-[1px] focus:shadow-[1px_1px_0_0_#1C1917] ' +
            'transition-all'
          }
        >
          <option value="">永久不过期（默认）</option>
          <option value="30">30 天</option>
          <option value="7">7 天</option>
          <option value="1">24 小时</option>
        </select>

        {error && (
          <div className="mt-3 font-mono text-[12px] bg-red-soft text-red-ink border-2 border-ink rounded px-3 py-2">
            {error}
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className={
              'px-4 py-2 bg-white text-ink font-bold text-[13.5px] border-2 border-ink rounded ' +
              'shadow-[2px_2px_0_0_#1C1917] ' +
              'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
              'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
              'transition-all'
            }
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting}
            className={
              'px-4 py-2 bg-ink text-white font-bold text-[13.5px] border-2 border-ink rounded ' +
              'shadow-[2px_2px_0_0_#E8692A] ' +
              'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#E8692A] ' +
              'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#E8692A] ' +
              'disabled:opacity-50 disabled:cursor-not-allowed ' +
              'transition-all'
            }
          >
            {submitting ? '创建中…' : '创建'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/**
 * Stage 2: one-shot reveal with a hard "I've saved it" gate. Dismissing
 * the modal commits the plaintext to localStorage cache (per-email,
 * per-keyId) — that's the ONLY moment we write the plaintext locally.
 * Once closed, the user can never see this value again from our UI.
 *
 * No × button, no backdrop close, no ESC — the ack button is the only
 * exit. Clipboard copy is a separate action; ack writes cache + closes.
 */
export function RevealKeyModal({
  open,
  onClose,
  created,
  email,
}: {
  open: boolean;
  onClose: () => void;
  created: CreatedProxyKey | null;
  email: string | undefined;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCopied(false);
  }, [open]);

  if (!created) return null;

  async function handleCopy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can long-press to select */
    }
  }

  function handleAcknowledge() {
    if (created && email) {
      // The single moment we commit plaintext to localStorage. Subsequent
      // reads (Dashboard install spell) come from this cache only.
      setCachedKey(email, String(created.keyId), created.key);
    } else if (created && !email) {
      // Shouldn't happen — the modal only opens after createKey succeeded
      // under an authed session. If we get here it means an upstream
      // caller forgot to thread `user.email` down. Stay loud rather than
      // silently produce a key the user thinks is cached but isn't.
      console.warn(
        '[RevealKeyModal] handleAcknowledge: missing email — skipping cache write. ' +
          'The plaintext will be lost when this modal closes.',
      );
    }
    onClose();
  }

  return (
    <StickyModalShell open={open} tag="CREATED" title="API Key 已创建">
      <div className="bg-bg border-2 border-ink rounded-md p-3 mb-4">
        <div className="font-mono text-[12px] text-ink [word-break:break-all] leading-snug">
          {created.key}
        </div>
      </div>

      <button
        type="button"
        onClick={handleCopy}
        className={
          'w-full px-4 py-2.5 bg-ink text-white font-bold text-[13.5px] border-2 border-ink rounded ' +
          'shadow-[3px_3px_0_0_#E8692A] flex items-center justify-center gap-2 ' +
          'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#E8692A] ' +
          'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#E8692A] ' +
          'transition-all'
        }
      >
        {copied ? '已复制 ✓' : '复制 API Key'}
      </button>

      <div className="mt-4 border-2 border-ink rounded-md bg-amber-50 p-3 space-y-2">
        <div className="text-[12.5px] font-bold text-ink leading-snug">
          ⚠️ 立即保存这个 Key
        </div>
        <div className="text-[12px] text-[#6B5E52] leading-relaxed">
          此 Key 仅显示这一次。关闭后将永远无法再次查看。
        </div>
        <div className="text-[12.5px] font-bold text-ink leading-snug pt-1">
          💾 缓存在这台设备
        </div>
        <div className="text-[12px] text-[#6B5E52] leading-relaxed">
          我们会把这个 Key 缓存在浏览器 localStorage 里，让 Dashboard 的安装咒语继续可用。
          退出登录、清除浏览器数据或换设备时，缓存就消失 —— 届时唯一的办法是创建一个新 Key。
        </div>
      </div>

      <div className="mt-5">
        <button
          type="button"
          onClick={handleAcknowledge}
          className={
            'w-full px-4 py-2.5 bg-white text-ink font-bold text-[13.5px] border-2 border-ink rounded ' +
            'shadow-[2px_2px_0_0_#1C1917] ' +
            'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
            'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
            'transition-all'
          }
        >
          我已保存好，关闭
        </button>
      </div>
    </StickyModalShell>
  );
}

/**
 * Stage 3: delete confirm. Replaces the previous window.confirm() call —
 * gives the user a chance to read the consequence (Apps using this key
 * will stop working) without a system dialog yanking their attention.
 */
export function DeleteKeyModal({
  open,
  onClose,
  target,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  target: ProxyKeySummary | null;
  onDeleted: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSubmitting(false);
  }, [open]);

  if (!target) return null;

  async function handleConfirm() {
    if (!target) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.deleteKey(target.keyId);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `吊销失败: ${(err as Error).message}`);
      setSubmitting(false);
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} tag="DELETE" title="吊销这把 Key？">
      <div className="text-[13.5px] text-[#6B5E52] mb-2 leading-relaxed">
        正在使用这把 Key 的 Agent 会立即停止工作 · 无法恢复。
      </div>
      <div className="bg-bg border-2 border-ink rounded-md px-3 py-2 mb-4">
        <div className="font-mono text-[10.5px] tracking-[0.14em] uppercase text-[#A89A8D] font-bold mb-0.5">
          名字
        </div>
        <div className="text-[13.5px] font-bold text-ink truncate">
          {target.label || 'default'}
        </div>
        <div className="font-mono text-[11px] text-[#6B5E52] mt-1 truncate">{target.key}</div>
      </div>

      {error && (
        <div className="mb-3 font-mono text-[12px] bg-red-soft text-red-ink border-2 border-ink rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2.5">
        <button
          type="button"
          onClick={onClose}
          className={
            'px-4 py-2 bg-white text-ink font-bold text-[13.5px] border-2 border-ink rounded ' +
            'shadow-[2px_2px_0_0_#1C1917] ' +
            'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
            'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
            'transition-all'
          }
        >
          取消
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={submitting}
          className={
            'px-4 py-2 bg-red-ink text-white font-bold text-[13.5px] border-2 border-ink rounded ' +
            'shadow-[2px_2px_0_0_#1C1917] ' +
            'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
            'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
            'disabled:opacity-50 disabled:cursor-not-allowed ' +
            'transition-all'
          }
        >
          {submitting ? '吊销中…' : '吊销'}
        </button>
      </div>
    </ModalShell>
  );
}
