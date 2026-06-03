import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppNav } from '../components/AppNav';
import { ChannelOption } from '../components/ChannelOption';
import { RedeemCodeModal } from '../components/RedeemCodeModal';
import { dispatchCheckout } from '../lib/checkoutFlow';
import { api, type BillingChannel } from '../lib/api';

const card = 'bg-white border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917]';

const PRESETS = [50, 100, 500] as const;
const MIN_AMOUNT = 1;
const MAX_AMOUNT = 99999;
/** Must match backend USD_TO_CREDIT_RATE in paymentHandlers.ts.
 *  USDT 渠道下付 $1 → 到账 $7 等价额度（按汇率把美金折算回人民币等价，
 *  再用 ¥1 = $1 baseline 转额度）。RMB 渠道 1:1 不动。 */
const USD_TO_CREDIT_RATE = 7;

type Preset = (typeof PRESETS)[number] | 'custom';

export default function Topup() {
  const navigate = useNavigate();

  const [channel, setChannel] = useState<BillingChannel>('xunhupay');
  const [preset, setPreset] = useState<Preset>(PRESETS[0]);
  const [customAmountStr, setCustomAmountStr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [redeemOpen, setRedeemOpen] = useState(false);

  // Channel drives currency: xunhupay → ¥, epusdt → $.
  const symbol = channel === 'epusdt' ? '$' : '¥';

  // Resolve the integer amount. Returns null when invalid.
  function resolveAmount(): number | null {
    if (preset !== 'custom') return preset;
    const trimmed = customAmountStr.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
    if (n < MIN_AMOUNT || n > MAX_AMOUNT) return null;
    return n;
  }
  const amount = resolveAmount();

  // Clear stale submit error as soon as the user edits any input.
  useEffect(() => {
    setError(null);
  }, [channel, preset, customAmountStr]);

  async function submit() {
    if (amount == null) {
      setError(`金额必须是 ${MIN_AMOUNT}-${MAX_AMOUNT} 之间的整数`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.createOrder({ type: 'topup', amount, channel });
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
        <div className="font-mono text-[11px] tracking-[0.06em] text-[#A89A8D] mb-4">
          <Link to="/console" className="hover:text-ink transition-colors">控制台</Link>
          <span className="mx-2 text-[#D9CEC2]">/</span>
          <span className="text-ink-2">充值</span>
        </div>

        {/* Eyebrow */}
        <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[#A89A8D] font-bold mb-3">
          BILLING · 充值
        </div>
        <h1 className="text-[36px] md:text-[44px] font-bold tracking-tight leading-[1.05] mb-3">
          充值额度
        </h1>
        <p className="text-[14px] text-text-secondary mb-8 max-w-[520px] leading-relaxed">
          永不过期 · 解锁全模型 · ¥1 = $1
        </p>

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

        {/* Amount picker */}
        <section className="mb-6">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-3">
            充值金额
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            {PRESETS.map((p) => (
              <PresetChip
                key={p}
                active={preset === p}
                onClick={() => setPreset(p)}
                label={`${symbol}${p}`}
              />
            ))}
            <PresetChip
              active={preset === 'custom'}
              onClick={() => setPreset('custom')}
              label="自定义"
            />
          </div>

          {preset === 'custom' && (
            <div className={`${card} p-4 mb-3`}>
              <label
                htmlFor="topup-amount"
                className="block font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-2"
              >
                金额（{symbol}，{MIN_AMOUNT}-{MAX_AMOUNT} 的整数）
              </label>
              <input
                id="topup-amount"
                type="number"
                inputMode="numeric"
                step={1}
                min={MIN_AMOUNT}
                max={MAX_AMOUNT}
                value={customAmountStr}
                onChange={(e) => setCustomAmountStr(e.target.value)}
                aria-invalid={customAmountStr.trim() !== '' && amount == null}
                aria-describedby={customAmountStr.trim() !== '' && amount == null ? 'topup-amount-error' : undefined}
                className="w-full font-mono text-[18px] font-bold p-2 border-2 border-ink rounded bg-white"
                placeholder={`${MIN_AMOUNT}`}
              />
              {customAmountStr.trim() !== '' && amount == null && (
                <div
                  id="topup-amount-error"
                  className="mt-2 font-mono text-[11px] text-red-700"
                >
                  金额必须是 {MIN_AMOUNT}-{MAX_AMOUNT} 之间的整数
                </div>
              )}
            </div>
          )}

          {amount != null && (
            <div className="font-mono text-[12px] text-text-secondary">
              → 到账 ${channel === 'epusdt' ? amount * USD_TO_CREDIT_RATE : amount} 美金
              {channel === 'epusdt' && (
                <span className="text-ink-3"> · $1 USDT ≈ $7 额度（按汇率折算）</span>
              )}
            </div>
          )}
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
            to="/console"
            className="font-mono text-[12.5px] text-ink-2 hover:text-ink underline underline-offset-4 decoration-2"
          >
            ← 返回控制台
          </Link>
          <button
            onClick={submit}
            disabled={submitting || amount == null}
            className={
              'px-6 py-3 bg-ink text-bg border-2 border-ink rounded-md text-[14px] font-bold ' +
              'shadow-[3px_3px_0_0_#1C1917] ' +
              (submitting || amount == null
                ? 'opacity-60 cursor-not-allowed'
                : 'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
                  'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
                  'transition-all')
            }
          >
            {submitting
              ? '生成订单中…'
              : preset === 'custom' && customAmountStr.trim() === ''
              ? '请输入金额'
              : amount == null
              ? '金额无效'
              : `去付款 · ${symbol}${amount}`}
          </button>
        </div>

        <div className="mt-10 font-mono text-[11.5px] text-ink-3 leading-relaxed">
          · 充值后立即到账，永不过期，全模型可用<br />
          · 充值不支持退款<br />
          ·{' '}
          <button
            type="button"
            onClick={() => setRedeemOpen(true)}
            className="text-ink-2 hover:text-ink underline underline-offset-4 decoration-2"
          >
            已有兑换码？
          </button>
        </div>
      </main>

      <RedeemCodeModal open={redeemOpen} onClose={() => setRedeemOpen(false)} />
    </div>
  );
}

function PresetChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  const base =
    'block w-full text-center px-4 py-3 border-2 border-ink rounded-md font-mono text-[14px] font-bold transition-all';
  const onState = active
    ? 'bg-ink text-bg shadow-[3px_3px_0_0_#1C1917]'
    : 'bg-white text-ink shadow-[3px_3px_0_0_#1C1917] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_0_#1C1917]';
  return (
    <button onClick={onClick} className={`${base} ${onState}`} type="button">
      {label}
    </button>
  );
}
