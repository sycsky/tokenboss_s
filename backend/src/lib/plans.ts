/**
 * Subscription plan catalog. Single source of truth for:
 *   - pricing (CNY) used at order creation in paymentHandlers
 *   - subscription duration in days (default 28)
 *   - newapi user `group` name (matches the plan's upgrade_group in newapi)
 *   - mapping from TokenBoss plan id → newapi subscription plan id (env)
 *
 * As of the V3 newapi-as-truth migration (in progress), TokenBoss is moving
 * away from pushing daily quota numbers into newapi.user.quota. The new
 * model uses newapi's native subscription module: on register / on payment
 * we call `POST /api/subscription/admin/bind` and newapi sets the user's
 * group + quota + reset cadence according to the plan configured there.
 *
 * Adding or renaming a plan: edit this object. Type-level `PlanId` derives
 * from its keys so callers stay in sync.
 */

export interface PlanConfig {
  /** Display name (Chinese) for invoices / dashboard. */
  displayName: string;
  /** RMB price for one billing cycle — used when channel is xunhupay
   *  (Alipay/WeChat, both quote CNY natively). */
  priceCNY: number;
  /** USD price for one billing cycle — used when channel is epusdt
   *  (USDT-TRC20). NOT a derived value: priced independently of CNY
   *  with a small markup for crypto handling + FX risk, mirroring the
   *  marketing copy on the Plans page (¥288 → $49, etc.). */
  priceUSD: number;
  /** Subscription length in days. Default cycle is 28 (= 4 weeks) so the
   *  expiry date matches the "/ 4 周" copy on the marketing/Plans page. */
  durationDays: number;
  /** newapi user-group name applied on subscription start. Should match
   *  the corresponding plan's `upgrade_group` field in newapi admin. */
  group: string;
  /** Marketing-side "sold out" flag. When true, paymentHandlers rejects
   *  new orders with 410 and the /pricing card renders disabled — used to
   *  freeze a tier without removing it from the catalog (so existing
   *  subscribers still resolve, dailyCron still runs, etc.). */
  soldOut?: boolean;
}

export const PLANS = {
  plus: {
    displayName: "Plus",
    priceCNY: 288,
    priceUSD: 49,
    durationDays: 28,
    group: "plus",
    soldOut: false,
  },
  super: {
    displayName: "Super",
    priceCNY: 688,
    priceUSD: 119,
    durationDays: 28,
    group: "super",
    soldOut: false,
  },
  ultra: {
    displayName: "Ultra",
    priceCNY: 1688,
    priceUSD: 289,
    durationDays: 28,
    group: "ultra",
    soldOut: true,
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

/**
 * USD-side counterpart of getPlanPriceCNY. Used for crypto channels
 * (epusdt) which quote in USD then convert to USDT at gateway-side rate.
 *
 * Env override pattern is parallel: `PLAN_PRICE_<PLANID>_USD=5` flips
 * Plus to $5 in production for end-to-end testing without source edits.
 *
 * Notes:
 *   • epusdt has a per-instance minimum (commonly 0.5 USDT). At a 1:1
 *     USD-to-USDT rate that means USD overrides need to be ≥ 0.5.
 *   • CNY and USD prices are NOT derived from each other — both are
 *     independent product decisions (the USD pricing intentionally bakes
 *     in a small markup vs the FX-converted CNY price).
 */
export function getPlanPriceUSD(planId: PlanId): number {
  const envKey = `PLAN_PRICE_${planId.toUpperCase()}_USD`;
  const raw = process.env[envKey];
  if (raw) {
    const v = parseFloat(raw);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return PLANS[planId].priceUSD;
}

/**
 * Trial defaults. New registrations are bound to the trial subscription
 * (1 day, $10 quota, never auto-resets) via newapi's subscription module.
 * The newapi-side plan id is configured via NEWAPI_PLAN_ID_TRIAL — title-
 * based lookup is fragile because the admin can rename the plan.
 */
export const TRIAL_TIER = {
  /** Local DB plan label. Not a key in PLANS — trial isn't sellable. */
  plan: "trial",
  /** newapi user-group name set by the trial subscription. */
  group: "trial",
  /** Days of trial validity. Matches the newapi Trial plan's duration. */
  durationDays: 1,
} as const;

/**
 * Default fallback newapi group. NOT a TokenBoss subscription — when the
 * cron expires a user, the local `users.plan` is cleared (set to null) and
 * the newapi user is moved into this group. Newapi's default-group config
 * (in the admin UI) decides what these users can still do.
 */
export const DEFAULT_TIER = {
  group: "default",
} as const;

/**
 * newapi subscription plan id mapping. newapi uses integer ids (auto-
 * incremented in its DB), so we can't hardcode them — different deploys
 * end up with different ids. Configure via env:
 *
 *   NEWAPI_PLAN_ID_TRIAL=2
 *   NEWAPI_PLAN_ID_PLUS=1
 *   NEWAPI_PLAN_ID_SUPER=3
 *   NEWAPI_PLAN_ID_ULTRA=4
 *
 * Look these up in the newapi admin UI under 订阅管理 (or via
 * `GET /api/subscription/admin/plans`).
 */
export type SubscriptionLabel = "trial" | PlanId;

export function getNewapiPlanId(label: SubscriptionLabel): number | null {
  const envKey = `NEWAPI_PLAN_ID_${label.toUpperCase()}`;
  const raw = process.env[envKey];
  if (!raw) return null;
  const v = parseInt(raw, 10);
  return Number.isFinite(v) && v > 0 ? v : null;
}
