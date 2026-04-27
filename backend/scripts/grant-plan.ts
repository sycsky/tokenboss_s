/**
 * Grant a paid plan to a user — same code path the epusdt webhook takes,
 * minus the order/settlement plumbing. Use to test subscription effects
 * without paying:
 *
 *   npx tsx scripts/grant-plan.ts u_7def434f01700bff31c2 plus
 *   npx tsx scripts/grant-plan.ts u_7def434f01700bff31c2 super --days=7
 *   npx tsx scripts/grant-plan.ts u_7def434f01700bff31c2 free       # downgrade
 *
 * Effects:
 *   - users.plan / subscriptionStartedAt / subscriptionExpiresAt /
 *     dailyQuotaUsd updated
 *   - newapi.updateUser: quota set to dailyQuotaUsd × 500_000, group set
 *     to the plan's group
 *
 * After running, refresh /console — hero card should reflect the new plan
 * and balance. Make a chat call with the user's sk-xxx — paid users are
 * NOT model-rewritten, so opus stays opus (newapi will then enforce
 * channel availability per the new group).
 */

try {
  process.loadEnvFile(".env.local");
} catch {
  /* env may already be set */
}

import {
  getUser,
  setUserPlan,
} from "../src/lib/store.js";
import { newapi, usdToNewapiQuota, NewapiError } from "../src/lib/newapi.js";
import { PLANS, FREE_TIER, isPlanId } from "../src/lib/plans.js";

function newapiUsername(userId: string): string {
  return userId.startsWith("u_") ? userId.slice(2) : userId.slice(0, 20);
}

function parseArgs(): { userId: string; planArg: string; days: number | null } {
  const args = process.argv.slice(2);
  const positional: string[] = [];
  let days: number | null = null;
  for (const a of args) {
    if (a.startsWith("--days=")) days = parseInt(a.slice(7), 10);
    else if (a === "-h" || a === "--help") {
      console.log("Usage: tsx scripts/grant-plan.ts <userId> <plus|super|ultra|free> [--days=N]");
      process.exit(0);
    } else positional.push(a);
  }
  if (positional.length !== 2) {
    console.error("Usage: tsx scripts/grant-plan.ts <userId> <plus|super|ultra|free> [--days=N]");
    process.exit(1);
  }
  return { userId: positional[0], planArg: positional[1], days };
}

async function main() {
  const { userId, planArg, days } = parseArgs();
  const user = await getUser(userId);
  if (!user) {
    console.error(`[grant-plan] user not found: ${userId}`);
    process.exit(1);
  }
  if (user.newapiUserId == null) {
    console.error(`[grant-plan] user ${userId} has no newapi link — cannot push quota`);
    process.exit(1);
  }

  console.log("[grant-plan] BEFORE:");
  console.log(`  plan=${user.plan ?? "null"} dailyQuotaUsd=${user.dailyQuotaUsd ?? "null"} expiresAt=${user.subscriptionExpiresAt ?? "null"}`);
  const beforeNewapi = await newapi.getUser(user.newapiUserId);
  console.log(`  newapi: quota=${beforeNewapi.quota} (${beforeNewapi.quota / 500_000} USD) group=${beforeNewapi.group}`);

  const username = newapiUsername(userId);

  if (planArg === "free") {
    setUserPlan(userId, {
      plan: "free",
      subscriptionStartedAt: null,
      subscriptionExpiresAt: null,
      dailyQuotaUsd: null,
      quotaNextResetAt: null,
    });
    await newapi.updateUser({
      id: user.newapiUserId,
      username,
      quota: usdToNewapiQuota(FREE_TIER.initialQuotaUsd),
      group: FREE_TIER.group,
    });
    console.log(`[grant-plan] downgraded ${userId} → free, quota=$${FREE_TIER.initialQuotaUsd} group=${FREE_TIER.group}`);
  } else if (isPlanId(planArg)) {
    const cfg = PLANS[planArg];
    const duration = days ?? cfg.durationDays;
    const now = Date.now();
    const startedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + duration * 86_400_000).toISOString();
    const quotaNextResetAt = new Date(now + 86_400_000).toISOString();
    setUserPlan(userId, {
      plan: planArg,
      subscriptionStartedAt: startedAt,
      subscriptionExpiresAt: expiresAt,
      dailyQuotaUsd: cfg.dailyQuotaUsd,
      quotaNextResetAt,
    });
    await newapi.updateUser({
      id: user.newapiUserId,
      username,
      quota: usdToNewapiQuota(cfg.dailyQuotaUsd),
      group: cfg.group,
    });
    console.log(`[grant-plan] activated ${planArg} for ${userId}: $${cfg.dailyQuotaUsd}/day group=${cfg.group} expires=${expiresAt} nextReset=${quotaNextResetAt}`);
  } else {
    console.error(`[grant-plan] unknown plan: ${planArg} (use plus | super | ultra | free)`);
    process.exit(1);
  }

  const afterUser = await getUser(userId);
  const afterNewapi = await newapi.getUser(user.newapiUserId);
  console.log("[grant-plan] AFTER:");
  console.log(`  plan=${afterUser?.plan} dailyQuotaUsd=${afterUser?.dailyQuotaUsd ?? "null"} expiresAt=${afterUser?.subscriptionExpiresAt ?? "null"}`);
  console.log(`  newapi: quota=${afterNewapi.quota} (${afterNewapi.quota / 500_000} USD) group=${afterNewapi.group}`);
}

main().catch((err) => {
  if (err instanceof NewapiError) {
    console.error(`[grant-plan] newapi failed: ${err.message}`);
  } else {
    console.error("[grant-plan] fatal:", err);
  }
  process.exit(1);
});
