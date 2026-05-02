import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, type CreatedProxyKey, type ProxyKeySummary } from '../lib/api';
import { setCachedKey } from '../lib/keyCache';
import { KeyRow, type KeyStats } from './APIKeyList';
import { isExpired } from '../lib/keyExpiry';

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
 * Slock-pixel dropdown for the 有效期 picker. Replaces a native `<select>`
 * so the OPEN state matches the rest of the modal (the OS-rendered dropdown
 * panel can't be styled). Click-outside and Escape close the panel; clicking
 * an option commits the value and closes.
 */
const EXPIRY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: '永久不过期（默认）' },
  { value: '30', label: '30 天' },
  { value: '7', label: '7 天' },
  { value: '1', label: '24 小时' },
];

function ExpirySelect({
  value,
  onChange,
  labelledBy,
}: {
  value: string;
  onChange: (next: string) => void;
  labelledBy: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const current =
    EXPIRY_OPTIONS.find((o) => o.value === value) ?? EXPIRY_OPTIONS[0];

  // Close on click-outside + Escape.
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={labelledBy}
        className={
          'w-full flex items-center justify-between gap-2 px-3.5 py-2.5 bg-white border-2 border-ink rounded text-[14px] text-ink ' +
          'shadow-[2px_2px_0_0_#1C1917] ' +
          'focus:outline-none focus:translate-x-[1px] focus:translate-y-[1px] focus:shadow-[1px_1px_0_0_#1C1917] ' +
          'transition-all'
        }
      >
        <span className="truncate">{current.label}</span>
        <span aria-hidden="true" className={'text-[12px] text-[#A89A8D] transition-transform ' + (open ? 'rotate-180' : '')}>
          ▾
        </span>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-labelledby={labelledBy}
          className="absolute left-0 right-0 mt-1.5 z-10 bg-white border-2 border-ink rounded shadow-[3px_3px_0_0_#1C1917] overflow-hidden"
        >
          {EXPIRY_OPTIONS.map((opt) => {
            const selected = opt.value === current.value;
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={
                    'w-full flex items-center gap-2 text-left px-3.5 py-2.5 text-[14px] text-ink transition-colors ' +
                    (selected ? 'bg-bg font-bold' : 'hover:bg-bg')
                  }
                >
                  <span aria-hidden="true" className={'w-3 inline-block ' + (selected ? 'text-accent' : 'text-transparent')}>
                    ✓
                  </span>
                  <span className="truncate">{opt.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
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

        <div id="key-expires-label" className="block font-mono text-[10.5px] tracking-[0.16em] uppercase text-[#A89A8D] font-bold mt-4 mb-2">
          有效期
        </div>
        <ExpirySelect
          value={expiresInDays}
          onChange={setExpiresInDays}
          labelledBy="key-expires-label"
        />

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
 * exit. The acknowledge button is itself disabled until the user has
 * copied something at least once (prevents misclick-and-lose-key).
 *
 * Two copy options:
 *   - 复制 API Key — just the bare `sk-…` value
 *   - 复制完整安装命令 — both lines of the Dashboard install spell, ready
 *     to paste into an Agent's chat to bootstrap the client
 */
const SPELL_CMD = 'set up tokenboss.co/skill.md';

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
  const [copiedTarget, setCopiedTarget] = useState<'key' | 'cmd' | null>(null);
  const [everCopied, setEverCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCopiedTarget(null);
    setEverCopied(false);
  }, [open]);

  if (!created) return null;

  async function handleCopy(target: 'key' | 'cmd') {
    if (!created) return;
    const text =
      target === 'key'
        ? created.key
        : `${SPELL_CMD}\nTOKENBOSS_API_KEY=${created.key}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTarget(target);
      setEverCopied(true);
      setTimeout(
        () => setCopiedTarget((t) => (t === target ? null : t)),
        1500,
      );
    } catch {
      /* clipboard blocked — user can long-press to select on mobile */
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
      {/* The most-prominent message. Action-verb title so users see WHAT
          to do (copy + save) before glancing at the value box. The amber
          background + bold title carry the warning visual — no emoji
          needed (the colorful ⚠️ glyph clashed with the slock aesthetic). */}
      <div className="border-2 border-ink rounded-md bg-amber-50 p-3.5 mb-4">
        <div className="text-[15.5px] font-bold text-ink leading-snug mb-1">
          立刻复制并保存
        </div>
        <div className="text-[12.5px] text-[#6B5E52] leading-relaxed">
          关闭后无法再次查看 · Key 丢了只能新建一把。
        </div>
      </div>

      {/* Plaintext value box */}
      <div className="bg-bg border-2 border-ink rounded-md p-3 mb-3">
        <div className="font-mono text-[12px] text-ink [word-break:break-all] leading-snug">
          {created.key}
        </div>
      </div>

      {/* Two copy options side by side */}
      <div className="grid grid-cols-2 gap-2 mb-5">
        <button
          type="button"
          onClick={() => handleCopy('key')}
          className={
            'px-3 py-2.5 bg-white text-ink font-bold text-[12.5px] border-2 border-ink rounded ' +
            'shadow-[2px_2px_0_0_#1C1917] ' +
            'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
            'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
            'transition-all'
          }
        >
          {copiedTarget === 'key' ? '已复制 ✓' : '复制 API Key'}
        </button>
        <button
          type="button"
          onClick={() => handleCopy('cmd')}
          className={
            'px-3 py-2.5 bg-ink text-white font-bold text-[12.5px] border-2 border-ink rounded ' +
            'shadow-[2px_2px_0_0_#E8692A] ' +
            'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#E8692A] ' +
            'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#E8692A] ' +
            'transition-all'
          }
        >
          {copiedTarget === 'cmd' ? '已复制 ✓' : '复制完整安装命令'}
        </button>
      </div>

      {/* Acknowledge button — disabled until at least one copy fires.
          Hint below tells the user why it's disabled. */}
      <button
        type="button"
        onClick={handleAcknowledge}
        disabled={!everCopied}
        className={
          'w-full px-4 py-2.5 bg-white text-ink font-bold text-[13.5px] border-2 border-ink rounded ' +
          'shadow-[2px_2px_0_0_#1C1917] ' +
          'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
          'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
          'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-[2px_2px_0_0_#1C1917] ' +
          'transition-all'
        }
      >
        我已保存好，关闭
      </button>
      {!everCopied && (
        <p className="font-mono text-[10.5px] text-[#A89A8D] text-center mt-2">
          请先复制 Key，再关闭
        </p>
      )}
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

/**
 * "All keys" modal — surfaces every key the user has (active + expired
 * + disabled), so they can clean up dead ones without the inline panel
 * needing to scroll. The inline panel (Dashboard) caps at 3 rows and
 * surfaces this modal via the "查看全部 N 把 Key" entry.
 *
 * Body of the modal is the same KeyRow as the inline list — same delete
 * affordance, same cache-aware plaintext display, same dim+strikethrough
 * for dead rows. The modal just gives the list a scrollable container
 * with a count breakdown in the header.
 */
export function AllKeysModal({
  open,
  onClose,
  keys,
  keyStats,
  cachedPlaintexts,
  onDeleteClick,
}: {
  open: boolean;
  onClose: () => void;
  keys: ProxyKeySummary[];
  keyStats: Map<string, KeyStats>;
  cachedPlaintexts: Map<string, string>;
  onDeleteClick: (target: ProxyKeySummary) => void;
}) {
  const liveCount = keys.filter((k) => !k.disabled && !isExpired(k)).length;
  const deadCount = keys.length - liveCount;
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      tag="ALL KEYS"
      title={`所有 API Key (${keys.length})`}
    >
      <p className="font-mono text-[11px] text-[#A89A8D] mb-3">
        {liveCount} 把活跃 · {deadCount} 把已过期或吊销 · 删除任意一把都不可恢复
      </p>
      <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1">
        {keys.map((k, i) => (
          <KeyRow
            key={k.keyId}
            k={k}
            stats={keyStats.get(k.label || 'default')}
            plaintext={cachedPlaintexts.get(String(k.keyId))}
            onDeleteClick={onDeleteClick}
            isLast={i === keys.length - 1}
          />
        ))}
      </div>
    </ModalShell>
  );
}
