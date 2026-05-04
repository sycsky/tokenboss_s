/**
 * One-shot migration: flip every existing newapi token's `group` to "auto".
 *
 * Why: newly minted keys now go into the "auto" group (see keysHandlers.ts),
 * but historical keys that pre-date the change are still pinned to whatever
 * group they were created with (typically "" / "default"). Run this once
 * after deploying the create-key change so every key in production routes
 * through the auto-tier channel.
 *
 * Strategy mirrors backfill-key-index.ts: iterate the linked users in the
 * local DB, log into newapi as each one, list their tokens, and call
 * setTokenGroup on every token whose group != "auto". Idempotent — re-runs
 * skip already-migrated tokens.
 *
 * Run with:
 *   cd backend && npx tsx scripts/migrate-tokens-auto-group.ts
 *
 * Requires NEWAPI_BASE_URL + admin creds (NEWAPI_ADMIN_USERNAME/PASSWORD or
 * NEWAPI_ADMIN_TOKEN) in env — same as the running server.
 */

try {
  process.loadEnvFile(".env.local");
} catch {
  /* no .env.local — fine, env may already be set */
}

import { newapi, NewapiError, isNewapiConfigured } from "../src/lib/newapi.js";
import { db } from "../src/lib/store.js";

const TARGET_GROUP = "auto";

function newapiUsername(userId: string): string {
  // Mirror keysHandlers.ts and backfill-key-index.ts so the same accounts match.
  return userId.startsWith("u_") ? userId.slice(2) : userId.slice(0, 20);
}

interface UserSlim {
  userId: string;
  newapiUserId: number | null;
  newapiPassword: string | null;
}

async function main() {
  if (!isNewapiConfigured()) {
    console.error("[migrate-auto] newapi not configured — aborting.");
    process.exit(1);
  }

  const users = db
    .prepare(
      `SELECT userId, newapiUserId, newapiPassword
         FROM users
        WHERE newapiUserId IS NOT NULL
          AND newapiPassword IS NOT NULL`,
    )
    .all() as UserSlim[];

  console.log(`[migrate-auto] processing ${users.length} linked users → group='${TARGET_GROUP}'`);

  let usersOk = 0;
  let usersFail = 0;
  let tokensUpdated = 0;
  let tokensSkipped = 0;
  let tokensFail = 0;

  for (const u of users) {
    try {
      const session = await newapi.loginUser({
        username: newapiUsername(u.userId),
        password: u.newapiPassword as string,
      });
      const tokens = await newapi.listUserTokens(session);
      for (const t of tokens) {
        if ((t.group ?? "") === TARGET_GROUP) {
          tokensSkipped++;
          continue;
        }
        try {
          await newapi.setTokenGroup(session, t, TARGET_GROUP);
          tokensUpdated++;
          console.log(
            `[migrate-auto] updated user=${u.userId} token=${t.id} (${t.name}) ` +
              `group='${t.group ?? ""}' → '${TARGET_GROUP}'`,
          );
        } catch (e) {
          tokensFail++;
          const msg = e instanceof NewapiError ? e.message : (e as Error).message;
          console.warn(
            `[migrate-auto] update failed user=${u.userId} token=${t.id}: ${msg}`,
          );
        }
      }
      usersOk++;
    } catch (e) {
      usersFail++;
      const msg = e instanceof NewapiError ? e.message : (e as Error).message;
      console.warn(`[migrate-auto] login/list failed user=${u.userId}: ${msg}`);
    }
  }

  console.log(
    `[migrate-auto] done: users ok=${usersOk} fail=${usersFail}; ` +
      `tokens updated=${tokensUpdated} skipped=${tokensSkipped} fail=${tokensFail}`,
  );
}

main().catch((err) => {
  console.error("[migrate-auto] fatal:", err);
  process.exit(1);
});
