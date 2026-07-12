import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AppNav, Breadcrumb } from '../components/AppNav';
import { MonoLogLoader } from '../components/MonoLogLoader';
import { api, type BillingOrder, type BillingStatus } from '../lib/api';
import { useAuth } from '../lib/auth';

const card = 'bg-white border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917]';

const POLL_INTERVAL_MS = 3000;
// Stop polling after 30 minutes — gateway sessions usually expire by then
// and continued polling just burns the user's API quota for nothing.
const POLL_MAX_DURATION_MS = 30 * 60 * 1000;
const AUTO_REDIRECT_AFTER_PAID_MS = 3000;
// Safety net: a paid topup credits only after settleStatus resolves. If it
// never does (credit stuck upstream), stop waiting after this and redirect
// anyway rather than hang the user on the success screen forever.
const SETTLE_WAIT_MAX_MS = 15000;

const PLAN_LABEL: Record<string, string> = {
  plus: 'Plus',
  super: 'Super',
  ultra: 'Ultra',
};

function skuLabel(order: BillingOrder): string {
  if (order.skuType === 'topup') return '充值';
  if (order.planId) return PLAN_LABEL[order.planId] ?? order.planId;
  return order.skuType;
}

function isTopup(order: BillingOrder): boolean {
  return order.skuType === 'topup';
}

type SettlePhase = 'settled' | 'failed' | 'pending';

// A paid order's *credit* is a separate step from being paid. For a topup
// the newapi redeem runs AFTER the order is marked paid (see
// applyTopupToUser), moving settleStatus null → 'crediting' → 'settled' |
// 'failed'. Only 'settled' means the balance actually landed; 'failed' means
// paid-but-not-credited (recover, don't celebrate). Plans credit inline in
// the webhook and carry no settleStatus, so they count as settled on paid.
function settlePhase(order: BillingOrder): SettlePhase {
  if (!isTopup(order)) return 'settled';
  if (order.settleStatus === 'settled') return 'settled';
  if (order.settleStatus === 'failed') return 'failed';
  return 'pending';
}

// Channel labels are intentionally generic — the epusdt hosted page lets
// the user pick token (USDT / USDC) and chain themselves, so locking the
// label to "USDT-TRC20" misrepresents the actual options.
const CHANNEL_LABEL: Record<string, string> = {
  xunhupay: '支付宝',
  epusdt: '稳定币',
  dodo: '银行卡 / 微信',
};

