process.loadEnvFile(".env.local");
const baseUrl = process.env.NEWAPI_BASE_URL;
const adminToken = process.env.NEWAPI_ADMIN_TOKEN;
const H = {
  authorization: adminToken,
  "new-api-user": "1",
  "content-type": "application/json",
};

const CDNUV = {
  name: "cdnuv",
  type: 1,
  base_url: "https://ai.cdnuv.top",
  key: process.env.CDNUV_API_KEY || "YOUR_API_KEY_HERE",
  groups: ["default"],
};

// 1. Delete any existing channel named "cdnuv" so we start clean
const listRes = await fetch(
  baseUrl + "/api/channel/?p=0&page_size=50&id_sort=true&tag_mode=false",
  { headers: H },
);
const existing = (await listRes.json()).data?.items ?? [];
for (const c of existing) {
  if (c.name === CDNUV.name) {
    await fetch(baseUrl + `/api/channel/${c.id}/`, { method: "DELETE", headers: H });
    console.log(`deleted old channel id=${c.id}`);
  }
}

// 2. Re-fetch models from cdnuv (they may have changed with the new group)
const fmRes = await fetch(baseUrl + "/api/channel/fetch_models", {
  method: "POST",
  headers: H,
  body: JSON.stringify({ type: CDNUV.type, base_url: CDNUV.base_url, key: CDNUV.key }),
});
const fmBody = await fmRes.json();
if (!fmBody.success) {
  console.error("fetch_models failed:", fmBody.message);
  process.exit(1);
}
const modelIds = (fmBody.data || [])
  .map((m) => (typeof m === "string" ? m : m?.id ?? m?.name))
  .filter(Boolean);
console.log(`fetched ${modelIds.length} models:`);
for (const m of modelIds) console.log("  -", m);

// 3. Create channel
const crRes = await fetch(baseUrl + "/api/channel/", {
  method: "POST",
  headers: H,
  body: JSON.stringify({
    mode: "single",
    channel: {
      name: CDNUV.name,
      type: CDNUV.type,
      base_url: CDNUV.base_url,
      key: CDNUV.key,
      models: modelIds.join(","),
      group: CDNUV.groups.join(","),
      priority: 0,
      weight: 0,
      auto_ban: 1,
      test_model: modelIds[0],
    },
  }),
});
const crBody = await crRes.json();
console.log("\ncreate channel:", crRes.status, JSON.stringify(crBody).slice(0, 200));

// 4. Find new channel id and run the test endpoint against each model
const list2 = await fetch(
  baseUrl + "/api/channel/?p=0&page_size=50&id_sort=true&tag_mode=false",
  { headers: H },
).then((r) => r.json());
const mine = list2.data?.items?.find((c) => c.name === CDNUV.name);
if (!mine) {
  console.error("channel not found after create");
  process.exit(1);
}
console.log(`\ntesting channel id=${mine.id} against each model:`);
for (const m of modelIds) {
  const r = await fetch(baseUrl + `/api/channel/test/${mine.id}?model=${encodeURIComponent(m)}`, { headers: H });
  const b = await r.json();
  const ok = b.success;
  const msg = b.message?.slice(0, 120).replace(/\s+/g, " ") ?? "";
  console.log(`  ${ok ? "OK  " : "FAIL"} ${m}${ok ? ` (${b.time ?? "?"}s)` : ` — ${msg}`}`);
}
