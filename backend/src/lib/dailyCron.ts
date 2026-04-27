/**
 * Daily quota maintenance.
 *
 * Runs once a day (scheduler is in `local.ts`). For each paid subscriber:
 *   - active     → push their daily $ allowance back into newapi as `quota`
 *   - expired    → set newapi quota to 0 and downgrade their `users.plan`
 *                  back to `'free'` so the chat proxy treats them as free
 *
 * No bucket / usage_log writes — newapi is the bookkeeper now. Failures
 * on individual users are logged and skipped so a single bad row can't
 * stop the batch.
 */

import {
  getActivePaidUsers,
  getExpiredPaidUsers,
  setUserPlan,
} from "./store.js";
import { newapi, usdToNewapiQuota, NewapiError } from "./newapi.js";
import { PLANS, isPlanId, FREE_TIER } from "./plans.js";

function newapiUsername(userId: string): string {
  return userId.startsWith("u_") ? userId.slice(2) : userId.slice(0, 20);
}

export interface DailyCronResult {
  reset: number;        // active subscribers whose quota we successfully reset
  expired: number;      // subscribers whose plan we just retired
  failed: number;       // newapi calls that threw
}

export async function runDailyExpireAndReset(): Promise<DailyCronResult> {
  let reset = 0;
  let expired = 0;
  let failed = 0;

  // ---------- Active paid: refresh daily quota ----------
  for (const user of getActivePaidUsers()) {
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