export default function OrderStatus() {
  const { refresh } = useAuth();
  const { id: idFromPath } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  // The route /billing/success?orderId=... is hit when the gateway redirects
  // the user back; route /billing/orders/:id is hit from our own checkout.
  // Both surface the same UI.
  const orderId = idFromPath ?? searchParams.get('orderId') ?? null;
  const navigate = useNavigate();
  // Payment.tsx passes qrCodeUrl + paymentUrl via navigation state when the
  // user comes from our PC checkout flow. Hard refresh loses it — handled
  // below by falling back to order.paymentUrl. Type as `unknown`-safe.
  const location = useLocation();
  const navState = (location.state ?? {}) as {
    qrCodeUrl?: string;
    paymentUrl?: string;
  };

  const [order, setOrder] = useState<BillingOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const pollStartRef = useRef<number>(Date.now());
  const stoppedRef = useRef(false);

  const fetchOrder = useCallback(async () => {
    if (!orderId) return;
    try {
      const res = await api.getOrder(orderId);
      setOrder(res.order);
      setError(null);
      setLoading(false);
      // A paid topup is not fully done until its credit settles: newapi
      // redeem runs AFTER the order is marked paid (see applyTopupToUser),
      // so status can read 'paid' while settleStatus is still unresolved.
      // Keep polling through that window so the post-paid refresh reads a
      // credited balance instead of the stale one. Bounded by the poll cap.
      const o = res.order;
      const settlementPending =
        o.status === 'paid' && settlePhase(o) === 'pending';
      if (isTerminal(o.status) && !settlementPending) stoppedRef.current = true;
    } catch (err) {
      // 404 right after gateway redirect can happen if Cloudflare cached
      // a stale /billing/success route — keep polling, it'll resolve.
      setError((err as Error).message || '加载订单失败');
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    if (!orderId) return;
    pollStartRef.current = Date.now();
    fetchOrder();

    const t = setInterval(() => {
      if (stoppedRef.current) {
        clearInterval(t);
        return;
      }
      if (Date.now() - pollStartRef.current > POLL_MAX_DURATION_MS) {
        stoppedRef.current = true;
        clearInterval(t);
        return;
      }
      fetchOrder();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(t);
  }, [orderId, fetchOrder]);

  // While a topup sits paid-but-crediting, flip this after a grace period so
  // the "正在入账" copy can admit it's taking longer than usual. Purely
  // cosmetic — it never forces a success state (a stuck credit must not be
  // reported as credited), and the manual "返回控制台" link is always there.
  const [settleSlow, setSettleSlow] = useState(false);
  useEffect(() => {
    if (order?.status !== 'paid' || settlePhase(order) !== 'pending') return;
    const t = setTimeout(() => setSettleSlow(true), SETTLE_WAIT_MAX_MS);
    return () => clearTimeout(t);
  }, [order?.status, order?.settleStatus, order?.skuType]);

  // Auto-redirect to /console once the credit has actually landed — gives
  // the user 3s to read the success copy. Manual escape hatch is the link
  // below.
  //
  // Before redirecting, re-fetch /v1/me so the console shows the credited
  // balance instead of the stale login-time value (auth context caches
  // user.balance and nothing else refreshes it after topup settles).
  //
  // Gate strictly on settlePhase === 'settled': for a topup the credit lands
  // only after settleStatus flips to 'settled' (redeem runs after 'paid'),
  // so refreshing on 'paid' alone races the credit and shows a stale
  // balance, and a 'failed' settlement must NOT be refreshed/redirected as
  // if it succeeded (codex review P1).
  useEffect(() => {
    if (order?.status !== 'paid' || settlePhase(order) !== 'settled') return;
    refresh().catch(() => {
      /* a stale balance is cosmetic — never block the redirect on it */
    });
    const t = setTimeout(() => navigate('/console'), AUTO_REDIRECT_AFTER_PAID_MS);
    return () => clearTimeout(t);
  }, [order?.status, order?.settleStatus, order?.skuType, navigate, refresh]);

  if (!orderId) {
    return (
      <Shell>
        <h1 className="text-[28px] font-bold mb-3">订单 ID 缺失</h1>
        <p className="text-[14px] text-text-secondary mb-6">
          URL 看起来不完整，回到套餐页重新下单。
        </p>
        <Link
          to="/pricing"
          className="inline-block px-5 py-2.5 bg-ink text-bg border-2 border-ink rounded-md text-[14px] font-bold shadow-[3px_3px_0_0_#1C1917]"
        >
          前往套餐页
        </Link>
      </Shell>
    );
  }

  if (loading && !order) {
    return (
      <Shell>
        <MonoLogLoader
          title="tokenboss · loading order"
          endpoints={['order status']}
        />
      </Shell>
    );
  }

  if (error && !order) {
    return (
      <Shell>
        <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[#A89A8D] font-bold mb-3">
          BILLING · 订单状态
        </div>
        <h1 className="text-[28px] font-bold mb-3">查询订单失败</h1>
        <p className="text-[14px] text-text-secondary mb-4">{error}</p>
        <button
          onClick={() => fetchOrder()}
          className="px-4 py-2 bg-ink text-bg border-2 border-ink rounded-md text-[13px] font-bold shadow-[2px_2px_0_0_#1C1917]"
        >
          重试
        </button>
      </Shell>
    );
  }

  if (!order) return null;

  return (
    <Shell topup={isTopup(order)}>
      <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[#A89A8D] font-bold mb-3">
        BILLING · 订单状态
      </div>

      <StatusHero
        status={order.status}
        hasQr={!!navState.qrCodeUrl}
        order={order}
        settleSlow={settleSlow}
      />

      {/* Order summary */}
      <section className={`${card} p-6 mb-6`}>
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-4">
          订单信息
        </div>
        <dl className="space-y-2">
          <Row label="订单号">
            <span className="font-mono text-[12px] break-all">{order.orderId}</span>
          </Row>
          <Row label={isTopup(order) ? '名称' : '套餐'}>
            <span className="font-bold">{skuLabel(order)}</span>
          </Row>
          <Row label="渠道">
            <span>{CHANNEL_LABEL[order.channel] ?? order.channel}</span>
          </Row>
          {/* Topup: split "what you paid" from "what was credited" — they
              differ when paying USDT (1 USDT → $7 credited per spec). Plan
              orders keep the simpler single-amount line below. */}
          {isTopup(order) ? (
            <>
              <Row label="实付">
                <span className="font-mono">
                  {order.channel === 'epusdt' && order.amountActual
                    ? `${order.amountActual.toFixed(4)} USDT`
                    : `${order.currency === 'USD' ? '$' : '¥'}${order.amount.toFixed(2)}`}
                </span>
              </Row>
              {order.topupAmountUsd != null && (
                <Row label="到账">
                  <span className="font-mono font-bold">
                    ${order.topupAmountUsd.toFixed(2)} 美金
                  </span>
                </Row>
              )}
            </>
          ) : (
            <Row label="金额">
              <span className="font-mono">
                {order.currency === 'USD' ? '$' : '¥'}{order.amount.toFixed(2)}
              </span>
              {order.channel === 'epusdt' && order.amountActual ? (
                <span className="ml-2 font-mono text-[12px] text-text-secondary">
                  ≈ {order.amountActual.toFixed(4)} USDT
                </span>
              ) : null}
            </Row>
          )}
          {order.paidAt && (
            <Row label="支付时间">
              <span className="font-mono text-[12px]">{new Date(order.paidAt).toLocaleString()}</span>
            </Row>
          )}
          {order.blockTxId && (
            <Row label="链上交易">
              <span className="font-mono text-[11px] break-all">{order.blockTxId}</span>
            </Row>
          )}
        </dl>
      </section>

      {/* Action area depends on status */}
      {order.status === 'pending' && (
        <PendingActions
          paymentUrl={navState.paymentUrl ?? order.paymentUrl}
          qrCodeUrl={navState.qrCodeUrl}
          amount={order.amount}
          currency={order.currency}
          channel={order.channel}
        />
      )}
      {order.status === 'paid' && settlePhase(order) === 'settled' && <PaidActions />}
      {order.status === 'paid' && settlePhase(order) === 'failed' && <SettleFailedActions />}
      {(order.status === 'expired' || order.status === 'failed') && (
        <FailedActions isTopup={isTopup(order)} />
      )}

      <div className="mt-8 flex items-center justify-between flex-wrap gap-3">
        <Link
          to="/console"
          className="font-mono text-[12.5px] text-ink-2 hover:text-ink underline underline-offset-4 decoration-2"
        >
          ← 返回控制台
        </Link>
        <Link
          to={isTopup(order) ? '/billing/topup' : '/pricing'}
          className="font-mono text-[12.5px] text-ink-2 hover:text-ink underline underline-offset-4 decoration-2"
        >
          {isTopup(order) ? '再充一笔 →' : '重新选套餐 →'}
        </Link>
      </div>
    </Shell>
  );
}

function isTerminal(s: BillingStatus): boolean {
  return s === 'paid' || s === 'expired' || s === 'failed';
}

function Shell({ children, topup = true }: { children: React.ReactNode; topup?: boolean }) {
  return (
    <div className="min-h-screen bg-bg pb-12">
      <AppNav current="console" />
      <main className="max-w-[680px] mx-auto px-5 sm:px-9 pt-6">
        <Breadcrumb
          items={[
            { label: '控制台', to: '/console' },
            topup
              ? { label: '充值', to: '/billing/topup' }
              : { label: '套餐', to: '/pricing' },
            { label: '订单' },
          ]}
        />
        {children}
      </main>
    </div>
  );
}

function StatusHero({
  status,
  hasQr,
  order,
  settleSlow,
}: {
  status: BillingStatus;
  hasQr: boolean;
  order: BillingOrder;
  settleSlow: boolean;
}) {
  if (status === 'pending') {
    return (
      <>
        <h1 className="text-[36px] md:text-[44px] font-bold tracking-tight leading-[1.05] mb-3 flex items-center gap-3">
          <Spinner />
          等待支付
        </h1>
        <p className="text-[14px] text-text-secondary mb-8 max-w-[520px] leading-relaxed">
          {hasQr
            ? '扫描下方二维码完成支付，付款完成后这里会在 1 分钟内自动跳回控制台。'
            : '已为你打开支付页面。完成付款后这里会在 1 分钟内自动跳转到控制台。如果支付页面被关闭了，下方点"重新打开"。'}
        </p>
      </>
    );
  }
  if (status === 'paid') {
    const phase = settlePhase(order);

    // Paid but the credit hasn't landed yet — don't claim a balance that
    // isn't there. Keep it honest: payment succeeded, crediting in progress.
    if (phase === 'pending') {
      return (
        <>
          <h1 className="text-[36px] md:text-[44px] font-bold tracking-tight leading-[1.05] mb-3 flex items-center gap-3">
            <Spinner />
            支付成功 · 正在入账
          </h1>
          <p className="text-[14px] text-text-secondary mb-8 max-w-[520px] leading-relaxed">
            {settleSlow
              ? '入账比平时久了一点，钱已经收到，额度马上到。可以先留在此页，或稍后到控制台查看余额；长时间未到账请联系客服。'
              : '付款已确认，正在把额度加到你的余额，马上完成…'}
          </p>
        </>
      );
    }

    // Paid but crediting failed — the money arrived, the credit didn't.
    // Surface it as a recoverable problem, never as success.
    if (phase === 'failed') {
      return (
        <>
          <h1 className="text-[36px] md:text-[44px] font-bold tracking-tight leading-[1.05] mb-3 flex items-center gap-3">
            <span className="text-red-700 bg-red-100 border-2 border-ink rounded px-2 py-0.5 text-[20px]">
              !
            </span>
            支付成功 · 入账未完成
          </h1>
          <p className="text-[14px] text-text-secondary mb-8 max-w-[520px] leading-relaxed">
            款项已收到，但额度还没成功加到你的余额。别担心，钱不会丢——我们已收到告警会尽快补上，也可以联系客服加急处理（附上订单号即可）。
          </p>
        </>
      );
    }

    const copy =
      order.skuType === 'topup'
        ? `$${order.topupAmountUsd?.toFixed(2) ?? '?'} 已加到余额，${Math.round(AUTO_REDIRECT_AFTER_PAID_MS / 1000)} 秒后自动跳回控制台。`
        : `套餐已激活，${Math.round(AUTO_REDIRECT_AFTER_PAID_MS / 1000)} 秒后自动跳回控制台。`;
    return (
      <>
        <h1 className="text-[36px] md:text-[44px] font-bold tracking-tight leading-[1.05] mb-3 flex items-center gap-3">
          <span className="text-lime-stamp-ink bg-lime-stamp border-2 border-ink rounded px-2 py-0.5 text-[20px]">
            ✓
          </span>
          支付成功
        </h1>
        <p className="text-[14px] text-text-secondary mb-8 max-w-[520px] leading-relaxed">
          {copy}
        </p>
      </>
    );
  }
  // expired / failed
  return (
    <>
      <h1 className="text-[36px] md:text-[44px] font-bold tracking-tight leading-[1.05] mb-3 flex items-center gap-3">
        <span className="text-red-700 bg-red-100 border-2 border-ink rounded px-2 py-0.5 text-[20px]">
          ✕
        </span>
        {status === 'expired' ? '订单已过期' : '订单失败'}
      </h1>
      <p className="text-[14px] text-text-secondary mb-8 max-w-[520px] leading-relaxed">
        没扣到钱不要担心。下方"重新下单"再走一遍。
      </p>
    </>
  );
}

function PendingActions({
  paymentUrl,
  qrCodeUrl,
  amount,
  currency,
  channel,
}: {
  paymentUrl?: string;
  qrCodeUrl?: string;
  amount: number;
  currency: BillingOrder['currency'];
  channel: BillingOrder['channel'];
}) {
  // Inline QR — only shown when the upstream gave us a direct image URL
  // (xunhupay does; epusdt doesn't). Hard refresh on this page loses
  // qrCodeUrl from navigation state, so we gracefully fall back to the
  // "open checkout in new tab" link below.
  if (qrCodeUrl) {
    const channelLabel = channel === 'xunhupay' ? '支付宝' : '钱包';
    const symbol = currency === 'USD' ? '$' : '¥';
    return (
      <section className={`${card} p-6 mb-6`}>
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-4">
          扫码支付
        </div>
        <div className="flex flex-col items-center">
          <img
            src={qrCodeUrl}
            alt="支付二维码"
            className="w-[220px] h-[220px] border-2 border-ink rounded-md p-2 bg-white"
            referrerPolicy="no-referrer"
          />
          <div className="mt-4 font-mono text-[12px] text-ink-2 text-center">
            用 {channelLabel} 扫描二维码支付
            <span className="ml-2 font-bold text-ink">{symbol}{amount.toFixed(2)}</span>
          </div>
          <div className="mt-1 font-mono text-[11px] text-ink-3 text-center">
            扫码后请勿关闭此页 · 支付完成自动跳转
          </div>
          {paymentUrl && (
            <a
              href={paymentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 font-mono text-[11.5px] text-ink-2 hover:text-ink underline underline-offset-4 decoration-2"
            >
              扫不出？在新窗口打开收银台 →
            </a>
          )}
        </div>
      </section>
    );
  }

  // No QR — render the original "open checkout in new tab" CTA.
  if (!paymentUrl) return null;
  return (
    <div className="flex items-center gap-3 mb-2">
      <a
        href={paymentUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={
          'inline-block px-5 py-2.5 bg-ink text-bg border-2 border-ink rounded-md text-[14px] font-bold ' +
          'shadow-[3px_3px_0_0_#1C1917] ' +
          'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
          'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
          'transition-all'
        }
      >
        重新打开支付页 →
      </a>
    </div>
  );
}

function PaidActions() {
  return (
    <div className="flex items-center gap-3 mb-2">
      <Link
        to="/console"
        className={
          'inline-block px-5 py-2.5 bg-ink text-bg border-2 border-ink rounded-md text-[14px] font-bold ' +
          'shadow-[3px_3px_0_0_#1C1917] ' +
          'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
          'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
          'transition-all'
        }
      >
        立即前往控制台 →
      </Link>
    </div>
  );
}

// Paid but the credit failed: don't offer "再充一笔" (they already paid) —
// send them to the console to check balance / contact support instead.
function SettleFailedActions() {
  return (
    <div className="flex items-center gap-3 mb-2">
      <Link
        to="/console"
        className={
          'inline-block px-5 py-2.5 bg-ink text-bg border-2 border-ink rounded-md text-[14px] font-bold ' +
          'shadow-[3px_3px_0_0_#1C1917] ' +
          'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
          'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
          'transition-all'
        }
      >
        去控制台查看 →
      </Link>
    </div>
  );
}

function FailedActions({ isTopup }: { isTopup: boolean }) {
  const to = isTopup ? '/billing/topup' : '/pricing';
  const text = isTopup ? '重新充值 →' : '重新下单 →';
  return (
    <div className="flex items-center gap-3 mb-2">
      <Link
        to={to}
        className={
          'inline-block px-5 py-2.5 bg-ink text-bg border-2 border-ink rounded-md text-[14px] font-bold ' +
          'shadow-[3px_3px_0_0_#1C1917] ' +
          'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
          'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
          'transition-all'
        }
      >
        {text}
      </Link>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className="font-mono text-[12px] text-[#A89A8D] uppercase tracking-[0.06em] flex-shrink-0">
        {label}
      </dt>
      <dd className="text-right text-ink min-w-0 flex-1">{children}</dd>
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block w-5 h-5 border-[3px] border-ink border-r-transparent rounded-full animate-spin align-middle"
      aria-hidden="true"
    />
  );
}
