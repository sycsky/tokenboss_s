import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppNav } from '../components/AppNav';
import { ChannelOption } from '../components/ChannelOption';
import { RedeemCodeModal } from '../components/RedeemCodeModal';
import { dispatchCheckout } from '../lib/checkoutFlow';
import { api, type BillingChannel } from '../lib/api';

const card = 'bg-white border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917]';

/** 人民币走 Agent 内支付宝充值（A2M 402 协议），面额必须与后端
 *  ALIPAY_A2M_SERVICE_TIERS 注册的服务档位一致（服务市场一档一价，
 *  单笔上限 ¥50）。0.01 验证档是运维用的，不对用户展示。 */
const A2M_DENOMS = [10, 50] as const;

/** 美元渠道（USDT / 卡·微信）充值档位，$10 起充、整数。 */
const USD_PRESETS = [10, 20, 50, 100] as const;

/** fetch 失败/加载中的兜底默认；权威值来自后端 /v1/billing/config，
 *  正常情况下会被拉到的配置覆盖，不再前后端各写一份倍率。 */
const FALLBACK_RATE = 6.8;
const FALLBACK_MIN = 10;
const FALLBACK_MAX = 99999;

/** ×倍率后可能有浮点尾巴（11×6.8=74.8000…1），显示 round 到分。 */
function creditFor(usd: number, rate: number): number {
  return Math.round(usd * rate * 100) / 100;
}

function agentPrompt(denom: number): string {
  return `帮我给 TokenBoss 充值 ${denom} 元（支付宝 AI 付，按 skill.md 的 402 充值流程）`;
}

/** 支付方式决定路径（gh-6）：
 *    a2m  → 人民币 · Agent 内支付宝（网页不收单）
 *    usdt → 美元 · USDT 网页支付（epusdt）
 *    dodo → 美元 · 银行卡/微信托管收银台（Dodo MoR）
 *  xunhupay 已下线。 */
type PayMethod = 'a2m' | 'usdt' | 'dodo';

/** 支付宝 AI 收款（A2M）因商户风控暂时下线整条 UI 链路；解封后改回
 *  true 即恢复（后端 402 端点保持在线，老订单不受影响）。 */
const SHOW_ALIPAY_A2M = false;

/** Dodo（卡/微信）渠道网关：正式环境的 DODO_* 变量配齐、Dodo 商户
 *  审核通过前保持 false，避免用户点了「卡·微信」却拿到 503。上线时
 *  改回 true 即可（后端缺变量本身也会 503 兜底，这里是不给坏入口）。 */
const SHOW_DODO = false;

/** 币种自由充值渠道里，永远可用的那个（USDT）——A2M/Dodo 都隐藏时
 *  兜底选它，保证充值页始终有一条能走通的路。 */
const DEFAULT_METHOD: PayMethod = SHOW_ALIPAY_A2M
  ? 'a2m'
  : 'usdt';
type UsdPreset = (typeof USD_PRESETS)[number] | 'custom';

