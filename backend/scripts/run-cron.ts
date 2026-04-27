/**
 * Manually trigger the daily expire+reset cron without waiting for 0:00.
 * Use to test plan reset / expiry behavior.
 *
 *   cd backend && npx tsx scripts/run-cron.ts
 *
 * Effects:
 *   - active paid subscribers: newapi quota reset to dailyQuotaUsd × 500_000
 *   - expired paid subscribers: newapi quota → 0, plan → 'free'
 *   - free users: untouched
 */

try {
  process.loadEnvFile(".env.local");
} catch {
  /* env may already be set */
}

import { runDailyExpireAndReset } from "../src/lib/dailyCron.js";

const result = await runDailyExpireAndReset();
console.log("[cron] result:", result);
