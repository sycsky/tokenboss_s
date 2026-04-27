import { useEffect, useState } from 'react';

// v1.0 placeholders — swap when actual sales channels are live.
const WECHAT_ID = 'tokenboss_sales';
const EMAIL = 'sales@tokenboss.com';

export interface ContactSalesModalProps {
  open: boolean;
  onClose: () => void;
  /** What brought the user here — drives the heading + body copy. */
  reason?: 'upgrade' | 'renew' | 'topup' | 'general';
}

/**
 * Contact-sales modal — v1.0 has no self-checkout, so every paid action
 * (upgrade / renew / topup) goes through manual contact. Slock-pixel
 * card centered on a dimmed ink overlay; copy-able WeChat + email rows.
 */
export function ContactSalesModal({ open, onClose, reason = 'general' }: ContactSalesModalProps) {
  // Lock body scroll + ESC-to-close while open.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const tag =
    reason === 'upgrade' ? 'UPGRADE'
    : reason === 'renew' ? 'RENEW'
    : reason === 'topup' ? 'TOPUP'
    : 'CONTACT';
  const heading =
    reason === 'upgrade' ? '升级套餐 · 联系客服'
    : reason === 'renew' ? '续费 · 联系客服'
    : reason === 'topup' ? '充值 · 联系客服'
    : '联系客服';
  const body =
    reason === 'upgrade'
      ? 'v1.0 暂未开放自助升级，加微信或发邮件聊聊你的用量，给你最合适的方案。'
      : reason === 'renew'
        ? 'v1.0 暂未开放自助续费，加微信或发邮件，我们手动给你延期。'
        : reason === 'topup'
          ? 'v1.0 暂未开放自助充值，加微信或发邮件，我们手动加额度。'
          : '加微信或发邮件，我们尽快回你。';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="contact-sales-title"
    >
      <div
        className="absolute inset-0 bg-ink/55"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative bg-white border-2 border-ink rounded-lg shadow-[6px_6px_0_0_#1C1917] max-w-[440px] w-full p-6">
        <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[#A89A8D] font-bold mb-2">
          {tag}
        </div>
        <h2
          id="contact-sales-title"
          className="text-[22px] font-bold tracking-tight text-ink mb-2 leading-tight"
        >
          {heading}
        </h2>
        <p className="text-[13.5px] text-[#6B5E52] mb-5 leading-relaxed">{body}</p>

        <ContactRow label="微信" value={WECHAT_ID} />
        <div className="my-3 border-t-2 border-ink/10" />
        <ContactRow label="邮箱" value={EMAIL} />

        <button
          type="button"
          onClick={onClose}
          className={
            'w-full mt-6 px-4 py-2.5 bg-ink text-white font-bold text-[13.5px] ' +
            'border-2 border-ink rounded-md shadow-[3px_3px_0_0_#E8692A] ' +
            'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#E8692A] ' +
            'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#E8692A] ' +
            'transition-all'
          }
        >
          知道了
        </button>
      </div>
    </div>
  );
}

function ContactRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="font-mono text-[11px] tracking-[0.14em] uppercase text-[#A89A8D] font-bold flex-shrink-0">
        {label}
      </span>
      <button
        type="button"
        onClick={copy}
        className="flex items-center gap-2 min-w-0"
      >
        <span className="font-mono text-[14px] font-bold text-ink truncate">{value}</span>
        <span
          className={
            'font-mono text-[10px] font-bold tracking-[0.14em] uppercase px-2 py-0.5 ' +
            'bg-bg border-2 border-ink rounded shadow-[2px_2px_0_0_#1C1917] flex-shrink-0 ' +
            'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
            'transition-all'
          }
        >
          {copied ? '已复制' : 'COPY'}
        </span>
      </button>
    </div>
  );
}
