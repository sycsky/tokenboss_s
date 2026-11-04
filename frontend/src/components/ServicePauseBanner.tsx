import { Link, useLocation } from 'react-router-dom';
import { REFUND_EMAIL, SERVICE_NOTICE_PATH, SERVICE_PAUSE_ENABLED, SERVICE_STOP_LABEL, useServicePauseStatus } from '../lib/servicePause';

export function ServicePauseBanner() {
  const { pathname } = useLocation();
  const hasStopped = useServicePauseStatus();
  if (!SERVICE_PAUSE_ENABLED) return null;
  return (
    <aside aria-label="服务暂停公告" className="bg-warning-subtle border-b-2 border-ink text-ink">
      <div className="max-w-[1200px] mx-auto px-5 sm:px-9 py-4 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-5">
        <span className="self-start shrink-0 bg-yellow-stamp border border-ink rounded px-2 py-1 text-[11px] font-bold">服务暂停公告</span>
        <div className="text-[14px] leading-[1.8]">
          <p>TokenBoss {hasStopped ? '已于' : '将于'} <strong><span className="whitespace-nowrap">{SERVICE_STOP_LABEL}</span><span className="whitespace-nowrap">（北京时间）</span></strong>暂停服务。</p>
          <p className="text-[13px] text-[#65512B]">
            网站已关闭注册、登录及新增充值入口。
            {pathname === '/' && <>退款申请请联系 <a className="underline whitespace-nowrap" href={`mailto:${REFUND_EMAIL}`}>{REFUND_EMAIL}</a>。</>}
            {' '}<Link className="font-semibold underline underline-offset-4 whitespace-nowrap" to={SERVICE_NOTICE_PATH}>停服说明 →</Link>
          </p>
        </div>
      </div>
    </aside>
  );
}
