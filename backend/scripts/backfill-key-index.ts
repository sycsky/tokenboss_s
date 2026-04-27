/**
 * Backfill api_key_index for tokens that were created before the index
 * existed. Without this, direct sk-xxx callers will not be recognized as
 * "free users" and won't get model rewriting in chatProxyCore.
 *
 * Strategy: for every linked user, log into newapi as them, list their
 * tokens, reveal each one (newapi only returns plaintext via the reveal
 * endpoint, never in listings), hash, and write to api_key_index.
 *
 * Idempotent — INSERT OR REPLACE means re-running is safe. Failures on a
 * single user are logged and skipped; the script continues.
 *
 * Run with:
 *   cd backend && npx tsx scripts/backfill-key-index.ts
 *
 * Requires NEWAPI_BASE_URL + NEWAPI_ADMIN_TOKEN in env (same as the server).
 */

try {
  process.loadEnvFile(".env.local");
} catch {
  /* no .env.local — fine, env may already be set */
}

import { createHash } from "node:crypto";
import { newapi, NewapiError, isNewapiConfigured } from "../src/lib/newapi.js";
import { db, putApiKeyIndex } from "../src/lib/store.js";

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function newapiUsername(userId: string): string {
  // Mirror the derivation used in keysHandlers.ts so the same accounts match.
  return userId.startsWith("u_") ? userId.slice(2) : userId.slice(0, 20);
}

interface UserSlim {
  userId: string;
  newapiUserId: number | null;
  newapiPassword: string | null;
}

async function main() {
  if (!isNewapiConfigured()) {
    console.error("[backfill] NEWAPI_BASE_URL / NEWAPI_ADMIN_TOKEN not set — aborting.");
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

  console.log(`[backfill] processing ${users.length} linked users`);

  let usersOk = 0;
  let usersFail = 0;
  let tokensIndexed = 0;
  let tokensFail = 0;

  for (const u of users) {
    try {
      const session = await newapi.loginUser({
        username: newapiUsername(u.userId),
        password: u.newapiPassword as string,
      });
      const tokens = await newapi.listUserTokens(session);
      for (const t of tokens) {
        try {
          const raw = await newapi.revealToken(session, t.id);
          putApiKeyIndex({
            userId: u.userId,
            newapiTokenId: t.id,
            keyHash: sha256Hex(raw),
          });
          tokensIndexed++;
        } catch (e) {
          tokensFail++;
          const msg = e instanceof NewapiError ? e.message : (e as Error).message;
          console.warn(`[backfill] reveal failed user=${u.userId} token=${t.id}: ${msg}`);
        }
      }
      usersOk++;
    } catch (e) {
      usersFail++;
      const msg = e instanceof NewapiError ? e.message : (e as Error).message;
      console.warn(`[backfill] login/list failed user=${u.userId}: ${msg}`);
    }
  }

  console.log(
    `[backfill] done: users ok=${usersOk} fail=${usersFail}; tokens indexed=${tokensIndexed} fail=${tokensFail}`,
  );
}

main().catch((err) => {
  console.error("[backfill] fatal:", err);
  process.exit(1);
});
