/**
 * Manual recovery script for topup orders that landed settleStatus='failed'.
 * Mirrors applyTopupToUser in paymentWebhook.ts exactly: admin-mint a
 * one-shot redemption code via newapi, then log in as the user and redeem it.
 *
 * Use when:
 *   SELECT orderId, status, settleStatus FROM orders
 *   WHERE userId = (SELECT userId FROM users WHERE email = '<email>')
 *   ORDER BY createdAt DESC LIMIT 5;
 *   → shows a row with status='paid' settleStatus='failed'
 *
 * Usage:
 *   npx tsx scripts/grant-topup.ts <email> <amountUsd>
 *
 * Example:
 *   npx tsx scripts/grant-topup.ts user@example.com 99
 *
 * amountUsd must be a positive integer (matches topup SKU constraint).
 */

try {
  process.loadEnvFile(".env.local");
} catch {
  /* env may already be set */
}

import { getUserIdByEmail, getUser } from "../src/lib/store.js";
import { newapi, newapiQuotaToUsd, NewapiError } from "../src/lib/newapi.js";

/** Mirrors paymentWebhook#newapiUsername — newapi username = userId without u_ prefix. */
function newapiUsername(userId: string): string {
  return userId.startsWith("u_") ? userId.slice(2) : userId.slice(0, 20);
}

function parseArgs(): { email: string; amountUsd: number } {
  const args = process.argv.slice(2);
  const positional: string[] = [];
  for (const a of args) {
    if (a === "-h" || a === "--help") {
      console.log("Usage: tsx scripts/grant-topup.ts <email> <amountUsd>");
      process.exit(0);
    } else positional.push(a);
  }
  if (positional.length !== 2) {
    console.error("Usage: tsx scripts/grant-topup.ts <email> <amountUsd>");
    process.exit(1);
  }
  const amountUsd = parseInt(positional[1], 10);
  if (!Number.isInteger(amountUsd) || amountUsd <= 0 || String(amountUsd) !== positional[1]) {
    console.error(`[grant-topup] amountUsd must be a positive integer, got: ${positional[1]}`);
    process.exit(1);
  }
  return { email: positional[0], amountUsd };
}

async function main() {
  const { email, amountUsd } = parseArgs();

  const userId = getUserIdByEmail(email);
  if (!userId) {
    console.error(`[grant-topup] no user found for email: ${email}`);
    process.exit(1);
  }

  const user = await getUser(userId);
  if (!user) {
    console.error(`[grant-topup] user record missing for userId: ${userId}`);
    process.exit(1);
  }
  if (user.newapiUserId == null || !user.newapiPassword) {
    console.error(`[grant-topup] user ${userId} has no newapi link — cannot credit`);
    process.exit(1);
  }

  const beforeNewapi = await newapi.getUser(user.newapiUserId);
  console.log("[grant-topup] BEFORE:");
  console.log(`  newapi: quota=${beforeNewapi.quota.toLocaleString()} (~$${newapiQuotaToUsd(beforeNewapi.quota).toFixed(2)}) group=${beforeNewapi.group}`);

  const code = await newapi.createRedemption({
    name: `grant-${Date.now()}`,
    quotaUsd: amountUsd,
  });
  console.log(`[grant-topup] minted redemption code (tail: ...${code.slice(-4)}) for $${amountUsd}`);

  const session = await newapi.loginUser({
    username: newapiUsername(userId),
    password: user.newapiPassword,
  });
  await newapi.redeemCode(session, code);
  console.log(`[grant-topup] redeemed code for user=${userId} (${email})`);

  const afterNewapi = await newapi.getUser(user.newapiUserId);
  console.log("[grant-topup] AFTER:");
  console.log(`  newapi: quota=${afterNewapi.quota.toLocaleString()} (~$${newapiQuotaToUsd(afterNewapi.quota).toFixed(2)}) group=${afterNewapi.group}`);
  console.log(`[grant-topup] done — credited $${amountUsd} to ${email}`);
}

main().catch((err) => {
  if (err instanceof NewapiError) {
    console.error(`[grant-topup] newapi failed: ${err.message}`);
  } else {
    console.error("[grant-topup] fatal:", err);
  }
  process.exit(1);
});
