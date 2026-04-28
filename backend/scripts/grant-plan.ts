/**
 * Grant a subscription tier to a user — same code path the payment webhook
 * (or registration) takes, minus the order/auth plumbing. Use to test
 * subscription effects without actually paying:
 *
 *   npx tsx scripts/grant-plan.ts u_7def434f01700bff31c2 plus
 *   npx tsx scripts/grant-plan.ts u_7def434f01700bff31c2 trial
 *   npx tsx scripts/grant-plan.ts u_7def434f01700bff31c2 default  # downgrade
 *
 * V3 effects (newapi-as-truth — TokenBoss DB writes nothing):
 *   - For trial / plus / super / ultra:
 *       1. List existing active subs on newapi → invalidate each
 *       2. POST /api/subscription/admin/bind with NEWAPI_PLAN_ID_<tier>
 *       newapi sets group + quota + reset cadence + expiry on its own.
 *   - For default:
 *       1. List + invalidate active subs
 *       2. PUT /api/user/ {group:"default"}  (defensive — newapi normally
 *          rolls the group back automatically when a sub is cancelled)
 *
 * After running, refresh /console — the dashboard reads /v1/buckets which
 * pulls subscription state live from newapi. There's no TokenBoss-side
 * cache that could lag.
 */

try {
  process.loadEnvFile(".env.local");
} catch {
  /* env may already be set */
}

import { getUser } from "../src/lib/store.js";
import { newapi, NewapiError } from "../src/lib/newapi.js";
import {
  DEFAULT_TIER,
  getNewapiPlanId,
  type SubscriptionLabel,
} from "../src/lib/plans.js";

function newapiUsername(userId: string): string {
  return userId.startsWith("u_") ? userId.slice(2) : userId.slice(0, 20);
}

type TierArg = SubscriptionLabel | "default";
const VALID: readonly TierArg[] = ["trial", "plus", "super", "ultra", "default"];

function parseArgs(): { userId: string; tier: TierArg } {
  const args = process.argv.slice(2);
  const positional: string[] = [];
  for (const a of args) {
    if (a === "-h" || a === "--help") {
      console.log("Usage: tsx scripts/grant-plan.ts <userId> <trial|plus|super|ultra|default>");
      process.exit(0);
    } else positional.push(a);
  }
  if (positional.length !== 2) {
    console.error("Usage: tsx scripts/grant-plan.ts <userId> <trial|plus|super|ultra|default>");
    process.exit(1);
  }
  const tier = positional[1] as TierArg;
  if (!(VALID as readonly string[]).includes(tier)) {
    console.error(`unknown tier: ${tier} (use ${VALID.join(" | ")})`);
    process.exit(1);
  }
  return { userId: positional[0], tier };
}

async function invalidateActive(newapiUserId: number): Promise<void> {
  try {
    const existing = await newapi.listUserSubscriptions(newapiUserId);
    for (const sub of existing) {
      if (sub.status === "active") {
        await newapi.invalidateUserSubscription(sub.id);
        console.log(`[grant-plan] invalidated stale sub id=${sub.id} (plan_id=${sub.plan_id})`);
      }
    }
  } catch (err) {
    const msg = err instanceof NewapiError ? err.message : (err as Error).message;
    console.warn(`[grant-plan] could not list/invalidate existing subs: ${msg}`);
  }
}

async function main() {
  const { userId, tier } = parseArgs();
  const user = await getUser(userId);
  if (!user) {
    console.error(`[grant-plan] user not found: ${userId}`);
    process.exit(1);
  }
  if (user.newapiUserId == null) {
    console.error(`[grant-plan] user ${userId} has no newapi link — cannot bind`);
    process.exit(1);
  }

  const beforeNewapi = await newapi.getUser(user.newapiUserId);
  console.log("[grant-plan] BEFORE:");
  console.log(
    `  newapi: quota=${beforeNewapi.quota.toLocaleString()} (~$${(beforeNewapi.quota / 500_000).toFixed(2)}) group=${beforeNewapi.group}`,
  );

  if (tier === "default") {
    await invalidateActive(user.newapiUserId);
    await newapi.updateUser({
      id: user.newapiUserId,
      username: newapiUsername(userId),
      group: DEFAULT_TIER.group,
    });
    console.log(`[grant-plan] cleared subscription for ${userId} (newapi group → default)`);
  } else {
    const planId = getNewapiPlanId(tier);
    if (planId === null) {
      console.error(
        `[grant-plan] NEWAPI_PLAN_ID_${tier.toUpperCase()} not set in .env.local — set it to the integer id from newapi 订阅管理`,
      );
      process.exit(1);
    }
    await invalidateActive(user.newapiUserId);
    await newapi.bindSubscription({
      userId: user.newapiUserId,
      planId,
    });
    console.log(`[grant-plan] bound ${tier} (newapi plan_id=${planId}) for ${userId}`);
  }

  const afterNewapi = await newapi.getUser(user.newapiUserId);
  console.log("[grant-plan] AFTER:");
  console.log(
    `  newapi: quota=${afterNewapi.quota.toLocaleString()} (~$${(afterNewapi.quota / 500_000).toFixed(2)}) group=${afterNewapi.group}`,
  );
}

main().catch((err) => {
  if (err instanceof NewapiError) {
    console.error(`[grant-plan] newapi failed: ${err.message}`);
  } else {
    console.error("[grant-plan] fatal:", err);
  }
  process.exit(1);
});