export default function Topup() {
  const navigate = useNavigate();

  const [method, setMethod] = useState<PayMethod>(DEFAULT_METHOD);

  // —— 人民币 · Agent 充值 ——
  const [denom, setDenom] = useState<(typeof A2M_DENOMS)[number]>(A2M_DENOMS[1]);
  const [copied, setCopied] = useState(false);

  // —— 美元 · 网页充值（USDT / 卡·微信 共用金额区） ——
  const channel: BillingChannel = method === 'dodo' ? 'dodo' : 'epusdt';
  const [preset, setPreset] = useState<UsdPreset>(USD_PRESETS[0]);
  const [customAmountStr, setCustomAmountStr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [redeemOpen, setRedeemOpen] = useState(false);

  // 充值配置（倍率/起充/上限）从后端拉，权威源单一。拉到前用兜底默认，
  // 到账额度实际以后端结算为准，短暂显示兜底值不影响正确性。
  const [cfg, setCfg] = useState<{
    rates: { epusdt: number; dodo: number };
    min: number;
    max: number;
  }>({ rates: { epusdt: FALLBACK_RATE, dodo: FALLBACK_RATE }, min: FALLBACK_MIN, max: FALLBACK_MAX });
  useEffect(() => {
    let alive = true;
    api
      .billingConfig()
      .then((c) => {
        if (alive) setCfg({ rates: c.creditRates, min: c.minTopup, max: c.maxTopup });
      })
      .catch(() => {
        /* 拉取失败保持兜底默认；结算仍以后端为准 */
      });
    return () => {
      alive = false;
    };
  }, []);
  const rate = method === 'dodo' ? cfg.rates.dodo : cfg.rates.epusdt;
  const MIN_AMOUNT = cfg.min;
  const MAX_AMOUNT = cfg.max;

  async function copyAgentPrompt() {
    try {
      await navigator.clipboard.writeText(agentPrompt(denom));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard 不可用（非 https 等）— 用户仍可手动选中复制 */
    }
  }

  // Resolve the integer USD amount. Returns null when invalid.
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
  }, [method, preset, customAmountStr]);

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

        {/* Currency picker — 币种决定支付路径 */}
        <section className="mb-6">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-3">
            支付方式
          </div>
          <div
            className={`grid grid-cols-1 gap-3 ${
              { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3' }[
                [SHOW_ALIPAY_A2M, true, SHOW_DODO].filter(Boolean).length
              ] ?? 'sm:grid-cols-2'
            }`}
          >
            {SHOW_ALIPAY_A2M && (
              <ChannelOption
                active={method === 'a2m'}
                onClick={() => setMethod('a2m')}
                title="支付宝"
                subtitle="人民币 · 在你的 Agent 里完成充值"
                tag="推荐"
              />
            )}
            <ChannelOption
              active={method === 'usdt'}
              onClick={() => setMethod('usdt')}
              title="稳定币"
              subtitle="USDT / USDC · 多链可选"
              tag="海外友好"
            />
            {SHOW_DODO && (
              <ChannelOption
                active={method === 'dodo'}
                onClick={() => setMethod('dodo')}
                title="卡 · 微信"
                subtitle="Visa / 银联 / 微信扫码 · 美元计价"
                tag="USD"
              />
            )}
          </div>
        </section>

        {method === 'a2m' ? (
          /* —— 人民币：Agent 内支付宝充值（A2M 402） —— */
          <section className="mb-6">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-3">
              充值面额
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {A2M_DENOMS.map((d) => (
                <PresetChip
                  key={d}
                  active={denom === d}
                  onClick={() => setDenom(d)}
                  label={`¥${d}`}
                />
              ))}
            </div>

            <div className={`${card} p-5`}>
              <p className="text-[13.5px] text-text-secondary leading-relaxed mb-4">
                复制下面这句话发给你的 Agent，它会走支付宝 AI 付完成充值——你只
                需要在支付宝里确认付款，全程不离开对话。
              </p>
              <div className="flex items-stretch gap-2">
                <code className="flex-1 font-mono text-[12.5px] leading-relaxed p-3 bg-bg border-2 border-ink rounded-md break-all select-all">
                  {agentPrompt(denom)}
                </code>
                <button
                  type="button"
                  onClick={copyAgentPrompt}
                  className={
                    'px-4 border-2 border-ink rounded-md font-mono text-[12px] font-bold whitespace-nowrap ' +
                    'shadow-[3px_3px_0_0_#1C1917] hover:translate-x-[1px] hover:translate-y-[1px] ' +
                    'hover:shadow-[1px_1px_0_0_#1C1917] transition-all ' +
                    (copied ? 'bg-ink text-bg' : 'bg-white text-ink')
                  }
                >
                  {copied ? '已复制 ✓' : '复制'}
                </button>
              </div>
              <div className="mt-4 flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold">
                  支持的 Agent
                </span>
                {['OpenClaw', 'Claude Code', 'Hermes'].map((a) => (
                  <span
                    key={a}
                    className="font-mono text-[11px] font-bold px-2 py-0.5 border-2 border-ink rounded bg-bg"
                  >
                    {a}
                  </span>
                ))}
              </div>
              <div className="mt-3 font-mono text-[11px] text-ink-3 leading-relaxed">
                · 到账 ${denom} 美金额度（¥1 = $1），单笔上限 ¥50<br />
                · 未安装支付宝 AI 付时，对 Agent 说：运行 npx -y @alipay/agent-payment@latest install
              </div>
            </div>
          </section>
        ) : (
          /* —— 美元：USDT 网页充值（epusdt） —— */
          <section className="mb-6">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-3">
              充值金额
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              {USD_PRESETS.map((p) => (
                <PresetChip
                  key={p}
                  active={preset === p}
                  onClick={() => setPreset(p)}
                  label={`$${p}`}
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
                  金额（$，{MIN_AMOUNT}-{MAX_AMOUNT} 的整数）
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
                → 到账 <span className="font-bold text-ink">${creditFor(amount, rate)}</span> 额度
                <span className="text-ink-3">
                  {method === 'dodo'
                    ? ` · 付 $${amount}（微信/卡按人民币结算约 ¥${Math.round(amount * rate)}）`
                    : ` · 付 $${amount} USDT`}
                </span>
              </div>
            )}
          </section>
        )}

        {/* Error（仅美元网页下单会产生） */}
        {method !== 'a2m' && error && (
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
          {method !== 'a2m' && (
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
                : `去付款 · $${amount}`}
            </button>
          )}
        </div>

        <div className="mt-10 font-mono text-[11.5px] text-ink-3 leading-relaxed">
          · 充值后立即到账，永不过期，全模型可用<br />
          ·{' '}
          <Link
            to="/refund"
            className="text-ink-3 hover:text-ink underline underline-offset-4 decoration-1"
          >
            充值不支持退款
          </Link>
          <br />
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
