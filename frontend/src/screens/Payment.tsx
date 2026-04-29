import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AppNav, Breadcrumb } from '../components/AppNav';
import { TIERS, tierPrice } from '../lib/pricing';
import { ULTRA_DROP, useDailyCountdown } from '../lib/dropSchedule';
import { api, type BillingChannel, type BillingPlanId, type BucketRecord } from '../lib/api';
import { ContactSalesModal } from '../components/ContactSalesModal';
import { ChannelOption } from '../components/ChannelOption';
import { dispatchCheckout } from '../lib/checkoutFlow';

const card = 'bg-white border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917]';

type PlanInfo = (typeof TIERS)[number];

const VALID_PLANS = new Set<BillingPlanId>(['plus', 'super', 'ultra']);

function asPlanId(v: string | null): BillingPlanId | null {
  if (!v) return null;
  return VALID_PLANS.has(v as BillingPlanId) ? (v as BillingPlanId) : null;
}

function planByIdSafe(id: BillingPlanId): PlanInfo {
  // TIERS uses display-cased names (Plus/Super/Ultra) — match case-insensitively.
  return TIERS.find((t) => t.name.toLowerCase() === id) ?? TIERS[0];
}

export default function Payment() {
  const [params] = useSearchParams();
  const planId = asPlanId(params.get('plan'));
  const navigate = useNavigate();

  // Channel default: 支付宝 (xunhupay). Most users in CN, fewer steps.
  const [channel, setChannel] = useState<BillingChannel>('xunhupay');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lock-out for already-paid users. v1 has no self-serve renew/upgrade,
  // so anyone with an active plan_* sub bouncing into /billing/pay would
  // hit a dead end — the gateway might even take their money for a
  // duplicate sub. Pull buckets on mount and short-circuit to a
  // "联系客服" page when we detect a paid sub.
  const [paidSku, setPaidSku] = useState<BucketRecord['skuType'] | null>(null);
  const [bucketsLoaded, setBucketsLoaded] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  useEffect(() => {
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
        // Network blip — don't block the user. Worst case they hit the
        // gateway and double-pay, which is recoverable via support.
      })
      .finally(() => { if (!cancelled) setBucketsLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  if (!planId) {
    return (
      <div className="min-h-screen bg-bg pb-12">
        <AppNav current="console" />
        <main className="max-w-[680px] mx-auto px-5 sm:px-9 pt-10">
          <h1 className="text-[28px] font-bold mb-3">未指定套餐</h1>
          <p className="text-[14px] text-text-secondary mb-6">
            从套餐页选择一个套餐再来。
          </p>
          <Link
            to="/pricing"
            className="inline-block px-5 py-2.5 bg-ink text-bg border-2 border-ink rounded-md text-[14px] font-bold shadow-[3px_3px_0_0_#1C1917]"
          >
            前往套餐页
          </Link>
        </main>
      </div>
    );
  }

  // Lock-out: user already has a paid plan, can't self-checkout for
  // another. Tell them clearly + provide a "联系客服" path. Wait for the
  // buckets fetch so we don't flash this page on every mount.
  if (bucketsLoaded && paidSku) {
    const tierName = paidSku.replace('plan_', '').toUpperCase();
    return (
      <div className="min-h-screen bg-bg pb-12">
        <AppNav current="console" />
        <main className="max-w-[680px] mx-auto px-5 sm:px-9 pt-10">
          <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[#A89A8D] font-bold mb-3">
            BILLING · 已订阅
          </div>
          <h1 className="text-[36px] md:text-[44px] font-bold tracking-tight leading-[1.05] mb-3">
            你已经订阅了 {tierName}
          </h1>
          <p className="text-[14px] text-text-secondary mb-8 max-w-[520px] leading-relaxed">
            v1.0 还没开放自助续费 / 升级。要调整套餐请联系客服，或者等当前订阅到期后重新选购。
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => setContactOpen(true)}
              className={
                'px-5 py-2.5 bg-ink text-bg border-2 border-ink rounded-md text-[14px] font-bold ' +
                'shadow-[3px_3px_0_0_#1C1917] ' +
                'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
                'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
                'transition-all'
              }
            >
              联系客服 →
            </button>
            <Link
              to="/billing/topup"
              className="font-mono text-[12.5px] text-ink-2 hover:text-ink underline underline-offset-4 decoration-2"
            >
              + 加买充值额度
            </Link>
            <Link
              to="/console"
              className="font-mono text-[12.5px] text-ink-2 hover:text-ink underline underline-offset-4 decoration-2"
            >
              ← 返回控制台
            </Link>
          </div>
        </main>
        <ContactSalesModal
          open={contactOpen}
          onClose={() => setContactOpen(false)}
          reason={paidSku === 'plan_ultra' ? 'renew' : 'upgrade'}
        />
      </div>
    );
  }

  const plan = planByIdSafe(planId);
  // Price displayed on this page tracks the selected channel, NOT the
  // user's currency-switcher preference. xunhupay is CNY-only; epusdt
  // quotes in USD. The actual amount charged to the gateway matches
  // what's shown here.
  const displayCurrency = channel === 'epusdt' ? 'usd' : 'rmb';
  const price = tierPrice(plan, displayCurrency);

  // Direct-nav guard for sold-out tiers — Plans.tsx hides the CTA, but a
  // bookmarked or shared /billing/pay?plan=ultra URL would otherwise still
  // POST to the API. Backend also returns 410; this page is the marketing
  // surface that explains *why* the tier is gated and gives users a
  // reason to come back tomorrow.
  if (plan.soldOut) {
    return <UltraSoldOutPage price={price} />;
  }

  async function submit() {
    if (!planId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.createOrder({ type: 'plan', planId, channel });
      dispatchCheckout(res, channel, navigate);
    } catch (err) {
      setError((err as Error).message || '下单失败，稍后再试');
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg pb-12">
      <AppNav current="console" />

      <main className="max-w-[680px] mx-auto px-5 sm:px-9 pt-6">
        {/* Crumbs */}
        <Breadcrumb
          items={[
            { label: '控制台', to: '/console' },
            { label: '套餐', to: '/pricing' },
            { label: '下单' },
          ]}
        />

        {/* Eyebrow */}
        <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[#A89A8D] font-bold mb-3">
          BILLING · 下单
        </div>
        <h1 className="text-[36px] md:text-[44px] font-bold tracking-tight leading-[1.05] mb-3">
          {plan.name} 套餐
        </h1>
        <p className="text-[14px] text-text-secondary mb-8 max-w-[520px] leading-relaxed">
          确认订单信息并选择支付方式，付款完成后我们会在 1 分钟内自动激活你的套餐。
        </p>

        {/* Order summary */}
        <section className={`${card} p-6 mb-6`}>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-4">
            订单摘要
          </div>
          <dl className="space-y-3">
            <Row label="套餐">
              <span className="font-bold">{plan.name}</span>
            </Row>
            <Row label="价格">
              <span className="font-mono font-bold text-[18px]">{price.price}</span>
              <span className="text-text-secondary ml-2 text-[13px]">{price.period}</span>
            </Row>
            <Row label="额度">
              <span className="text-[13.5px]">{plan.totalQuota}</span>
            </Row>
            <Row label="每日 cap">
              <span className="text-[13.5px]">{plan.dailyCap}</span>
            </Row>
            <Row label="模型">
              <span className="text-[13.5px]">{plan.models}</span>
            </Row>
          </dl>
        </section>

        {/* Channel picker */}
        <section className="mb-6">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-3">
            支付方式
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ChannelOption
              active={channel === 'xunhupay'}
              onClick={() => setChannel('xunhupay')}
              title="支付宝"
              subtitle="PC 扫码 / 手机直跳"
              tag="即时到账"
            />
            <ChannelOption
              active={channel === 'epusdt'}
              onClick={() => setChannel('epusdt')}
              title="稳定币"
              subtitle="USDT / USDC · 多链可选"
              tag="海外友好"
            />
          </div>
        </section>

        {/* Error */}
        {error && (
          <div className="mb-5 p-3 border-2 border-red-600 rounded-md bg-red-50 font-mono text-[12px] text-red-700">
            {error}
          </div>
        )}

        {/* Action */}
        <div className="flex items-center justify-between flex-wrap gap-3 mt-8">
          <Link
            to="/pricing"
            className="font-mono text-[12.5px] text-ink-2 hover:text-ink underline underline-offset-4 decoration-2"
          >
            ← 重新选套餐
          </Link>
          <button
            onClick={submit}
            disabled={submitting}
            className={
              'px-6 py-3 bg-ink text-bg border-2 border-ink rounded-md text-[14px] font-bold ' +
              'shadow-[3px_3px_0_0_#1C1917] ' +
              (submitting
                ? 'opacity-60 cursor-not-allowed'
                : 'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
                  'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
                  'transition-all')
            }
          >
            {submitting ? '生成订单中…' : `去付款 · ${price.price}`}
          </button>
        </div>

        <div className="mt-10 font-mono text-[11.5px] text-ink-3 leading-relaxed">
          · 支付完成后会自动跳转回控制台，套餐 1 分钟内生效<br />
          · 支付页面会在新窗口打开，本页面会显示订单状态<br />
          · 24h 内不满意可联系客服全额退款
        </div>
      </main>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className="font-mono text-[12px] text-[#A89A8D] uppercase tracking-[0.06em] flex-shrink-0">
        {label}
      </dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}

/**
 * Sold-out / scheduled-drop landing page for Ultra. Built on three moves:
 *   1. WHO (personal) — name the verticals where this tier actually pays
 *      off (research, finance, regulated domains). A reader from those
 *      fields sees themselves; everyone else gets a clear "skip me".
 *   2. WHAT (purpose) — both Ultra differentiators: GPT-5.5 Pro full-power
 *      Codex AND Anthropic native API direct (Claude without translation).
 *   3. WHY GATED (trust) — the real cost economics behind 8 slots/day.
 *
 * Plus a live countdown so habit-forming return visits make sense.
 */
export function UltraSoldOutPage({
  price,
}: {
  price: { price: string; period: string };
}) {
  // 3-phase live state — before / transitioning / passed. Auto-rolls
  // every second; no manual refresh needed. The brief 2-5s transition
  // window keeps the daily flip from feeling scripted.
  const { countdown, phase } = useDailyCountdown(
    ULTRA_DROP.preemptHourCST,
    ULTRA_DROP.preemptMinuteCST,
  );

  return (
    <div className="min-h-screen bg-bg pb-12">
      <AppNav current="console" />
      <main className="max-w-[680px] mx-auto px-5 sm:px-9 pt-6">
        {/* Crumbs */}
        <Breadcrumb
          items={[
            { label: '控制台', to: '/console' },
            { label: '套餐', to: '/pricing' },
            { label: 'Ultra · 满血档' },
          ]}
        />

        <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[#A89A8D] font-bold mb-3">
          ULTRA · 每日 {ULTRA_DROP.preemptHourCST}:{ULTRA_DROP.preemptMinuteCST} 开放 {ULTRA_DROP.slotsPerDay} 席
        </div>
        <h1 className="text-[36px] md:text-[44px] font-bold tracking-tight leading-[1.05] mb-4">
          给你的 Agent，<br />配一档满血模型。
        </h1>
        <p className="text-[14px] text-text-secondary mb-8 max-w-[520px] leading-relaxed">
          {price.price} <span className="text-ink-3">{price.period}</span> ·
          {phase === 'before'
            ? ` Super 用户即将抢购今日 ${ULTRA_DROP.slotsPerDay} 席。`
            : phase === 'transitioning'
            ? ` Super 用户正在抢购今日 ${ULTRA_DROP.slotsPerDay} 席…`
            : ` 今日 ${ULTRA_DROP.slotsPerDay} 席已被 Super 用户抢完。`}
        </p>

        {/* Live state — countdown ticks except during the 2-5s transition
            window, where digits are replaced by an animated "抢购中…" text.
            All three phase states drive the same DOM, so React doesn't need
            a manual refresh to swap them. */}
        <section className="bg-surface border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917] p-6 mb-3">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-2">
            {phase === 'transitioning'
              ? 'SUPER 抢购中'
              : phase === 'passed'
              ? '距离明日开放'
              : '距离今日开放'}
          </div>
          {phase === 'transitioning' ? (
            <div className="font-mono text-[28px] md:text-[34px] font-bold tracking-tight text-accent leading-none animate-pulse">
              抢购中…
            </div>
          ) : (
            <div className="font-mono text-[36px] md:text-[44px] font-bold tracking-tight text-ink tabular-nums leading-none">
              {countdown}
            </div>
          )}
          <div className="mt-3 font-mono text-[11.5px] text-ink-3 leading-relaxed">
            每日 {ULTRA_DROP.preemptHourCST}:{ULTRA_DROP.preemptMinuteCST}（北京时间）准点开放 ·
            通常 1 分钟内抢完 · 建议设个闹钟
          </div>
        </section>

        {/* Super-tier upgrade priority — strategic hook to push Plus users
            toward Super (Super becomes the obvious step toward Ultra). */}
        <section className="bg-lime-stamp border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917] p-4 mb-8">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-lime-stamp-ink font-bold mb-1">
            SUPER 用户专属
          </div>
          <div className="text-[13.5px] text-ink leading-relaxed">
            <strong className="font-semibold">每日 {ULTRA_DROP.preemptHourCST}:{ULTRA_DROP.preemptMinuteCST} 提前 5 分钟独占抢购窗口。</strong>
            {ULTRA_DROP.hourCST}:00 后剩余名额才对所有人开放 ——
            <span className="text-ink-2">从 Super 升 Ultra，比从 Plus 升要顺手很多。</span>
          </div>
        </section>

        {/* WHO — speak to specific verticals so the reader sees themselves */}
        <section className="mb-8">
          <h2 className="text-[20px] font-bold tracking-tight mb-3">
            谁真的需要 Ultra
          </h2>
          <p className="text-[14px] text-text-secondary leading-relaxed mb-3 max-w-[560px]">
            如果你的 Agent 在做下面这些事 —— Ultra 才值得抢：
          </p>
          <ul className="text-[14px] text-text-secondary leading-relaxed mb-4 max-w-[560px] space-y-1.5">
            <li>· <strong className="text-ink font-semibold">科研 Agent</strong> 跑文献综述 / 跨论文推理 / 实验方案对比</li>
            <li>· <strong className="text-ink font-semibold">金融 Agent</strong> 跑策略回测 / 合规审计 / 风险建模</li>
            <li>· <strong className="text-ink font-semibold">法律 / 医疗 / 工程 Agent</strong>，输出错一行就是事故</li>
            <li>· 任何不能容忍模型质量降级的生产工作流</li>
          </ul>
          <p className="text-[13.5px] text-ink-3 leading-relaxed max-w-[560px]">
            如果你只是日常 chat / 写脚本，Plus 或 Super 已经够用 —— 不要为 Ultra 多花钱。
          </p>
        </section>

        {/* WHAT — the two real differentiators (model + channel) */}
        <section className="mb-8">
          <h2 className="text-[20px] font-bold tracking-tight mb-3">
            Ultra 给你的两件事
          </h2>
          <div className="space-y-4 max-w-[560px]">
            <div>
              <div className="font-mono font-bold text-[14px] text-ink mb-1">
                GPT-5.5 Pro · OpenAI 满血 Codex 推理引擎
              </div>
              <p className="text-[13.5px] text-text-secondary leading-relaxed">
                其他档位最多到 GPT-5.5。长链路任务、多步推理收敛能力，
                差就差在 Pro 这一档。
              </p>
            </div>
            <div>
              <div className="font-mono font-bold text-[14px] text-ink mb-1">
                Anthropic 官方 API 直连 · Claude 不经过转接
              </div>
              <p className="text-[13.5px] text-text-secondary leading-relaxed">
                其他档位走 Antigravity / Azure 转接渠道，对生产工作流来说
                是不可控的尾部风险 —— Ultra 的 Claude 调用直达原厂。
              </p>
            </div>
          </div>
          <p className="mt-4 text-[14px] text-ink leading-relaxed max-w-[560px]">
            你的 Agent 调用什么模型，跑出来就是原版那一个 —— 不会被我们悄悄换成性价比变种。
          </p>
        </section>

        {/* WHY GATED — economic transparency builds trust */}
        <section className="mb-10">
          <h2 className="text-[20px] font-bold tracking-tight mb-3">
            为什么我们每天只放 {ULTRA_DROP.slotsPerDay} 席
          </h2>
          <p className="text-[14px] text-text-secondary leading-relaxed max-w-[560px]">
            两条线都贵 —— GPT-5.5 Pro 推理成本是性价比款的 3 - 8 倍，
            Anthropic 官方 API 是转接渠道的 3 倍以上。少量 Ultra 用户的全额成本我们能扛，
            但放开闸只剩两条路：涨价，或者偷偷换成性价比变种。那就违背了「原版」这两个字 ——
            所以名额卡死在每天 {ULTRA_DROP.slotsPerDay} 个。
          </p>
        </section>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <Link
            to="/pricing"
            className="font-mono text-[12.5px] text-ink-2 hover:text-ink underline underline-offset-4 decoration-2"
          >
            ← 先看 Plus / Super
          </Link>
          <span className="font-mono text-[11.5px] text-ink-3">
            {phase === 'transitioning' ? 'SUPER 抢购中…' : `下次开放：${countdown}`}
          </span>
        </div>
      </main>
    </div>
  );
}
