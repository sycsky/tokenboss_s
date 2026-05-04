/**
 * One-shot migration: flip every token on the newapi instance to group=auto,
 * regardless of whether the owning user exists in the local TokenBoss DB.
 *
 * Pipeline (all admin-authed via newapi.ts session cache → one login total):
 *   1. List every user on newapi (paged).
 *   2. List every token on newapi via admin (paged). Some forks scope this
 *      to the calling admin's own tokens; the script logs the distinct
 *      user_id count it sees so we can detect that case.
 *   3. For each token where group != "auto", admin-PUT the row with the
 *      group field overridden.
 *   4. Print summary: tokens updated / skipped / failed.
 *
 * Idempotent — re-runs skip already-migrated tokens.
 *
 * Run with:
 *   cd backend && npx tsx scripts/migrate-all-newapi-tokens-auto.ts
 *
 * Requires NEWAPI_BASE_URL + admin creds in env.
 *
 * NOTE on rate limits: newapi's /api/user/login is rate-limited per IP. The
 * script uses lib/newapi.ts which caches the admin session for 5 min, so a
 * SINGLE run logs in once and reuses the cookie. If you've been hammering
 * login (probe scripts, repeated runs), wait ~5 min before retrying.
 */

try {
  process.loadEnvFile(".env.local");
} catch {
  /* no .env.local — env may already be set */
}

import { newapi, NewapiError, isNewapiConfigured } from "../src/lib/newapi.js";
import type { NewapiToken, NewapiUser } from "../src/lib/newapi.js";

const TARGET_GROUP = "auto";
const PAGE_SIZE = 100;

async function pageThrough<T>(
  fetcher: (page: number) => Promise<{ items: T[]; total?: number }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 0; ; page++) {
    const res = await fetcher(page);
    const items = res.items ?? [];
    all.push(...items);
    if (items.length < PAGE_SIZE) break;
    // Safety stop — total page count > 200 means something is off.
    if (page > 200) {
      console.warn("[migrate-all] pagination > 200 pages — stopping");
      break;
    }
  }
  return all;
}

async function main() {
  if (!isNewapiConfigured()) {
    console.error("[migrate-all] newapi not configured — aborting.");
    process.exit(1);
  }

  // --- 1. Enumerate users (informational; helps verify scope). ---
  console.log("[migrate-all] listing all newapi users…");
  const users = await pageThrough<NewapiUser>((p) =>
    newapi.listAllUsers({ page: p, size: PAGE_SIZE }),
  );
  console.log(`[migrate-all] users on newapi: ${users.length}`);

  // --- 2. Enumerate tokens via admin. ---
  console.log("[migrate-all] listing all tokens (admin)…");
  const tokens = await pageThrough<NewapiToken>((p) =>
    newapi.listAllTokensAdmin({ page: p, size: PAGE_SIZE }),
  );
  const distinctOwners = new Set(tokens.map((t) => t.user_id));
  console.log(
    `[migrate-all] tokens visible to admin: ${tokens.length} (${distinctOwners.size} distinct user_ids)`,
  );

  if (distinctOwners.size <= 1 && users.length > 1) {
    console.warn(
      `[migrate-all] WARNING: admin token listing only shows ${distinctOwners.size} owner — this fork ` +
        "scopes /api/token/ to the calling user. The migration will only update those tokens, not all users'. " +
        "Need a different enumeration strategy (per-user admin endpoint).",
    );
  }

  // --- 3. Update each token's group to TARGET_GROUP. ---
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  for (const t of tokens) {
    if ((t.group ?? "") === TARGET_GROUP) {
      skipped++;
      continue;
    }
    try {
      await newapi.setTokenGroupAdmin(t, TARGET_GROUP);
      updated++;
      console.log(
        `[migrate-all] updated token=${t.id} owner=${t.user_id} (${t.name}) ` +
          `group='${t.group ?? ""}' → '${TARGET_GROUP}'`,
      );
    } catch (e) {
      failed++;
      const msg = e instanceof NewapiError ? e.message : (e as Error).message;
      console.warn(
        `[migrate-all] update failed token=${t.id} owner=${t.user_id}: ${msg}`,
      );
    }
  }

  console.log(
    `[migrate-all] done: tokens updated=${updated} skipped=${skipped} failed=${failed} ` +
      `(of ${tokens.length} visible to admin; ${users.length} users on instance)`,
  );
}

main().catch((err) => {
  console.error("[migrate-all] fatal:", err);
  process.exit(1);
});
