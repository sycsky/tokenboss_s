/**
 * Mirror the ratios of cdnuv's real model ids onto ClawRouter-facing aliases.
 *
 * After `update-channel-mapping.mjs` adds the aliases to the channel, newapi
 * still rejects calls with "ratio or price not set" because it looks up
 * pricing by the incoming (pre-mapping) model name. So we copy whatever
 * ModelRatio / CompletionRatio / ModelPrice the real id has over onto the
 * alias.
 */

process.loadEnvFile(".env.local");
const baseUrl = process.env.NEWAPI_BASE_URL;
const H = {
  authorization: process.env.NEWAPI_ADMIN_TOKEN,
  "new-api-user": "1",
  "content-type": "application/json",
};

const ALIASES = {
  "claude-haiku-4.5": "claude-haiku-4-5-20251001",
  "claude-opus-4.6": "claude-opus-4-6",
};

const opts = (await fetch(baseUrl + "/api/option/", { headers: H }).then((r) => r.json())).data;
const pick = (k) => opts.find((o) => o.key === k)?.value ?? "{}";

function patchMap(name, fallback) {
  const raw = pick(name);
  const map = JSON.parse(raw || "{}");
  let changed = false;
  for (const [alias, real] of Object.entries(ALIASES)) {
    if (map[real] !== undefined && map[alias] === undefined) {
      map[alias] = map[real];
      console.log(`  ${name}: ${alias} = ${JSON.stringify(map[real])} (copied from ${real})`);
      changed = true;
    } else if (map[real] === undefined && fallback[alias] !== undefined && map[alias] === undefined) {
      map[alias] = fallback[alias];
      console.log(`  ${name}: ${alias} = ${JSON.stringify(fallback[alias])} (fallback)`);
      changed = true;
    }
  }
  return { map, changed };
}

// Fallbacks in case the upstream id has no ratio entry (e.g. priced via ModelPrice instead).
const haikuFallback = { "claude-haiku-4.5": 0.5, "claude-opus-4.6": 7.5 };
const completionFallback = { "claude-haiku-4.5": 5, "claude-opus-4.6": 5 };

const ratio = patchMap("ModelRatio", haikuFallback);
const completion = patchMap("CompletionRatio", completionFallback);
const price = patchMap("ModelPrice", {});

async function putOpt(key, val) {
  const r = await fetch(baseUrl + "/api/option/", {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ key, value: JSON.stringify(val) }),
  });
  const j = await r.json();
  console.log(`PUT ${key}:`, r.status, j.success ? "ok" : j.message);
}

if (ratio.changed) await putOpt("ModelRatio", ratio.map);
if (completion.changed) await putOpt("CompletionRatio", completion.map);
if (price.changed) await putOpt("ModelPrice", price.map);

// Smoke test
console.log("\nsmoke-testing each alias:");
const list = await fetch(
  baseUrl + "/api/channel/?p=0&page_size=50&id_sort=true&tag_mode=false",
  { headers: H },
).then((r) => r.json());
const ch = list.data?.items?.find((c) => c.name === "cdnuv");
for (const alias of Object.keys(ALIASES)) {
  const r = await fetch(
    baseUrl + `/api/channel/test/${ch.id}?model=${encodeURIComponent(alias)}`,
    { headers: H },
  );
  const b = await r.json();
  const msg = b.message?.slice(0, 160).replace(/\s+/g, " ") ?? "";
  console.log(`  ${b.success ? "OK  " : "FAIL"} ${alias}${b.success ? ` (${b.time ?? "?"}s)` : ` — ${msg}`}`);
}
