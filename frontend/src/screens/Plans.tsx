import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { TierCard } from '../components/TierCard';
import { SectionHeader } from '../components/SectionHeader';

export default function Plans() {
  const { user } = useAuth();
  const isLoggedIn = !!user;
  const ctaText = isLoggedIn ? '联系客服开通' : '免费注册试用 →';
  const ctaUltra = isLoggedIn ? '名额已满' : '免费注册试用 →';

  return (
    <div className="min-h-screen bg-bg">
      {/* Top nav */}
      <nav className="px-9 py-4 flex items-center justify-between border-b border-border max-w-[1200px] mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-accent rounded-md flex items-center justify-center text-white font-mono text-[10px] font-bold">TB</div>
          <span className="font-bold">TokenBoss</span>
        </div>
        <div className="flex gap-6 text-[13px]">
          {isLoggedIn && <Link to="/dashboard" className="text-ink-2">控制台</Link>}
          <span className="text-ink font-semibold">套餐</span>
        </div>
        <div className="flex items-center gap-4">
          {isLoggedIn ? (
            <span className="text-[13px] text-ink-3">{user.email}</span>
          ) : (
            <>
              <Link to="/login" className="text-[13px] text-ink-2">登录</Link>
              <Link to="/register" className="px-4 py-1.5 bg-accent text-white rounded-lg text-[12.5px] font-semibold">免费开始 →</Link>
            </>
          )}
        </div>
      </nav>

      <main className="max-w-[1080px] mx-auto px-6 md:px-14 py-12 md:py-20">
        {/* Hero */}
        <h1 className="font-sans text-[44px] md:text-[64px] font-extrabold leading-none tracking-tight mb-5">
          用 ¥ 付，<br />
          按 <span className="text-ink-3 opacity-30">$</span> 算
        </h1>
        <div className="w-14 h-px bg-ink mb-7" />
        <p className="text-base text-ink-2 mb-16 max-w-md italic font-light">
          用人民币付款，按美金额度计费。新用户登录就送 <span className="font-semibold text-ink not-italic">$10 / 24h</span> 试用。
        </p>

        {/* 01 Standard */}
        <SectionHeader num="01" cn="标准价" en="Pay as you go" size="lg" className="mb-5" />
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-7 border border-hairline rounded-xl mb-16">
          <div>
            <div className="font-mono text-3xl font-bold">
              <span className="text-base text-ink-2 align-top">¥</span>1 <span className="text-ink-4 mx-2">/</span> <span className="text-base text-ink-2 align-top">$</span>1 美金
            </div>
            <div className="text-sm text-ink-3 mt-1">充值 ¥50 起 · 永不过期 · 全模型解锁</div>
          </div>
          <a className="px-5 py-2.5 bg-surface border border-border-2 rounded-lg text-sm font-semibold whitespace-nowrap">
            联系客服充值
          </a>
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
            ctaText={ctaText}
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
            ctaText={ctaText}
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
            ctaText={ctaUltra}
            ctaVariant={isLoggedIn ? 'disabled' : 'secondary'}
            soldOut={isLoggedIn}
            tooltipExtras={['含 reasoning (o1/o3) · 专属客服 · SLA · 定制路由策略']}
          />
        </div>
      </main>
    </div>
  );
}
