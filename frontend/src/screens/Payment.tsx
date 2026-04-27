import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AppNav } from '../components/AppNav';

const card = 'bg-white border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917]';

export default function Payment() {
  const loc = useLocation();
  const plan = (loc.state as { plan?: string } | null)?.plan;
  const wechatId = 'tokenboss_admin';

  const [copied, setCopied] = useState(false);

  async function copyWechat() {
    try {
      await navigator.clipboard.writeText(wechatId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can copy manually */
    }
  }

  return (
    <div className="min-h-screen bg-bg pb-12">
      <AppNav current="console" />

      <main className="max-w-[680px] mx-auto px-5 sm:px-9 pt-6">
        <div className="font-mono text-[11px] tracking-[0.06em] text-[#A89A8D] mb-4">
          <Link to="/console" className="hover:text-ink transition-colors">控制台</Link>
          <span className="mx-2 text-[#D9CEC2]">/</span>
          <Link to="/pricing" className="hover:text-ink transition-colors">套餐</Link>
          <span className="mx-2 text-[#D9CEC2]">/</span>
          <span className="text-ink-2">开通</span>
        </div>

        <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[#A89A8D] mb-2 font-bold flex items-center gap-2">
          <span className="bg-yellow-stamp text-yellow-stamp-ink border-2 border-ink rounded px-1.5 py-0.5 tracking-[0.12em]">
            v1.0
          </span>
          <span>BILLING · 开通</span>
        </div>
        <h1 className="text-[36px] md:text-[44px] font-bold tracking-tight leading-[1.05] mb-3">
          {plan ? `${plan} 我们手动给你开通。` : '套餐我们手动给你开通。'}
        </h1>
        <p className="text-[14px] text-text-secondary mb-9 max-w-[520px] leading-relaxed">
          v1.0 还没接入自助支付。加客服微信，把你的注册邮箱和想买的套餐告诉他——
          <span className="text-ink font-semibold">2 小时内</span>开通到账。
        </p>

        {/* Contact card */}
        <section className={`${card} p-6 mb-6`}>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-4">
            客服微信
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-6">
            {/* QR placeholder */}
            <div className="w-40 h-40 bg-bg border-2 border-dashed border-ink rounded-md flex items-center justify-center font-mono text-[10.5px] text-[#A89A8D] flex-shrink-0">
              [QR · 上线后替换]
            </div>
            <div className="flex-1 w-full">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#A89A8D] mb-1.5">
                微信 ID
              </div>
              <div className="font-mono text-[18px] text-ink font-bold mb-3 break-all">
                {wechatId}
              </div>
              <button
                onClick={copyWechat}
                className={
                  'inline-flex items-center px-4 py-2 bg-ink text-bg border-2 border-ink rounded text-[13px] font-bold ' +
                  'shadow-[2px_2px_0_0_#1C1917] ' +
                  'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
                  'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
                  'transition-all'
                }
              >
                {copied ? '已复制 ✓' : '复制微信号'}
              </button>
            </div>
          </div>
        </section>

        {/* What to send */}
        <section className={`${card} p-6 mb-9`}>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-3">
            发给客服时带这些
          </div>
          <ul className="space-y-2 text-[13.5px] text-text-secondary leading-relaxed">
            <Bullet>你的注册邮箱（控制台右上角 avatar 看得到）</Bullet>
            <Bullet>{plan ? `想买的套餐：${plan}` : '想买的套餐（Plus / Super / Ultra / 标准充值）'}</Bullet>
            <Bullet>付款偏好（微信 / 支付宝）</Bullet>
          </ul>
        </section>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <Link
            to="/console"
            className="font-mono text-[12.5px] text-ink-2 hover:text-ink underline underline-offset-4 decoration-2"
          >
            ← 返回控制台
          </Link>
          <Link
            to="/pricing"
            className="font-mono text-[12.5px] text-ink-2 hover:text-ink underline underline-offset-4 decoration-2"
          >
            重新选套餐 →
          </Link>
        </div>
      </main>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="font-mono text-accent font-bold flex-shrink-0 leading-snug">·</span>
      <span>{children}</span>
    </li>
  );
}
