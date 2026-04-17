// Set these via env or edit .env.local before running:
//   NEWAPI_BASE_URL, NEWAPI_ADMIN_TOKEN, OPENAI_OFFICIAL_KEY
try { process.loadEnvFile(".env.local"); } catch {}
const baseUrl = process.env.NEWAPI_BASE_URL?.replace(/\/+$/, "");
const adminToken = process.env.NEWAPI_ADMIN_TOKEN;
const openaiKey = process.env.OPENAI_OFFICIAL_KEY;

if (!baseUrl || !adminToken) {
  console.error("missing NEWAPI_BASE_URL or NEWAPI_ADMIN_TOKEN");
  process.exit(1);
}
if (!openaiKey) {
  console.error("missing OPENAI_OFFICIAL_KEY env var (export it before running)");
  process.exit(1);
}

const H = {
  authorization: adminToken,
  "new-api-user": "1",
  "content-type": "application/json",
};

async function fetchRetry(url, init, tries = 5) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastErr = err;
      console.log(`      retry ${i + 1}/${tries} after: ${err.cause?.code ?? err.message}`);
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

const NAME = "openai-official";
const TYPE = 1;
const BASE = "https://api.openai.com";
const GROUPS = ["default"];

console.log(`[1/5] reach ${baseUrl}/api/status`);
const st = await fetchRetry(baseUrl + "/api/status", { headers: H });
console.log(`      HTTP ${st.status}`);
if (!st.ok) {
  console.error("newapi not reachable or token invalid — abort");
  process.exit(1);
}

console.log(`[2/5] list + delete stale "${NAME}"`);
const listRes = await fetchRetry(
  baseUrl + "/api/channel/?p=0&page_size=50&id_sort=true&tag_mode=false",
  { headers: H },
);
console.log(`      HTTP ${listRes.status}`);
const listBody = await listRes.json();
if (!listBody.success) {
  console.error("list channel failed:", JSON.stringify(listBody).slice(0, 300));
  process.exit(1);
}
const existing = listBody.data?.items ?? [];
console.log(`      existing channels: ${existing.length}`);
for (const c of existing) {
  if (c.name === NAME) {
    const d = await fetchRetry(baseUrl + `/api/channel/${c.id}/`, { method: "DELETE", headers: H });
    console.log(`      deleted id=${c.id} HTTP ${d.status}`);
  }
}

console.log(`[3/5] use hardcoded model list (skipping fetch_models because newapi can't reach openai)`);
const modelIds = [
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-5.1",
  "gpt-5.1-mini",
  "gpt-5.2",
  "gpt-5.3",
  "gpt-5.4",
  "gpt-5.4-mini",
  "o1",
  "o1-mini",
  "o3",
  "o3-mini",
  "o4-mini",
];
console.log(`      using ${modelIds.length} models`);

console.log(`[4/5] create channel`);
const payload = {
  mode: "single",
  channel: {
    name: NAME,
    type: TYPE,
    base_url: BASE,
    key: openaiKey,
    models: modelIds.join(","),
    group: GROUPS.join(","),
    priority: 0,
    weight: 0,
    auto_ban: 1,
    test_model: modelIds.find((m) => /^gpt-4o-mini/i.test(m)) ?? modelIds[0],
  },
};
const crRes = await fetchRetry(baseUrl + "/api/channel/", {
  method: "POST",
  headers: H,
  body: JSON.stringify(payload),
});
const crBody = await crRes.json();
console.log(`      HTTP ${crRes.status}`);
console.log(`      response:`, JSON.stringify(crBody).slice(0, 400));
if (!crBody.success) {
  console.error("create failed — abort");
  process.exit(1);
}

console.log(`[5/5] verify + test`);
const list2 = await fetchRetry(
  baseUrl + "/api/channel/?p=0&page_size=50&id_sort=true&tag_mode=false",
  { headers: H },
).then((r) => r.json());
const mine = list2.data?.items?.find((c) => c.name === NAME);
if (!mine) {
  console.error("channel not found after create — abort");
  process.exit(1);
}
console.log(`      channel id=${mine.id} status=${mine.status}`);

const sample = ["gpt-4o-mini", "gpt-4o", "gpt-5", "gpt-5-mini", "gpt-5.1", "gpt-5.4-mini"]
  .filter((m) => modelIds.includes(m));
const toTest = sample.length > 0 ? sample : modelIds.slice(0, 3);
for (const m of toTest) {
  const r = await fetchRetry(
    baseUrl + `/api/channel/test/${mine.id}?model=${encodeURIComponent(m)}`,
    { headers: H },
  );
  const b = await r.json();
  const ok = b.success;
  const msg = b.message?.slice(0, 120).replace(/\s+/g, " ") ?? "";
  console.log(`      ${ok ? "OK  " : "FAIL"} ${m}${ok ? ` (${b.time ?? "?"}s)` : ` — ${msg}`}`);
}

console.log("\ndone.");
