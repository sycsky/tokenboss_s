import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AppNav } from '../components/AppNav';
import { api, type BillingOrder, type BillingStatus } from '../lib/api';

const card = 'bg-white border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917]';

const POLL_INTERVAL_MS = 3000;
// Stop polling after 30 minutes — gateway sessions usually expire by then
// and continued polling just burns the user's API quota for nothing.
const POLL_MAX_DURATION_MS = 30 * 60 * 1000;
const AUTO_REDIRECT_AFTER_PAID_MS = 3000;

const PLAN_LABEL: Record<string, string> = {
  plus: 'Plus',
  super: 'Super',
  ultra: 'Ultra',
};

const CHANNEL_LABEL: Record<string, string> = {
  xunhupay: '支付宝',
  epusdt: 'USDT-TRC20',
};

export default function OrderStatus() {
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
      if (isTerminal(res.order.status)) stoppedRef.current = true;
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

  // Auto-redirect to /console once paid — gives the user 3s to read the
  // success copy. Manual escape hatch is the link below.
  useEffect(() => {
    if (order?.status !== 'paid') return;
    const t = setTimeout(() => navigate('/console'), AUTO_REDIRECT_AFTER_PAID_MS);
    return () => clearTimeout(t);
  }, [order?.status, navigate]);

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
        <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[#A89A8D] font-bold mb-3">
          BILLING · 订单状态
        </div>
        <h1 className="text-[28px] font-bold mb-3">加载订单中…</h1>
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
    <Shell>
      <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[#A89A8D] font-bold mb-3">
        BILLING · 订单状态
      </div>

      <StatusHero status={order.status} hasQr={!!navState.qrCodeUrl} />

      {/* Order summary */}
      <section className={`${card} p-6 mb-6`}>
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-4">
          订单信息
        </div>
        <dl className="space-y-2">
          <Row label="订单号">
            <span className="font-mono text-[12px] break-all">{order.orderId}</span>
          </Row>
          <Row label="套餐">
            <span className="font-bold">{PLAN_LABEL[order.planId] ?? order.planId}</span>
          </Row>
          <Row label="渠道">
            <span>{CHANNEL_LABEL[order.channel] ?? order.channel}</span>
          </Row>
          <Row label="金额">
            <span className="font-mono">¥{order.amountCNY.toFixed(2)}</span>
            {order.channel === 'epusdt' && order.amountActual ? (
              <span className="ml-2 font-mono text-[12px] text-text-secondary">
                ≈ {order.amountActual.toFixed(4)} USDT
              </span>
            ) : null}
          </Row>
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
          amountCNY={order.amountCNY}
          channel={order.channel}
        />
      )}
      {order.status === 'paid' && <PaidActions />}
      {(order.status === 'expired' || order.status === 'failed') && <FailedActions />}

      <div className="mt-8 flex items-center justify-between flex-wrap gap-3">
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
    </Shell>
  );
}

function isTerminal(s: BillingStatus): boolean {
  return s === 'paid' || s === 'expired' || s === 'failed';
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg pb-12">
      <AppNav current="console" />
      <main className="max-w-[680px] mx-auto px-5 sm:px-9 pt-6">
        <div className="font-mono text-[11px] tracking-[0.06em] text-[#A89A8D] mb-4">
          <Link to="/console" className="hover:text-ink transition-colors">控制台</Link>
          <span className="mx-2 text-[#D9CEC2]">/</span>
          <Link to="/pricing" className="hover:text-ink transition-colors">套餐</Link>
          <span className="mx-2 text-[#D9CEC2]">/</span>
          <span className="text-ink-2">订单</span>
        </div>
        {children}
      </main>
    </div>
  );
}

function StatusHero({ status, hasQr }: { status: BillingStatus; hasQr: boolean }) {
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
    return (
      <>
        <h1 className="text-[36px] md:text-[44px] font-bold tracking-tight leading-[1.05] mb-3 flex items-center gap-3">
          <span className="text-lime-stamp-ink bg-lime-stamp border-2 border-ink rounded px-2 py-0.5 text-[20px]">
            ✓
          </span>
          支付成功
        </h1>
        <p className="text-[14px] text-text-secondary mb-8 max-w-[520px] leading-relaxed">
          套餐已激活，{Math.round(AUTO_REDIRECT_AFTER_PAID_MS / 1000)} 秒后自动跳回控制台。
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
  amountCNY,
  channel,
}: {
  paymentUrl?: string;
  qrCodeUrl?: string;
  amountCNY: number;
  channel: BillingOrder['channel'];
}) {
  // Inline QR — only shown when the upstream gave us a direct image URL
  // (xunhupay does; epusdt doesn't). Hard refresh on this page loses
  // qrCodeUrl from navigation state, so we gracefully fall back to the
  // "open checkout in new tab" link below.
  if (qrCodeUrl) {
    const channelLabel = channel === 'xunhupay' ? '支付宝' : '钱包';
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
            <span className="ml-2 font-bold text-ink">¥{amountCNY.toFixed(2)}</span>
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

function FailedActions() {
  return (
    <div className="flex items-center gap-3 mb-2">
      <Link
        to="/pricing"
        className={
          'inline-block px-5 py-2.5 bg-ink text-bg border-2 border-ink rounded-md text-[14px] font-bold ' +
          'shadow-[3px_3px_0_0_#1C1917] ' +
          'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
          'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
          'transition-all'
        }
      >
        重新下单 →
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
