/**
 * 充值经济的单一配置源。倍率、起充/上限都在这里，建单 handler 与
 * 公开的 /v1/billing/config 端点共用，前端也从该端点拉取——全站一份
 * 数字，改后端环境变量即可，不会前后端漂移。
 *
 * 倍率含义：USD 渠道付 $1 → 到账 $X 额度。X 本质是美元兑人民币结算
 * 汇率（上游按人民币结算，额度即人民币用量）减去该渠道支付手续费的
 * 缓冲。按渠道分开：稳定币（USDT ~1% 手续费）留的缓冲小、给 7；
 * 卡/微信（Dodo 4%+$0.4，手续费高）留更大缓冲、给 6.88。汇率漂移时
 * 改环境变量即可（CREDIT_RATE_EPUSDT / CREDIT_RATE_DODO，或 CREDIT_RATE
 * 一起改），不接实时汇率源。
 */

import type { PaymentChannel } from "./payment/types.js";

/** 各 USD 渠道「付 $1 → 到账 $X」的默认倍率（可被 env 覆盖）。 */
export const DEFAULT_CREDIT_RATES = { epusdt: 7, dodo: 6.88 } as const;
/** 头条/兜底展示用的代表倍率 = 默认渠道（稳定币）。 */
export const DEFAULT_CREDIT_RATE = DEFAULT_CREDIT_RATES.epusdt;
export const MIN_TOPUP_AMOUNT = 1;
export const MAX_TOPUP_AMOUNT = 99999;

/** 只有 USD 计价渠道套用倍率；RMB 渠道（A2M）是 ¥1=$1，不经此表。 */
const USD_CHANNELS = ["epusdt", "dodo"] as const;
type UsdChannel = (typeof USD_CHANNELS)[number];

function envRateFor(channel: UsdChannel): number {
  const perChannel =
    channel === "dodo"
      ? process.env.CREDIT_RATE_DODO
      : process.env.CREDIT_RATE_EPUSDT;
  const raw = perChannel ?? process.env.CREDIT_RATE;
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CREDIT_RATES[channel];
}

/** 某渠道的「付 $1 → 到账 $X」倍率。非 USD 渠道返回 1（¥1=$1 直算）。 */
export function creditRateFor(channel: PaymentChannel): number {
  return (USD_CHANNELS as readonly string[]).includes(channel)
    ? envRateFor(channel as UsdChannel)
    : 1;
}

/** 前端展示用的解析后倍率表。 */
export function getCreditRates(): Record<UsdChannel, number> {
  return { epusdt: envRateFor("epusdt"), dodo: envRateFor("dodo") };
}
