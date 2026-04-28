/**
 * Subscription plan catalog. Single source of truth for:
 *   - pricing (CNY) used at order creation in paymentHandlers
 *   - daily $ quota that paymentWebhook + dailyCron push into newapi
 *   - subscription duration in days (default 30)
 *   - newapi user `group` to assign on subscription start
 *
 * Adding or renaming a plan: edit this object. Type-level `PlanId` derives
 * from its keys so callers stay in sync.
 *
 * `group` is a hint for newapi — TokenBoss does NOT create/manage groups
 * itself. If your newapi instance doesn't have `plus` / `super` / `ultra`
 * configured, newapi will silently fall back to `default`. Quota
 * enforcement still works because it lives on the user row, not the group.
 */

export interface PlanConfig {
  /** Display name (Chinese) for invoices / dashboard. */
  displayName: string;
  /** RMB price for one billing cycle. */
  priceCNY: number;
  /** Daily $ allowance pushed into newapi.quota at midnight. */
  dailyQuotaUsd: number;
  /** Subscription length in days. Default cycle is 28 (= 4 weeks) so the
   *  expiry date matches the "/ 4 周" copy on the marketing/Plans page. */
  durationDays: number;
  /** newapi user-group name applied on subscription start. */
  group: string;
}

export const PLANS = {
  plus: {
    displayName: "Plus",
    priceCNY: 288,
    dailyQuotaUsd: 30,
    durationDays: 28,
    group: "plus",
  },
  super: {
    displayName: "Super",
    priceCNY: 688,
    dailyQuotaUsd: 80,
    durationDays: 28,
    group: "super",
  },
  ultra: {
    displayName: "Ultra",
    priceCNY: 1688,
    dailyQuotaUsd: 720,
    durationDays: 28,
    group: "ultra",
  },
} as const satisfies Record<string, PlanConfig>;

export type PlanId = keyof typeof PLANS;

export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === "string" && (PLAN_IDS as readonly string[]).includes(v);
}

/**
 * Resolve the effective CNY price for a plan, honouring an optional env
 * override of the form `PLAN_PRICE_<PLANID>_CNY=<number>`.
 *
 * Use case: end-to-end payment testing in production (or any deployed
 * environment) without touching source. Set e.g. `PLAN_PRICE_PLUS_CNY=10`
 * in Zeabur Variables, redeploy the backend, run a real ¥10 order through
 * 支付宝/USDT, then unset the var to restore the real price.
 *
 * Notes:
 *   • USDT (epusdt) channels reject amounts under their per-instance min
 *     (commonly 0.5 USDT ≈ ¥4). Pick override ≥ ¥5 if you plan to test
 *     the crypto path.
 *   • Frontend pricing copy in `frontend/src/lib/pricing.ts` is NOT tied
 *     to this — the displayed price stays the marketing one even with
 *     the override on. The amount the user actually pays at the gateway
 *     is what this function returns.
 */
export function getPlanPriceCNY(planId: PlanId): number {
  const envKey = `PLAN_PRICE_${planId.toUpperCase()}_CNY`;
  const raw = process.env[envKey];
  if (raw) {
    const v = parseFloat(raw);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return PLANS[planId].priceCNY;
}

/** Free-tier defaults. Free users are NOT in `PLANS` — they get a
 *  one-shot $10 quota at signup with no daily reset. The `free` group on
 *  newapi can be configured to restrict eco-only channels if you want
 *  defense-in-depth on top of TokenBoss's silent model rewrite. */
export const FREE_TIER = {
  initialQuotaUsd: 10,
  group: "free",
} as const;
