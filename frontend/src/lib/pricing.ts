import type { Currency } from './currency';

/**
 * v1 pricing structure. RMB is the source of truth (production billing
 * runs on it); USDC numbers are clean USD-denominated equivalents with
 * ~10-12% premium baked in to cover crypto handling, FX risk, and
 * cross-timezone support cost.
 *
 * Internal USDC↔RMB conversion: 6.5 (vs market FX ~6.83), giving us a
 * ~5% spread on the standard pay-as-you-go rate.
 *
 * Quota labels uniformly use "调用额度" (call quota) — never "美金额度",
 * which collides with USDC's real-USD pricing and confuses readers.
 */

export interface TierPrice {
  /** Display string for the period price, e.g. "¥288" or "$49 USDC". */
  price: string;
  /** Period suffix, e.g. "/ 4 周". */
  period: string;
}

export interface TierEntry {
  name: 'Plus' | 'Super' | 'Ultra';
  rmb: TierPrice;
  usdc: TierPrice;
  leverage: string;
  totalQuota: string;     // e.g. "≈ $840 调用额度"
  dailyCap: string;       // e.g. "$30 cap"
  /** Usage-intensity bullets shown on the card — purpose-driven, not raw
   *  model enumeration. Pattern: "{深度|重度|极致}使用 {model family} 模型".
   *  Each entry is its own line; full model lineup lives in TierTooltip. */
  models: string[];
  /** Mirror of backend PLANS[*].soldOut — keep in sync. When true, the
   *  /pricing card and /billing/pay direct-nav both render disabled. */
  soldOut?: boolean;
}

export const TIERS: readonly TierEntry[] = [
  {
    name: 'Plus',
    rmb: { price: '¥288', period: '/ 4 周' },
    usdc: { price: '$49 USDC', period: '/ 4 周' },
    leverage: '×3',
    totalQuota: '≈ $840 调用额度',
    dailyCap: '$30 每日 Cap',
    models: ['Agent 日常跑，Codex 够用'],
  },
  {
    name: 'Super',
    rmb: { price: '¥688', period: '/ 4 周' },
    usdc: { price: '$119 USDC', period: '/ 4 周' },
    leverage: '×4',
    totalQuota: '≈ $2,240 调用额度',
    dailyCap: '$80 每日 Cap',
    models: ['Agent 重度跑，Codex + Claude 双线'],
  },
  {
    name: 'Ultra',
    rmb: { price: '¥1688', period: '/ 4 周' },
    usdc: { price: '$289 USDC', period: '/ 4 周' },
    leverage: '×12',
    totalQuota: '≈ $20,160 调用额度',
    dailyCap: '$720 每日 Cap',
    models: ['Agent 跑生产，原版模型不降级'],
    soldOut: true,
  },
] as const;

export interface StandardRate {
  /** Display: "¥1" or "$1 USDC" — the unit you pay. */
  unit: string;
  /** Display: "$1" or "$6.5" — the call-quota you receive. */
  quota: string;
  /** Min top-up label, e.g. "充值 ¥50 起" or "充值 $10 USDC 起 = $65 调用额度". */
  minTopup: string;
  /** Trial pill copy used inline, e.g. "$10 / 24h" or "$10 USDC / 24h". */
  trialPill: string;
}

export const STANDARD_RATE: Record<Currency, StandardRate> = {
  rmb: {
    unit: '¥1',
    quota: '$1',
    minTopup: '充值 ¥50 起 · 永不过期 · 全模型解锁',
    trialPill: '$10 / 24h',
  },
  usdc: {
    unit: '$1 USDC',
    quota: '$7',
    minTopup: '充值 $10 USDC 起 = $70 调用额度 · 永不过期 · 全模型解锁',
    trialPill: '$10 / 24h',
  },
};

/** Formatted price for a tier in the active currency. */
export function tierPrice(tier: TierEntry, currency: Currency): TierPrice {
  return currency === 'usdc' ? tier.usdc : tier.rmb;
}

/** Combined price + period string used in the existing TierCard `pricePeriod`. */
export function tierPricePeriod(tier: TierEntry, currency: Currency): string {
  const p = tierPrice(tier, currency);
  return `${p.price} ${p.period}`;
}
