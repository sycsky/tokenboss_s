import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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

  // CTA for the 3 paid tiers. Returns null to suppress the button
  // entirely (used for tiers below the user's current paid plan — no
  // meaningful action to offer there, and showing "已订阅" on every card
  // makes the page feel locked-down). Priority chain:
  //   1. anonymous            → "免费开始 →"        → /register
  //   2. logged in, paid:
  //      · this card === current tier → "续费 →"   → ContactSalesModal(renew)
  //      · this card  >  current tier → "升级 →"   → ContactSalesModal(upgrade)
  //         (sold-out wins — countdown still shows for sold-out higher tiers
  //          so users see the real marketing state, not contact-sales)
  //      · this card  <  current tier → null (no button rendered)
  //   3. logged in, no plan:
  //      · sold out  → countdown
  //      · can buy   → "立即开通 →"
  const TIER_RANK: Record<'plus' | 'super' | 'ultra', number> = {
    plus: 1,
    super: 2,
    ultra: 3,
  };
  const tierCta = (
    plan: 'plus' | 'super' | 'ultra',
    soldOut?: boolean,
  ): { text: string; onClick: () => void } | null => {
    if (!isLoggedIn) return { text: '免费开始 →', onClick: goRegister };

    if (paidSku) {
      // paidSku is 'plan_plus' | 'plan_super' | 'plan_ultra'
      const currentTier = paidSku.replace('plan_', '') as 'plus' | 'super' | 'ultra';

      if (plan === currentTier) {
        return { text: '续费 →', onClick: () => setContactReason('renew') };
      }
      if (TIER_RANK[plan] < TIER_RANK[currentTier]) {
        // Lower tier than the user already has — no action to offer.
        return null;
      }
      // Higher tier. Sold-out marketing state takes priority over the
      // upgrade contact-sales path (a paid super user looking at ultra
      // should still see the daily-drop countdown).
      if (soldOut) {
        return {
          text:
            ultraPhase === 'transitioning'
              ? 'SUPER 抢购中…'
              : `下次开放 ${ultraCountdown}`,
          onClick: () => goPay(plan),
        };
      }
      return { text: '升级 →', onClick: () => setContactReason('upgrade') };
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
  const standardCta:
    | { text: string; onClick: () => void; href?: undefined }
    | { text: string; href: string; onClick?: undefined } = isLoggedIn
    ? { text: '立即充值 →', href: '/billing/topup' }
    : { text: '免费开始 →', onClick: goRegister };

  const std = STANDARD_RATE[currency];
  const [plus, sup, ultra] = TIERS;

  // Pre-compute per-card CTA so each TierCard call site is just a
  // straight prop wire-up, and we don't re-derive the cta on every
  // render of the 3 cards.
  const plusCta = tierCta('plus', plus.soldOut);
  const superCta = tierCta('super', sup.soldOut);
  const ultraCta = tierCta('ultra', ultra.soldOut);

  return (
    <div className="min-h-screen bg-bg">
      {/* Logged-in users keep the product chrome (AppNav with avatar) so
          jumping here from /console doesn't drop them out of the
          authenticated shell. Anonymous visitors still get the marketing
          TopNav (Wallet ↔ Primitives toggle, login link) — this page is
          a fence between marketing and product. */}
      {isLoggedIn ? <AppNav /> : <TopNav />}

      <main className="max-w-[1080px] mx-auto px-6 md:px-14 py-12 md:py-20">
        {/* Hero — eyebrow on the left, currency control + payment annotation
            on the right. Earlier the PayBadges sat as ink-stamped pills on
            the same row as the CurrencySwitcher, which made them look like
            three peer controls — but only the switcher is interactive.
            Restructured so the switcher stays a stamp pill and the payment
            methods become a small color-dot annotation BELOW it. Visual
            hierarchy now matches the logical one (switcher = control;
            methods = readout that follows from its value). */}
        <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
          <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-ink-3 font-bold">
            PRICING · 套餐
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <CurrencySwitcher />
            <div className="flex items-center gap-2 font-mono text-[10.5px] text-ink-3 leading-none">
              <span>支持</span>
              {currency === 'rmb' ? (
                <PayBadge dotColor="#1677FF" label="支付宝" />
              ) : (
                <>
                  <PayBadge dotColor="#26A17B" label="USDT" />
                  <span aria-hidden="true" className="text-ink-4">·</span>
                  <PayBadge dotColor="#2775CA" label="USDC" />
                </>
              )}
            </div>
          </div>
        </div>
        <h1 className="font-sans text-[40px] md:text-[56px] font-extrabold leading-[1.05] tracking-tight mb-5">
          一份钱，多个 Agent 共用。
        </h1>
        <p className="text-[15px] text-text-secondary mb-10 max-w-[560px] leading-relaxed">
          {currency === 'usd' ? '美元' : '人民币'} 付款，按调用额度计费。
        </p>

        {/* 01 Topup — Slock-pixel pay-as-you-go. Refund clause sits to
            the right of the section title so the assurance copy is in
            scope when the user reads about the topup product, not
            tucked away in the page footer. */}
        <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
          <SectionHeader num="01" cn="充值" en="Pay as you go" size="lg" />
          <span className="font-mono text-[11px] text-ink-3 tracking-tight">
            充值不退 · 永久可用
          </span>
        </div>

        {/* Scenario one-liner — second-person voice ("你做 X") so users can
            self-identify against the 套餐 line below and decide which lane
            to take. Frame is: 你 [doing what] · 要 [need] —— [what we
            give you]. The two sections together act as a fork in the road. */}
        <p className="mb-5 max-w-[640px] text-[13.5px] text-text-secondary leading-relaxed">
          让 Claude Code、Codex 这类 Agent 帮你 Vibe Coding ——
          我们给你折扣价直连，按调用付费。
        </p>

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
          {standardCta.href ? (
            <Link
              to={standardCta.href}
              className={
                'px-5 py-2.5 bg-bg border-2 border-ink rounded-md text-[14px] font-bold text-ink ' +
                'shadow-[3px_3px_0_0_#1C1917] ' +
                'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
                'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
                'transition-all whitespace-nowrap'
              }
            >
              {standardCta.text}
            </Link>
          ) : standardCta.onClick ? (
            <button
              onClick={standardCta.onClick}
              className={
                'px-5 py-2.5 bg-bg border-2 border-ink rounded-md text-[14px] font-bold text-ink ' +
                'shadow-[3px_3px_0_0_#1C1917] ' +
                'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
                'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
                'transition-all whitespace-nowrap'
              }
            >
              {standardCta.text}
            </button>
          ) : null}
        </div>

        {/* 02 Membership — refund clause to the right, mirroring 01 layout. */}
        <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
          <SectionHeader num="02" cn="套餐" en="Membership" size="lg" />
          <span className="font-mono text-[11px] text-ink-3 tracking-tight">
            24h 内不满意可退款 · 按实付，不含赠送
          </span>
        </div>

        {/* Scenario one-liner — paired with 01 充值's intro to act as a fork
            in the road for the user. Same second-person frame: 你 [doing
            what] · 要 [need] —— [what we give you]. Mechanism specifics
            still live in each card's [i] tooltip. */}
        <p className="mb-5 max-w-[640px] text-[13.5px] text-text-secondary leading-relaxed">
          让 OpenClaw、Hermes 这类 Agent 帮你跑生活决策、办公 ——
          我们多渠道智能路由帮你省，按真实跑通付费。
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <TierCard
            name={plus.name}
            pricePeriod={tierPricePeriod(plus, currency)}
            leverage={plus.leverage}
            totalUsd={plus.totalQuota}
            dailyCap={plus.dailyCap}
            models={plus.models}
            ctaText={plusCta?.text}
            onCtaClick={plusCta?.onClick}
            ctaVariant={plus.soldOut ? 'muted' : 'secondary'}
            banner="副驾玩家"
            bannerVariant="subtle"
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
            ctaText={superCta?.text}
            onCtaClick={superCta?.onClick}
            ctaVariant={sup.soldOut ? 'muted' : 'primary'}
            featured={!sup.soldOut}
            banner="主驾玩家"
            bannerVariant="strong"
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
            ctaText={ultraCta?.text}
            onCtaClick={ultraCta?.onClick}
            ctaVariant={ultra.soldOut ? 'muted' : 'secondary'}
            dimmed={ultra.soldOut}
            banner={
              ultra.soldOut
                ? ultraPhase === 'before'
                  ? `今日 ${ULTRA_DROP.slotsPerDay} 席即将开放 · Super 优先`
                  : ultraPhase === 'transitioning'
                  ? `Super 正在抢购今日 ${ULTRA_DROP.slotsPerDay} 席…`
                  : `今日 ${ULTRA_DROP.slotsPerDay} 席已抢完 · 明日 ${ULTRA_DROP.preemptHourCST}:${ULTRA_DROP.preemptMinuteCST} 再开`
                : '自动驾驶'
            }
            bannerVariant="dark"
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

        {/* (Payment methods + refund policy moved up to the section
            headers — see PRICING hero cluster + each SectionHeader's
            right slot. Footer noise removed.) */}
      </main>

      <ContactSalesModal
        open={contactReason !== null}
        onClose={() => setContactReason(null)}
        reason={contactReason ?? 'general'}
      />
    </div>
  );
}

/**
 * Compact "supported payment method" annotation. Was a heavy stamp pill
 * (border + shadow + bg) that read as a button — now a lightweight
 * color-dot + label so it sits naturally as Switcher's sub-annotation
 * without competing with actual interactive controls.
 *
 * Font/size/color inherit from the parent annotation row so the badge
 * row reads as one continuous line.
 */
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
    <span className="inline-flex items-center gap-1 leading-none">
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: dotColor }}
        aria-hidden
      />
      <span className="text-ink-2 font-medium">{label}</span>
      {hint && <span className="text-ink-4">{hint}</span>}
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
