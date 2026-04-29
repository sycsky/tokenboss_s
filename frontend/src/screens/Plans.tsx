import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useCurrency } from '../lib/currency';
import { TIERS, STANDARD_RATE, tierPricePeriod } from '../lib/pricing';
import { ULTRA_DROP, useDailyCountdown } from '../lib/dropSchedule';
import { TierCard } from '../components/TierCard';
import { SectionHeader } from '../components/SectionHeader';
import { TopNav } from '../components/TopNav';
import { AppNav } from '../components/AppNav';
import { CurrencySwitcher } from '../components/CurrencySwitcher';
import { ContactSalesModal } from '../components/ContactSalesModal';
import { api, type BucketRecord } from '../lib/api';

export default function Plans() {
  const { user } = useAuth();
  const { currency } = useCurrency();
  const isLoggedIn = !!user;
  const navigate = useNavigate();
  const goRegister = () => navigate('/register');
  const goPay = (plan: 'plus' | 'super' | 'ultra') =>
    navigate(`/billing/pay?plan=${plan}`);

  // Pull live subscription state from /v1/buckets — needed to decide
  // whether a logged-in user can self-checkout (trial / no sub) or has
  // to talk to support (paid). v1 has no self-serve renew/upgrade so any
  // active paid plan locks self-checkout until it expires naturally.
  const [paidSku, setPaidSku] = useState<BucketRecord['skuType'] | null>(null);
  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    api.getBuckets()
      .then((res) => {
        if (cancelled) return;
        const paid = res.buckets.find((b) =>
          b.skuType === 'plan_plus' ||
          b.skuType === 'plan_super' ||
          b.skuType === 'plan_ultra',
        );
        setPaidSku(paid?.skuType ?? null);
      })
      .catch(() => {
        // Network blip — let the user proceed with normal CTAs rather than
        // blocking them out of caution.
      });
    return () => { cancelled = true; };
  }, [isLoggedIn]);

  // Contact-sales modal (shared with Dashboard). Paid users hitting the
  // tier CTA fire this instead of self-checkout.
  const [contactReason, setContactReason] = useState<
    'upgrade' | 'renew' | 'topup' | 'general' | null
  >(null);

  // Ultra slots re-open daily at 9:55 CST (Super preempt — the real
  // transition moment, since Super grabs everything in 5 min). The hook
  // auto-rolls to tomorrow's slot when today's passes AND exposes a
  // 3-phase state so copy can flip through 即将开放 → 抢购中 → 已被抢完
  // without requiring the user to refresh.
  const { countdown: ultraCountdown, phase: ultraPhase } = useDailyCountdown(
    ULTRA_DROP.preemptHourCST,
    ULTRA_DROP.preemptMinuteCST,
  );

  // CTA for the 3 paid tiers. Priority chain:
  //   1. anonymous          → "免费开始 →"     → /register
  //   2. logged in, has paid → "联系客服"      → ContactSalesModal
  //      (paid lockout wins over sold-out — existing customers still
  //       see their actual state, not a misleading "下次开放" countdown)
  //   3. logged in, sold out → countdown / "抢购中…" → detail page
  //   4. logged in, can buy  → "立即开通 →"   → /billing/pay
  const tierCta = (plan: 'plus' | 'super' | 'ultra', soldOut?: boolean) => {
    if (!isLoggedIn) return { text: '免费开始 →', onClick: goRegister };
    if (paidSku) {
      const isUltra = paidSku === 'plan_ultra';
      return {
        text: isUltra ? '已订阅 · 联系客服续费' : '已订阅 · 联系客服调整',
        onClick: () => setContactReason(isUltra ? 'renew' : 'upgrade'),
      };
    }
    if (soldOut) {
      return {
        text:
          ultraPhase === 'transitioning'
            ? 'SUPER 抢购中…'
            : `下次开放 ${ultraCountdown}`,
        onClick: () => goPay(plan),
      };
    }
    return { text: '立即开通 →', onClick: () => goPay(plan) };
  };
  const standardCta = isLoggedIn
    ? { text: '联系客服充值', onClick: () => setContactReason('topup') }
    : { text: '免费开始 →', onClick: goRegister };

  const std = STANDARD_RATE[currency];
  const [plus, sup, ultra] = TIERS;

  return (
    <div className="min-h-screen bg-bg">
      {/* Logged-in users keep the product chrome (AppNav with avatar) so
          jumping here from /console doesn't drop them out of the
          authenticated shell. Anonymous visitors still get the marketing
          TopNav (Wallet ↔ Primitives toggle, login link) — this page is
          a fence between marketing and product. */}
      {isLoggedIn ? <AppNav /> : <TopNav />}

      <main className="max-w-[1080px] mx-auto px-6 md:px-14 py-12 md:py-20">
        {/* Hero — Slock-pixel eyebrow + bold one-line h1 + currency switcher right-aligned */}
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-ink-3 font-bold">
            PRICING · 套餐
          </div>
          <CurrencySwitcher />
        </div>
        <h1 className="font-sans text-[40px] md:text-[56px] font-extrabold leading-[1.05] tracking-tight mb-5">
          一份钱，多个 Agent 共用。
        </h1>
        <p className="text-[15px] text-text-secondary mb-10 max-w-[560px] leading-relaxed">
          {currency === 'usd' ? '美元' : '人民币'} 付款，按调用额度计费。
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
            <div className="font-mono text-[28px] md:text-[32px] font-bold leading-none text-ink mb-2 break-words">
              <span className="font-medium">{std.unit}</span>
              <span className="text-ink-4 mx-2.5 font-medium">=</span>
              <span className="text-[16px] text-ink-3 align-top mr-px">$</span>
              {std.quota.replace(/^\$/, '')}
              <span className="text-[14px] text-ink-3 ml-2 font-medium">调用额度</span>
            </div>
            <div className="font-mono text-[12px] text-ink-3 tracking-tight">
              {std.minTopup}
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
        <SectionHeader num="02" cn="套餐" en="Membership" size="lg" className="mb-3" />

        {/* Multi-channel rate switching — one-liner. Specifics live in
            each card's [i] tooltip; no need to over-explain in body copy. */}
        <p className="mb-5 max-w-[640px] text-[13.5px] text-text-secondary leading-relaxed">
          同一个模型背后接多条渠道，系统自动挑最便宜的那条跑 ——
          你只为真实跑通的渠道付费。
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <TierCard
            name={plus.name}
            pricePeriod={tierPricePeriod(plus, currency)}
            leverage={plus.leverage}
            totalUsd={plus.totalQuota}
            dailyCap={plus.dailyCap}
            models={plus.models}
            ctaText={tierCta('plus', plus.soldOut).text}
            onCtaClick={tierCta('plus', plus.soldOut).onClick}
            ctaVariant={plus.soldOut ? 'muted' : 'secondary'}
            tooltipPanel={
              <TierTooltip
                models={['GPT-5.5 · 5.4 · 5.4-mini']}
                channels={[
                  { name: 'Plus', rate: '0.2×' },
                  { name: 'Pro', rate: '0.4×' },
                  { name: 'Stable', rate: '1.4×' },
                ]}
              />
            }
          />
          <TierCard
            name={sup.name}
            pricePeriod={tierPricePeriod(sup, currency)}
            leverage={sup.leverage}
            totalUsd={sup.totalQuota}
            dailyCap={sup.dailyCap}
            models={sup.models}
            ctaText={tierCta('super', sup.soldOut).text}
            onCtaClick={tierCta('super', sup.soldOut).onClick}
            ctaVariant={sup.soldOut ? 'muted' : 'primary'}
            featured={!sup.soldOut}
            ctaHelper={
              sup.soldOut
                ? undefined
                : `+ Ultra 抢购优先权 · ${ULTRA_DROP.preemptHourCST}:${ULTRA_DROP.preemptMinuteCST} 提前 5 分钟`
            }
            tooltipPanel={
              <TierTooltip
                headline="在 Plus 基础上增加"
                models={['Claude Opus 4.7 · 4.6 · Sonnet 4.6']}
                channels={[
                  { name: 'Antigravity', rate: '0.7×' },
                  { name: 'Azure', rate: '2.1×' },
                ]}
              />
            }
          />
          <TierCard
            name={ultra.name}
            pricePeriod={tierPricePeriod(ultra, currency)}
            leverage={ultra.leverage}
            totalUsd={ultra.totalQuota}
            dailyCap={ultra.dailyCap}
            models={ultra.models}
            ctaText={tierCta('ultra', ultra.soldOut).text}
            onCtaClick={tierCta('ultra', ultra.soldOut).onClick}
            ctaVariant={ultra.soldOut ? 'muted' : 'secondary'}
            soldOutBanner={
              ultra.soldOut
                ? ultraPhase === 'before'
                  ? `今日 ${ULTRA_DROP.slotsPerDay} 席即将开放 · Super 优先`
                  : ultraPhase === 'transitioning'
                  ? `Super 正在抢购今日 ${ULTRA_DROP.slotsPerDay} 席…`
                  : `今日 ${ULTRA_DROP.slotsPerDay} 席已抢完 · 明日 ${ULTRA_DROP.preemptHourCST}:${ULTRA_DROP.preemptMinuteCST} 再开`
                : undefined
            }
            ctaHelper={
              ultra.soldOut ? '通常 1 分钟内抢完' : undefined
            }
            tooltipPanel={
              <TierTooltip
                headline="在 Super 基础上增加"
                models={['GPT-5.5 Pro 满血版']}
                channels={[
                  {
                    name: 'Anthropic 官方',
                    rate: '6.8×',
                    note: '默认 Claude 通道',
                  },
                ]}
              />
            }
          />
        </div>

        {/* Smart routing — kept tight against the tier cards because it's
            a capability ALL three tiers share (per user feedback). Plain
            language, no jargon, no inline font-mono spans. */}
        <div className="mt-5 mb-10 bg-surface border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917] p-6 md:p-7">
          <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-ink-3 font-bold mb-2">
            SMART ROUTING · 智能路由
          </div>
          <h3 className="text-[20px] md:text-[22px] font-bold tracking-tight leading-tight mb-3">
            你不需要永远用最贵的模型。
          </h3>
          <p className="text-[14px] text-text-secondary leading-relaxed max-w-[560px] mb-2">
            简单问题让便宜模型答，难的自动升级到顶级 —— 账单变薄，结果不变。
          </p>
          <p className="font-mono text-[11.5px] text-ink-3">
            三档套餐共享 · 不收额外费用
          </p>
        </div>

        {/* Buyer-assurance footer — payment methods + refund policy live
            together as "what happens when you click 立即开通". Payment
            badges are currency-aware so users see the methods that match
            the currency they switched to at the top. */}
        <div className="flex items-center gap-2.5 flex-wrap mb-3">
          <span className="font-mono text-[10.5px] tracking-[0.16em] uppercase text-ink-3 font-bold">
            支持支付
          </span>
          {currency === 'rmb' ? (
            <PayBadge dotColor="#1677FF" label="支付宝" />
          ) : (
            <>
              <PayBadge dotColor="#26A17B" label="USDT" />
              <PayBadge dotColor="#2775CA" label="USDC" />
            </>
          )}
        </div>
        <div className="font-mono text-[11.5px] text-ink-3 tracking-tight max-w-[640px] leading-relaxed">
          调用按真实渠道费率 · 套餐 24h 不满意可退款（按实付，不含赠送）· 充值不退但永久可用
        </div>
      </main>

      <ContactSalesModal
        open={contactReason !== null}
        onClose={() => setContactReason(null)}
        reason={contactReason ?? 'general'}
      />
    </div>
  );
}

