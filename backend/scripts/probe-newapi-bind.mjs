// Verify the newapi subscription bind plumbing end-to-end against the live
// instance. Run:  node scripts/probe-newapi-bind.mjs <newapi_user_id>
//
// What it does:
//   1. Reads NEWAPI_BASE_URL / NEWAPI_ADMIN_TOKEN / NEWAPI_PLAN_ID_TRIAL
//      from env (falls back to .env.local in CWD if absent).
//   2. Fetches /api/subscription/admin/plans, prints the configured plans.
//   3. Reads target user's current group/quota.
//   4. POSTs /api/subscription/admin/bind to the Trial plan.
//   5. Re-reads the user, diffs the two states.
//
// Use a TEST account (not user 1, not your real account) — bind overwrites
// the user's group + quota.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// --- Env loading (no dotenv dependency needed for a one-off probe) ---
function loadEnvLocal() {
  try {
    const text = readFileSync(join(process.cwd(), '.env.local'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* no .env.local — env should already have the vars */
  }
}
loadEnvLocal();

const targetUser = parseInt(process.argv[2] ?? '', 10);
if (!Number.isFinite(targetUser) || targetUser <= 0) {
  console.error('usage: node scripts/probe-newapi-bind.mjs <newapi_user_id>');
  process.exit(2);
}

const BASE = process.env.NEWAPI_BASE_URL;
const TOKEN = process.env.NEWAPI_ADMIN_TOKEN;
const TRIAL_PLAN_ID = parseInt(process.env.NEWAPI_PLAN_ID_TRIAL ?? '', 10);
if (!BASE || !TOKEN) {
  console.error('NEWAPI_BASE_URL / NEWAPI_ADMIN_TOKEN missing');
  process.exit(2);
}
if (!Number.isFinite(TRIAL_PLAN_ID)) {
  console.error('NEWAPI_PLAN_ID_TRIAL missing — add it to .env.local');
  process.exit(2);
}

const headers = {
  authorization: TOKEN,
  'new-api-user': '1',
  'content-type': 'application/json',
};

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, { headers });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

async function postJson(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return res.json();
}

console.log(`[probe] base=${BASE}`);
console.log(`[probe] target user=${targetUser}, trial plan id=${TRIAL_PLAN_ID}`);

console.log('\n--- 1. configured plans ---');
const plans = await getJson('/api/subscription/admin/plans');
for (const { plan } of plans.data) {
  console.log(
    `  #${String(plan.id).padStart(2)}  ${plan.title.padEnd(6)}  ` +
      `duration=${plan.duration_value}${plan.duration_unit}  ` +
      `upgrade_group='${plan.upgrade_group}'`
  );
}

console.log('\n--- 2. user state (before bind) ---');
const before = (await getJson(`/api/user/${targetUser}`)).data;
console.log(
  `  username=${before.username}  group='${before.group}'  ` +
    `quota=${before.quota.toLocaleString()}`
);

console.log('\n--- 3. bind → Trial ---');
const bindResp = await postJson('/api/subscription/admin/bind', {
  user_id: targetUser,
  plan_id: TRIAL_PLAN_ID,
});
console.log(`  ${JSON.stringify(bindResp)}`);

console.log('\n--- 4. user state (after bind) ---');
const after = (await getJson(`/api/user/${targetUser}`)).data;
console.log(
  `  username=${after.username}  group='${after.group}'  ` +
    `quota=${after.quota.toLocaleString()}`
);

console.log('\n--- 5. diff ---');
if (before.group !== after.group) {
  console.log(`  group: '${before.group}' → '${after.group}'`);
} else {
  console.log(`  group: unchanged ('${after.group}')`);
}
if (before.quota !== after.quota) {
  console.log(
    `  quota: ${before.quota.toLocaleString()} → ${after.quota.toLocaleString()}`
  );
} else {
  console.log(`  quota: unchanged (${after.quota.toLocaleString()})`);
}

if (after.group !== 'trial') {
  console.error('\n[probe] FAIL — expected group=trial after bind');
  process.exit(1);
}
console.log('\n[probe] PASS — bind sets group correctly');
