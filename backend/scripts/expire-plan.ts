/**
 * Force a user's subscription to look expired (push subscriptionExpiresAt
 * into the past). Use to test the cron's downgrade-on-expiry path without
 * actually waiting 30 days.
 *
 *   cd backend && npx tsx scripts/expire-plan.ts u_7def434f01700bff31c2
 *
 * Then run:
 *   npx tsx scripts/run-cron.ts
 *
 * Expected: cron output shows expired=1, the user's plan flips to 'free',
 * and newapi quota goes to 0.
 */

try {
  process.loadEnvFile(".env.local");
} catch {
  /* env may already be set */
}

import { db, getUser } from "../src/lib/store.js";

const userId = process.argv[2];
if (!userId) {
  console.error("Usage: tsx scripts/expire-plan.ts <userId>");
  process.exit(1);
}

const before = await getUser(userId);
if (!before) {
  console.error(`[expire-plan] user not found: ${userId}`);
  process.exit(1);
}
console.log(`[expire-plan] BEFORE: plan=${before.plan} expiresAt=${before.subscriptionExpiresAt ?? "null"}`);

const yesterday = new Date(Date.now() - 86_400_000).toISOString();
db.prepare(
  `UPDATE users SET subscriptionExpiresAt = ? WHERE userId = ?`,
).run(yesterday, userId);

const after = await getUser(userId);
console.log(`[expire-plan] AFTER:  plan=${after?.plan} expiresAt=${after?.subscriptionExpiresAt}`);
console.log(`[expire-plan] now run: npx tsx scripts/run-cron.ts`);
