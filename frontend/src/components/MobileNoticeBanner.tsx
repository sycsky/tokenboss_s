import { useEffect, useState } from 'react';
import { isMobileLike } from '../lib/checkoutFlow';

/**
 * Mobile-only banner shown on `/install/manual`. CC Switch is a desktop
 * app (Mac/Win/Linux), so the import grid below can't actually complete on
 * phones — `ccswitch://` URLs have no OS handler there.
 *
 * Rather than hard-blocking, we keep the page readable and offer the user a
 * one-tap "copy this URL" affordance so they can pick it up on their PC.
 * Logged-in users will find /install/manual again via the TopNav 接入 link
 * once they reach the desktop.
 */

const PC_URL = 'https://www.tokenboss.co/install/manual';

export function MobileNoticeBanner() {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);

  // Detect after mount so SSR / hydration is stable and the matchMedia
  // result is read in the browser.
  useEffect(() => {
    setShow(isMobileLike());
  }, []);

  if (!show) return null;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(PC_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be blocked in WeChat / in-app browsers — fall
      // back to a manual select prompt so the user still gets the URL.
      window.prompt('复制下面的网址，在电脑上打开：', PC_URL);
    }
  }

  return (
    <div
      role="status"
      className="border-2 border-ink rounded-md p-4 bg-amber-50 shadow-[3px_3px_0_0_#1C1917]"
    >
      <h2 className="text-[15px] font-bold text-ink mb-1.5">
        CC Switch 是桌面 App · 请在电脑上完成
      </h2>
      <p className="text-[13px] text-text-secondary leading-relaxed mb-3">
        CC Switch 只有 Mac / Windows / Linux 版本，手机上没法接受一键导入。
        建议把下面的网址复制到电脑浏览器打开，登录同一个账号即可继续。
      </p>
      <div className="flex flex-wrap items-center gap-2.5">
        <code className="font-mono text-[12px] text-ink bg-white border-2 border-ink rounded px-2.5 py-1.5 break-all flex-1 min-w-0">
          {PC_URL}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          className="flex-shrink-0 inline-flex items-center font-semibold text-[13px] bg-ink text-white px-4 py-2 rounded border-2 border-ink shadow-[2px_2px_0_0_#E8692A] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#E8692A] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"
        >
          {copied ? '已复制 ✓' : '复制网址'}
        </button>
      </div>
    </div>
  );
}
