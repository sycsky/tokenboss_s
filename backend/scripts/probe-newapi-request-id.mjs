#!/usr/bin/env node
/**
 * Probe whether newapi accepts a forwarded `X-Request-ID` header and stores
 * it as the log entry's request_id, OR generates its own.
 *
 * Usage:
 *   node backend/scripts/probe-newapi-request-id.mjs
 *
 * Reads NEWAPI_BASE_URL + NEWAPI_ADMIN_TOKEN + UPSTREAM_API_URL +
 * UPSTREAM_API_KEY from .env.local. Outputs PROBE RESULT line at the end.
 */

import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

// --- Load env from .env.local ---
const envPath = new URL("../.env.local", import.meta.url);
try {
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) process.env[m[1]] ??= m[2];
  }
} catch {
  console.error("could not load backend/.env.local; expecting envs to be set already");
}

const NEWAPI_BASE = (process.env.NEWAPI_BASE_URL ?? "").replace(/\/+$/, "");
const ADMIN_TOKEN = process.env.NEWAPI_ADMIN_TOKEN ?? "";
const UPSTREAM_BASE = (process.env.UPSTREAM_API_URL ?? "").replace(/\/+$/, "");
const UPSTREAM_KEY = process.env.UPSTREAM_API_KEY ?? "";

if (!NEWAPI_BASE || !ADMIN_TOKEN) {
  console.error("missing env: NEWAPI_BASE_URL / NEWAPI_ADMIN_TOKEN");
  process.exit(2);
}

// --- Resolve which endpoint + key to use for the chat completion probe ---
// Strategy: if UPSTREAM_API_URL / UPSTREAM_API_KEY are set and working, use them.
// Fallback: call newapi directly using admin token 1 (reveal it on the fly).
// This covers the case where UPSTREAM_API_KEY is in a group with no available channels.

// --- Resolve a working API key for the probe ---
// First try the configured UPSTREAM key; fall back to revealing admin token 1
// from newapi if the upstream key is in a group with no channels.
const ADMIN_USER_ID = process.env.NEWAPI_ADMIN_USER_ID ?? "1";

async function resolveWorkingKey() {
  // Try UPSTREAM_API_KEY first
  if (UPSTREAM_KEY) {
    const testR = await fetch(`${UPSTREAM_BASE}/v1/models`, {
      headers: { authorization: `Bearer ${UPSTREAM_KEY}` },
    }).catch(() => null);
    if (testR?.ok) {
      const body = await testR.json().catch(() => ({}));
      if ((body?.data ?? []).length > 0) {
        console.log(`[probe] UPSTREAM_API_KEY works (${(body.data ?? []).length} models); using ${UPSTREAM_BASE}`);
        return { base: UPSTREAM_BASE, key: UPSTREAM_KEY };
      }
    }
    console.log(`[probe] UPSTREAM_API_KEY has no models (group may have no channels); falling back to newapi admin token`);
  }

  // Fall back: reveal admin token 1 from newapi, call newapi directly
  const revealRes = await fetch(`${NEWAPI_BASE}/api/token/1/key`, {
    method: "POST",
    headers: { authorization: ADMIN_TOKEN, "new-api-user": ADMIN_USER_ID },
  });
  const revealBody = await revealRes.json().catch(() => ({}));
  const rawKey = revealBody?.data?.key;
  if (!rawKey) {
    console.error("[probe] failed to reveal admin token 1:", JSON.stringify(revealBody).slice(0, 200));
    process.exit(2);
  }
  const adminKey = rawKey.startsWith("sk-") ? rawKey : `sk-${rawKey}`;
  console.log(`[probe] using newapi admin token (key prefix: ${adminKey.slice(0, 12)}...) against ${NEWAPI_BASE}`);
  return { base: NEWAPI_BASE, key: adminKey };
}

const { base: callBase, key: callKey } = await resolveWorkingKey();

const probeId = `tb-probe-${randomBytes(4).toString("hex")}`;
console.log(`[probe] forwarding X-Request-ID: ${probeId} to ${callBase}/v1/chat/completions`);

const tNow = Math.floor(Date.now() / 1000);

// --- Step 1: send a tiny chat request through the upstream with our probe id ---
const r = await fetch(`${callBase}/v1/chat/completions`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "authorization": `Bearer ${callKey}`,
    "X-Request-ID": probeId,
  },
  body: JSON.stringify({
    model: "gpt-5.4-mini",
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 1,
    stream: false,
  }),
});
console.log(`[probe] upstream status=${r.status}`);
const respText = await r.text();
console.log(`[probe] upstream response (first 200 chars): ${respText.slice(0, 200)}`);

if (!r.ok) {
  console.log(`PROBE RESULT: BLOCKED (upstream returned ${r.status} — cannot determine request_id behaviour)`);
  process.exit(3);
}

// --- Step 2: wait a moment for newapi to flush its log row ---
await new Promise((res) => setTimeout(res, 2000));

// --- Step 3: query newapi admin /api/log/ for entries since tNow ---
// Auth: newapi admin uses raw token (no "Bearer" prefix) + "new-api-user" header
const logRes = await fetch(`${NEWAPI_BASE}/api/log/?p=0&size=20&start_timestamp=${tNow}`, {
  headers: {
    authorization: ADMIN_TOKEN,
    "new-api-user": ADMIN_USER_ID,
  },
});
console.log(`[probe] log API status=${logRes.status}`);
const logText = await logRes.text();
console.log(`[probe] log API response (first 300 chars): ${logText.slice(0, 300)}`);

let logBody;
try {
  logBody = JSON.parse(logText);
} catch {
  console.error("[probe] log API returned non-JSON — check endpoint and auth");
  process.exit(3);
}

// newapi's response shape: { success, data: { items, total, ... } }
// Normalise across different possible shapes.
const items =
  logBody?.data?.items ??
  logBody?.data ??
  logBody?.items ??
  [];
console.log(`[probe] fetched ${items.length} recent log entries`);

const matches = items.filter((e) => e.request_id === probeId);
const allRequestIds = items.slice(0, 5).map((e) => e.request_id);
console.log(`[probe] sample request_ids: ${JSON.stringify(allRequestIds)}`);

if (matches.length > 0) {
  console.log(`PROBE RESULT: EXACT_JOIN_OK (newapi forwards X-Request-ID; entry.request_id == ${probeId})`);
  process.exit(0);
} else {
  console.log(`PROBE RESULT: SOFT_JOIN_REQUIRED (newapi reroles its own request_id; we cannot rely on forwarded id)`);
  process.exit(1);
}
