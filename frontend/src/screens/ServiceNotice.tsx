import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BrandPlate } from '../components/TopNav';
import { REFUND_EMAIL, REFUND_MAILTO, SERVICE_STOP_LABEL, useServicePauseStatus } from '../lib/servicePause';
import { slockBtn } from '../lib/slockBtn';
import { useDocumentMeta } from '../lib/useDocumentMeta';

export default function ServiceNotice() {
  const hasStopped = useServicePauseStatus();
  const [copyStatus, setCopyStatus] = useState('');
  useDocumentMeta({ title: '服务暂停与退款说明 · TokenBoss', description: `TokenBoss 将于 ${SERVICE_STOP_LABEL}（北京时间）暂停服务。退款申请请联系 ${REFUND_EMAIL}，提供登录邮箱及联系微信。` });
  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(REFUND_EMAIL);
      setCopyStatus('邮箱已复制，可粘贴到您常用的邮件应用。');
    } catch {
      setCopyStatus('请选中或长按上方邮箱，手动复制。');
    }
  }
  return (
    <div className="min-h-[70vh] bg-bg px-5 sm:px-9 py-8 sm:py-12">
      <main className="max-w-[640px] mx-auto">
        <div className="mb-8"><BrandPlate /></div>
        <h1 className="text-[26px] sm:text-[32px] leading-tight font-bold tracking-tight mb-3">服务暂停与退款说明</h1>
        <p className="text-[14px] text-text-secondary leading-relaxed mb-6">感谢您使用 TokenBoss，以下是本次服务暂停安排。</p>
        <section aria-label="停服时间" className="bg-warning-subtle border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917] px-5 sm:px-6 py-5 mb-7">
          <p className="text-[12px] font-bold text-yellow-stamp-ink mb-3">{hasStopped ? '已暂停服务' : '服务暂停时间'}</p>
          <p className="font-mono font-bold text-[23px] sm:text-[30px] leading-relaxed">2026 年 12 月 16 日<br />00:00</p>
          <p className="text-[12px] text-yellow-stamp-ink mt-2">北京时间 · UTC+8</p>
        </section>
        <p className="text-[14px] leading-[1.9] mb-7">
          网站已关闭注册、登录及新增充值入口。
          {!hasStopped && <>已有 API Key 可在停服前按现有余额及服务规则继续使用。</>}
          网站将继续保留，供您查看公告及退款联系方式。
        </p>
        <section aria-labelledby="refund-heading" className="bg-white border-2 border-ink rounded-md shadow-[4px_4px_0_0_#1C1917] p-5 sm:p-7">
          <h2 id="refund-heading" className="text-[22px] font-bold mb-2">退款申请</h2>
          <p className="text-[14px] text-text-secondary mb-3">有退款需求的用户，请发送邮件至：</p>
          <a className="block w-fit text-[21px] sm:text-[23px] font-mono font-bold underline underline-offset-4 break-all mb-5" href={REFUND_MAILTO}>{REFUND_EMAIL}</a>
          <div className="bg-bg rounded px-4 py-4 text-[14px] leading-[1.9] mb-5">
            <p className="mb-1">请在邮件中提供以下信息：</p>
            <ol className="list-decimal pl-5"><li>您的 TokenBoss 登录邮箱</li><li>您的联系微信</li></ol>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 mb-5">
            <a href={REFUND_MAILTO} className={slockBtn('primary') + ' text-center'}>发送退款申请邮件</a>
            <button type="button" className={slockBtn('secondary')} onClick={copyEmail}>复制邮箱</button>
          </div>
          <p className="text-[12px] text-text-secondary leading-relaxed">我们将后续联系核实并处理。提交申请无需登录网站。</p>
          <p role="status" aria-live="polite" className="text-[12px] text-text-secondary mt-3">{copyStatus}</p>
        </section>
        <Link to="/" className="block text-center text-[13px] text-text-secondary underline underline-offset-4 mt-7">← 返回首页</Link>
      </main>
    </div>
  );
}
