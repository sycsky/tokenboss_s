import { Link, useLocation } from 'react-router-dom';
import { REFUND_EMAIL, SERVICE_NOTICE_PATH, SERVICE_PAUSE_ENABLED } from '../lib/servicePause';

export function ServicePauseFooter() {
  const { pathname } = useLocation();
  if (!SERVICE_PAUSE_ENABLED || pathname === '/') return null;
  return (
    <footer className="bg-ink text-white px-5 sm:px-9 py-7">
      <div className="max-w-[1200px] mx-auto flex flex-wrap items-center justify-between gap-4 text-[13px]">
        <span className="font-bold">TokenBoss</span>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link className="underline underline-offset-4" to={SERVICE_NOTICE_PATH}>停服说明</Link>
          <a className="font-mono underline underline-offset-4 break-all" href={`mailto:${REFUND_EMAIL}`}>{REFUND_EMAIL}</a>
        </div>
      </div>
    </footer>
  );
}
