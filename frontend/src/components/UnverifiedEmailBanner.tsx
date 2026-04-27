import { useState } from 'react';
import { useAuth } from '../lib/auth';

/**
 * Slock-pixel banner shown at the top of authenticated pages when the
 * user hasn't clicked the verification link yet. Sticks around quietly —
 * the unverified state isn't blocking, just a nudge with a one-click
 * "重新发送" button.
 */
export function UnverifiedEmailBanner({ email }: { email: string }) {
  const { resendVerification } = useAuth();
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error' | 'rate-limited'>('idle');

  async function handleResend() {
    setState('sending');
    try {
      await resendVerification();
      setState('sent');
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      setState(code === 'too_soon' || code === 'hourly_limit' ? 'rate-limited' : 'error');
    }
  }

  const cta =
    state === 'sending'
      ? '发送中…'
      : state === 'sent'
        ? '已发送 ✓'
        : state === 'error'
          ? '重试'
          : state === 'rate-limited'
            ? '请稍后再试'
            : '重新发送';

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 bg-[#FEF3C7] border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917]"
      role="status"
    >
      <span aria-hidden="true" className="flex-shrink-0 inline-flex items-center justify-center w-7 h-7 bg-warning border-2 border-ink rounded text-white">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="1.5" />
          <path d="M3 7l9 6 9-6" />
        </svg>
      </span>
      <div className="flex-1 text-[13px] leading-snug">
        <span className="font-bold text-ink">邮箱待验证</span>
        <span className="text-[#6B5E52]"> · 我们已把验证链接发到 </span>
        <span className="font-mono font-semibold text-ink break-all">{email}</span>
        <span className="text-[#6B5E52]">，链接 24 小时内有效。</span>
      </div>
      <button
        type="button"
        onClick={handleResend}
        disabled={state === 'sending' || state === 'sent' || state === 'rate-limited'}
        className="flex-shrink-0 px-3 py-1.5 bg-white border-2 border-ink rounded text-[12px] font-bold tracking-tight shadow-[2px_2px_0_0_#1C1917] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] disabled:opacity-50 disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-[2px_2px_0_0_#1C1917] disabled:cursor-not-allowed transition-all whitespace-nowrap"
      >
        {cta}
      </button>
    </div>
  );
}
