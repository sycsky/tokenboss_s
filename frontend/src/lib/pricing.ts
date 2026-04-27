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
  models: string;
  tooltipExtras?: string[];
}

export const TIERS: readonly TierEntry[] = [
  {
    name: 'Plus',
    rmb: { price: '¥288', period: '/ 4 周' },
    usdc: { price: '$49 USDC', period: '/ 4 周' },
    leverage: '×3',
    totalQuota: '≈ $840 调用额度',
    dailyCap: '$30 每日 cap',
    models: 'Codex 系列模型',
    tooltipExtras: ['智能路由 · 多端复用 · API key 多端共享'],
  },
  {
    name: 'Super',
    rmb: { price: '¥688', period: '/ 4 周' },
    usdc: { price: '$119 USDC', period: '/ 4 周' },
    leverage: '×4',
    totalQuota: '≈ $2,240 调用额度',
    dailyCap: '$80 每日 cap',
    models: 'Claude + Codex 系列模型',
    tooltipExtras: ['含 Sonnet 4.7 / Opus 4.7 · 优先排队 · 高峰不降级'],
  },
  {
    name: 'Ultra',
    rmb: { price: '¥1688', period: '/ 4 周' },
    usdc: { price: '$289 USDC', period: '/ 4 周' },
    leverage: '×12',
    totalQuota: '≈ $20,160 调用额度',
    dailyCap: '$720 每日 cap',
    models: 'Claude + Codex + reasoning',
    tooltipExtras: ['含 reasoning (o1/o3) · 专属客服 · SLA · 定制路由策略'],
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
    quota: '$6.5',
    minTopup: '充值 $10 USDC 起 = $65 调用额度 · 永不过期 · 全模型解锁',
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
