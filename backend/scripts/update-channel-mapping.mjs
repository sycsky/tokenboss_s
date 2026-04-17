/**
 * Patch the cdnuv channel so ClawRouter's canonical model names work.
 *
 * ClawRouter sends e.g. `anthropic/claude-haiku-4.5`. TokenBoss strips the
 * `anthropic/` prefix, so newapi receives `claude-haiku-4.5`. cdnuv upstream
 * actually serves `claude-haiku-4-5-20251001`, so we:
 *   1. add ClawRouter's names to the channel `models` list (so newapi
 *      accepts them + `/v1/models` advertises them)
 *   2. add a `model_mapping` so newapi rewrites to cdnuv's real id before
 *      forwarding.
 */

process.loadEnvFile(".env.local");
const baseUrl = process.env.NEWAPI_BASE_URL;
const adminToken = process.env.NEWAPI_ADMIN_TOKEN;
const H = {
  authorization: adminToken,
  "new-api-user": "1",
  "content-type": "application/json",
};

const ALIASES = {
  "claude-haiku-4.5": "claude-haiku-4-5-20251001",
  "claude-opus-4.6": "claude-opus-4-6",
};

const list = await fetch(
  baseUrl + "/api/channel/?p=0&page_size=50&id_sort=true&tag_mode=false",
  { headers: H },
).then((r) => r.json());
const ch = list.data?.items?.find((c) => c.name === "cdnuv");
if (!ch) {
  console.error("cdnuv channel not found");
  process.exit(1);
}
console.log(`patching channel id=${ch.id}`);

const existing = (ch.models || "").split(",").filter(Boolean);
const merged = Array.from(new Set([...existing, ...Object.keys(ALIASES)]));

const existingMap = ch.model_mapping && ch.model_mapping !== "null"
  ? JSON.parse(ch.model_mapping)
  : {};
const mergedMap = { ...existingMap, ...ALIASES };

const body = {
  ...ch,
  models: merged.join(","),
  model_mapping: JSON.stringify(mergedMap),
};

const res = await fetch(baseUrl + "/api/channel/", {
  method: "PUT",
  headers: H,
  body: JSON.stringify(body),
});
const out = await res.json();
console.log("update:", res.status, JSON.stringify(out).slice(0, 300));

if (out.success) {
  console.log("\nmodels now:", merged.join(", "));
  console.log("mapping now:", mergedMap);
  console.log("\nsmoke-testing each alias via channel test endpoint:");
  for (const alias of Object.keys(ALIASES)) {
    const r = await fetch(
      baseUrl + `/api/channel/test/${ch.id}?model=${encodeURIComponent(alias)}`,
      { headers: H },
    );
    const b = await r.json();
    const msg = b.message?.slice(0, 120).replace(/\s+/g, " ") ?? "";
    console.log(`  ${b.success ? "OK  " : "FAIL"} ${alias}${b.success ? ` (${b.time ?? "?"}s)` : ` — ${msg}`}`);
  }
}
