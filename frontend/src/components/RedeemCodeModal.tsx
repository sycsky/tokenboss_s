import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';

export interface RedeemCodeModalProps {
  open: boolean;
  onClose: () => void;
  /** Optional callback fired after a successful redeem — useful when the
   *  parent screen wants to refetch buckets / balance to reflect the new
   *  quota immediately (Settings does this so the Dashboard hero is fresh
   *  by the time the user clicks "回到 Dashboard"). */
  onSuccess?: (usdAdded: number) => void;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; usdAdded: number }
  | { kind: 'error'; message: string };

/**
 * Slock-pixel modal for entering a redemption code (兑换码) and seeing
 * the result inline. Three phases:
 *   - idle       : code input + 兑换 button
 *   - submitting : button shows spinner state
 *   - success    : green stamp + "$X 已添加" + "回到 Dashboard" CTA
 *   - error      : red stamp + verbatim newapi error (Chinese, friendly)
 *
 * Entry surface: Settings → "兑换码" Row. Could be wired anywhere later
 * (Dashboard, Plans, etc.) without modal-internal changes.
 */
export function RedeemCodeModal({ open, onClose, onSuccess }: RedeemCodeModalProps) {
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Lock body scroll + ESC-to-close + autofocus the input.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // Defer autofocus until after the dialog mounts.
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [open, onClose]);

  // Reset phase + code each time the modal re-opens, so a previous
  // success/error doesn't haunt a fresh attempt.
  useEffect(() => {
    if (open) {
      setCode('');
      setPhase({ kind: 'idle' });
    }
  }, [open]);

  if (!open) return null;

  const trimmed = code.trim();
  const canSubmit = trimmed.length > 0 && phase.kind !== 'submitting';

  async function submit() {
    if (!canSubmit) return;
    setPhase({ kind: 'submitting' });
    try {
      const res = await api.redeemCode(trimmed);
      setPhase({ kind: 'success', usdAdded: res.usdAdded });
      onSuccess?.(res.usdAdded);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : (err as Error)?.message ?? '兑换失败，稍后再试';
      setPhase({ kind: 'error', message: msg });
    }
  }

  function onKeyDownInput(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') submit();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="redeem-modal-title"
    >
      <div
        className="absolute inset-0 bg-ink/55"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative bg-white border-2 border-ink rounded-lg shadow-[6px_6px_0_0_#1C1917] max-w-[440px] w-full p-6">
        <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[#A89A8D] font-bold mb-2">
          REDEEM · 兑换码
        </div>
        <h2
          id="redeem-modal-title"
          className="text-[22px] font-bold tracking-tight text-ink mb-2 leading-tight"
        >
          {phase.kind === 'success' ? '兑换成功' : '使用兑换码'}
        </h2>

        {phase.kind === 'success' ? (
          <SuccessView usdAdded={phase.usdAdded} onClose={onClose} />
        ) : (
          <>
            <p className="text-[13.5px] text-[#6B5E52] mb-4 leading-relaxed">
              输入朋友 / 渠道给你的兑换码，额度直接到账。
            </p>
            <input
              ref={inputRef}
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={onKeyDownInput}
              placeholder="例如  fd64f3baedda4e0898fd324a73ebbb21"
              spellCheck={false}
              autoCapitalize="none"
              autoComplete="off"
              className={
                'w-full px-3 py-2.5 bg-bg border-2 border-ink rounded-md ' +
                'font-mono text-[14px] text-ink placeholder:text-ink-3 ' +
                'focus:outline-none focus:shadow-[3px_3px_0_0_#1C1917] transition-shadow'
              }
            />

            {phase.kind === 'error' && (
              <div className="mt-3 p-3 border-2 border-red-600 rounded-md bg-red-50 font-mono text-[12px] text-red-700 leading-relaxed">
                {phase.message}
              </div>
            )}

            <div className="flex items-center gap-3 mt-5">
              <button
                type="button"
                onClick={onClose}
                className="font-mono text-[12.5px] text-ink-2 hover:text-ink underline underline-offset-4 decoration-2"
              >
                取消
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                className={
                  'ml-auto px-5 py-2.5 bg-ink text-white font-bold text-[13.5px] ' +
                  'border-2 border-ink rounded-md shadow-[3px_3px_0_0_#E8692A] ' +
                  (canSubmit
                    ? 'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#E8692A] ' +
                      'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#E8692A] transition-all'
                    : 'opacity-60 cursor-not-allowed')
                }
              >
                {phase.kind === 'submitting' ? '兑换中…' : '兑换 →'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SuccessView({
  usdAdded,
  onClose,
}: {
  usdAdded: number;
  onClose: () => void;
}) {
  return (
    <>
      <p className="text-[14px] text-ink mb-4 leading-relaxed">
        已添加{' '}
        <span className="font-mono font-bold text-accent">${usdAdded.toFixed(4)}</span>{' '}
        调用额度到你的账户。
      </p>
      <div className="bg-lime-stamp border-2 border-ink rounded-md p-3 mb-5">
        <div className="font-mono text-[10.5px] tracking-[0.16em] uppercase text-lime-stamp-ink font-bold">
          ✓ 已到账
        </div>
        <div className="font-mono text-[11.5px] text-ink-2 mt-0.5">
          余额会在 Dashboard 实时更新
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-[12.5px] text-ink-2 hover:text-ink underline underline-offset-4 decoration-2"
        >
          继续兑换
        </button>
        <Link
          to="/console"
          onClick={onClose}
          className={
            'ml-auto px-5 py-2.5 bg-ink text-white font-bold text-[13.5px] ' +
            'border-2 border-ink rounded-md shadow-[3px_3px_0_0_#E8692A] ' +
            'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#E8692A] ' +
            'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#E8692A] ' +
            'transition-all'
          }
        >
          回到 Dashboard →
        </Link>
      </div>
    </>
  );
}
