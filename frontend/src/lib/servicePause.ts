import { useEffect, useState } from 'react';

// Frontend presentation only. This does not disable backend APIs or API keys.
export const SERVICE_PAUSE_ENABLED = true;
export const SERVICE_NOTICE_PATH = '/service-notice';
export const SERVICE_STOPS_AT = '2026-12-16T00:00:00+08:00';
export const SERVICE_CUTOFF_MS = Date.parse(SERVICE_STOPS_AT);
export const SERVICE_STOP_LABEL = '2026 年 12 月 16 日 00:00';
export const REFUND_EMAIL = 'shawn@tokenboss.co';
export const REFUND_MAILTO = `mailto:${REFUND_EMAIL}?subject=${encodeURIComponent('TokenBoss 退款申请')}&body=${encodeURIComponent('TokenBoss 登录邮箱：\n联系微信：\n')}`;

/** Refresh even if a visitor keeps a tab open across the announced time. */
export function useServicePauseStatus(): boolean {
  const [hasStopped, setHasStopped] = useState(() => Date.now() >= SERVICE_CUTOFF_MS);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const remaining = SERVICE_CUTOFF_MS - Date.now();
      setHasStopped(remaining <= 0);
      if (remaining > 0) timer = setTimeout(refresh, Math.min(remaining, 60_000));
    };
    refresh();
    document.addEventListener('visibilitychange', refresh);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  return hasStopped;
}
