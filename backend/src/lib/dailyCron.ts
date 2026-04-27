/**
 * Per-user quota maintenance.
 *
 * Each paid subscriber has a `quotaNextResetAt` timestamp that ticks
 * forward by 24h from the moment they activated. Cron runs every N
 * minutes (configurable via QUOTA_CRON_INTERVAL_MINUTES, default 60),
 * sweeps users whose window is up, pushes a fresh daily quota into
 * newapi, and bumps `quotaNextResetAt` by another 24h.
 *
 * Separately, expired subscribers (subscriptionExpiresAt <= now) get
 * their quota zeroed and downgraded back to plan='free'.
 *
 * No bucket / usage_log writes — newapi is the bookkeeper now. Failures
 * on individual users are logged and skipped so a single bad row can't
 * stop the batch.
 */

import {
  advanceQuotaNextResetAt,
  getExpiredPaidUsers,
  getUsersDueForReset,
  setUserPlan,
} from "./store.js";
import { newapi, usdToNewapiQuota, NewapiError } from "./newapi.js";
import { PLANS, isPlanId, FREE_TIER } from "./plans.js";

function newapiUsername(userId: string): string {
  return userId.startsWith("u_") ? userId.slice(2) : userId.slice(0, 20);
}

export interface QuotaCronResult {
  reset: number;        // active subscribers whose quota we successfully reset
  expired: number;      // subscribers whose plan we just retired
  failed: number;       // newapi calls that threw
}

export async function runQuotaSweep(): Promise<QuotaCronResult> {
  let reset = 0;
  let expired = 0;
  let failed = 0;

  // ---------- Active paid: refresh quota for users whose 24h is up ----------
  for (const user of getUsersDueForReset()) {
    if (!isPlanId(user.plan)) continue;
    if (user.newapiUserId == null) continue;
    const cfg = PLANS[user.plan];
    const dailyUsd = user.dailyQuotaUsd ?? cfg.dailyQuotaUsd;

    try {
      await newapi.updateUser({
        id: user.newapiUserId,
        username: newapiUsername(user.userId),
        quota: usdToNewapiQuota(dailyUsd),
        group: cfg.group,
      });
      advanceQuotaNextResetAt(user.userId);
      reset++;
    } catch (err) {
      failed++;
      const msg = err instanceof NewapiError ? err.message : (err as Error).message;
      console.error(
        `[cron] reset failed user=${user.userId} plan=${user.plan}: ${msg}`,
      );
    }
  }

  // ---------- Expired paid: zero quota + downgrade ----------
  for (const user of getExpiredPaidUsers()) {
    if (user.newapiUserId == null) {
      // Nothing to push to newapi; just downgrade locally.
      setUserPlan(user.userId, {
        plan: "free",
        subscriptionStartedAt: null,
        subscriptionExpiresAt: null,
        dailyQuotaUsd: null,
        quotaNextResetAt: null,
      });
      expired++;
      continue;
    }
    try {
      await newapi.updateUser({
        id: user.newapiUserId,
        username: newapiUsername(user.userId),
        quota: 0,
        group: FREE_TIER.group,
      });
      setUserPlan(user.userId, {
        plan: "free",
        subscriptionStartedAt: null,
        subscriptionExpiresAt: null,
        dailyQuotaUsd: null,
        quotaNextResetAt: null,
      });
      expired++;
    } catch (err) {
      failed++;
      const msg = err instanceof NewapiError ? err.message : (err as Error).message;
      console.error(
        `[cron] expire failed user=${user.userId}: ${msg}`,
      );
    }
  }

  return { reset, expired, failed };
}

// Backward-compat alias — old name from the calendar-day cron era. New
// code should call runQuotaSweep directly.
export const runDailyExpireAndReset = runQuotaSweep;
