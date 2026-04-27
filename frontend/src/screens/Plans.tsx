import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { TierCard } from '../components/TierCard';
import { SectionHeader } from '../components/SectionHeader';
import { TopNav } from '../components/TopNav';

export default function Plans() {
  const { user } = useAuth();
  const isLoggedIn = !!user;
  const navigate = useNavigate();
  const goRegister = () => navigate('/register');

  const tierCta = isLoggedIn
    ? { text: '联系客服购买', onClick: undefined }
    : { text: '免费开始 →', onClick: goRegister };
  const ultraCta = isLoggedIn
    ? { text: '名额已满', onClick: undefined, variant: 'disabled' as const, soldOut: true }
    : { text: '免费开始 →', onClick: goRegister, variant: 'secondary' as const, soldOut: false };
  const standardCta = isLoggedIn
    ? { text: '联系客服充值', onClick: undefined }
    : { text: '免费开始 →', onClick: goRegister };

  return (
    <div className="min-h-screen bg-bg">
      <TopNav />

      <main className="max-w-[1080px] mx-auto px-6 md:px-14 py-12 md:py-20">
        {/* Hero — Slock-pixel eyebrow + bold one-line h1 */}
        <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-ink-3 mb-3 font-bold">
          PRICING · 套餐
        </div>
        <h1 className="font-sans text-[40px] md:text-[56px] font-extrabold leading-[1.05] tracking-tight mb-5">
          一份钱，多个 Agent 共用。
        </h1>
        <p className="text-[15px] text-text-secondary mb-10 max-w-[560px] leading-relaxed">
          人民币付款，按美金额度计费。新用户登录就送
          <span className="mx-1.5 inline-flex items-baseline gap-1 px-2 py-0.5 bg-lime-stamp border-2 border-ink rounded font-mono text-[12px] font-bold text-lime-stamp-ink">
            $10 / 24h
          </span>
          试用。
        </p>

        {/* 01 Standard — Slock-pixel pay-as-you-go */}
        <SectionHeader num="01" cn="标准价" en="Pay as you go" size="lg" className="mb-5" />
        <div
          className={
            'flex flex-col md:flex-row md:items-center md:justify-between gap-5 ' +
            'p-6 md:p-7 mb-14 ' +
            'bg-surface border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917]'
          }
        >
          <div>
            <div className="font-mono text-[28px] md:text-[32px] font-bold leading-none text-ink mb-2">
              <span className="text-[16px] text-ink-3 align-top mr-px">¥</span>1
              <span className="text-ink-4 mx-2.5 font-medium">=</span>
              <span className="text-[16px] text-ink-3 align-top mr-px">$</span>1
              <span className="text-[14px] text-ink-3 ml-2 font-medium">美金额度</span>
            </div>
            <div className="font-mono text-[12px] text-ink-3 tracking-tight">
              充值 ¥50 起 · 永不过期 · 全模型解锁
            </div>
          </div>
          {standardCta.onClick ? (
            <button
              onClick={standardCta.onClick}
              className={
                'px-5 py-2.5 bg-bg border-2 border-ink rounded-md text-[14px] font-bold text-ink ' +
                'shadow-[3px_3px_0_0_#1C1917] whitespace-nowrap ' +
                'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
                'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
                'transition-all'
              }
            >
              {standardCta.text}
            </button>
          ) : (
            <span className="px-5 py-2.5 bg-bg border-2 border-ink rounded-md text-[14px] font-bold text-ink-3 whitespace-nowrap shadow-[3px_3px_0_0_#1C1917]">
              {standardCta.text}
            </span>
          )}
        </div>

        {/* 02 Membership */}
        <SectionHeader num="02" cn="套餐" en="Membership" size="lg" className="mb-5" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <TierCard
            name="Plus"
            pricePeriod="¥288 / 4 周"
            leverage="×3"
            totalUsd="≈ $840 美金额度"
            dailyCap="$30 美金 cap"
            models="Codex 系列模型"
            ctaText={tierCta.text}
            onCtaClick={tierCta.onClick}
            ctaVariant="secondary"
            tooltipExtras={['智能路由 · 多端复用 · API key 多端共享']}
          />
          <TierCard
            name="Super"
            pricePeriod="¥688 / 4 周"
            leverage="×4"
            totalUsd="≈ $2,240 美金额度"
            dailyCap="$80 美金 cap"
            models="Claude + Codex 系列模型"
            ctaText={tierCta.text}
            onCtaClick={tierCta.onClick}
            ctaVariant="primary"
            featured
            tooltipExtras={['含 Sonnet 4.7 / Opus 4.7 · 优先排队 · 高峰不降级']}
          />
          <TierCard
            name="Ultra"
            pricePeriod="¥1688 / 4 周"
            leverage="×12"
            totalUsd="≈ $20,160 美金额度"
            dailyCap="$720 美金 cap"
            models="Claude + Codex + reasoning"
            ctaText={ultraCta.text}
            onCtaClick={ultraCta.onClick}
            ctaVariant={ultraCta.variant}
            soldOut={ultraCta.soldOut}
            tooltipExtras={['含 reasoning (o1/o3) · 专属客服 · SLA · 定制路由策略']}
          />
        </div>

        {/* Footer note */}
        <div className="mt-12 font-mono text-[11.5px] text-ink-3 tracking-tight max-w-[560px]">
          所有套餐含 24h 内不满意全额退款 · 套餐到期前 3 天提醒 · 不自动续费
        </div>
      </main>
    </div>
  );
}