function PayBadge({
  dotColor,
  label,
  hint,
}: {
  dotColor: string;
  label: string;
  hint?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-bg border-2 border-ink rounded shadow-[2px_2px_0_0_#1C1917]">
      <span
        className="w-2 h-2 rounded-full"
        style={{ backgroundColor: dotColor }}
        aria-hidden
      />
      <span className="font-mono text-[11px] font-bold text-ink leading-none">
        {label}
      </span>
      {hint && (
        <span className="font-mono text-[10px] text-ink-3 leading-none">
          {hint}
        </span>
      )}
    </span>
  );
}

interface TierTooltipChannel {
  name: string;
  rate: string;
  /** Free-form note appended in lighter type — used for "Ultra 独占" etc. */
  note?: string;
}

/** Hover-panel rendered inside each TierCard's [i] affordance. Two modes:
 *   - Base (no headline): full lineup. Used for Plus, the cheapest tier.
 *   - Delta (headline set): only what's added on top of the previous tier.
 *     Keeps higher-tier tooltips short — readers scan deltas, not full
 *     duplications of what they already saw on Plus. */
function TierTooltip({
  headline,
  models,
  channels,
  fallbackNote,
}: {
  /** When set, marks this as a delta tooltip — e.g. "在 Plus 基础上增加". */
  headline?: string;
  models: string[];
  channels: TierTooltipChannel[];
  /** Free-fallback line. Only Plus carries it; Super/Ultra inherit by
   *  virtue of all tiers sharing smart routing (stated in the intro). */
  fallbackNote?: string;
}): ReactNode {
  const isDelta = !!headline;
  return (
    <div>
      {headline && (
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-bg/70 font-bold mb-2 pb-2 border-b border-bg/20">
          {headline}
        </div>
      )}

      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-bg/60 font-bold mb-1">
        模型
      </div>
      <ul className="mb-3 space-y-0.5">
        {models.map((m) => (
          <li key={m} className="text-[12px] text-bg leading-snug">
            {m}
          </li>
        ))}
      </ul>

      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-bg/60 font-bold mb-1">
        渠道{!isDelta && ' · 倍率从低到高自动切换'}
      </div>
      <ul className="space-y-0.5">
        {channels.map((c) => (
          <li
            key={c.name}
            className="flex items-baseline justify-between gap-3 text-[12px] text-bg leading-snug"
          >
            <span className="truncate">
              {c.name}
              {c.note && (
                <span className="ml-1.5 font-mono text-[10px] text-bg/60">
                  {c.note}
                </span>
              )}
            </span>
            <span className="font-mono font-bold tabular-nums flex-shrink-0">
              {c.rate}
            </span>
          </li>
        ))}
      </ul>

      {fallbackNote && (
        <div className="mt-2 pt-2 border-t border-bg/20 font-mono text-[10.5px] text-bg/70 leading-relaxed">
          + {fallbackNote}
        </div>
      )}
    </div>
  );
}
