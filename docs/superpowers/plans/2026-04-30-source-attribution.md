# X-Source 全链路 Agent 归属 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 chatProxy 入口捕获 chat completions 请求来源（X-Source header / UA fallback / 'other'），落到 tokenboss SQLite，`/v1/usage` join 后回填 source 字段，前端 `/console/history` + Dashboard 展示真实 Agent 名而不是当前的 keyHint band-aid。

**Architecture:** chatProxy 入口写 `usage_attribution` 表（key=request_id），forward `X-Request-ID` 给 newapi。`/v1/usage` 拉 newapi log 后批量 join attribution 表 —— 精确 join 走 request_id（如 newapi 接受 forwarded header），软 join 走 `(user, model, ±5s)`（如 newapi 自己 reroll）。Plan 第一步是 probe newapi 行为决定走哪条 join。

**Tech Stack:** TypeScript + better-sqlite3 + AWS-Lambda-style handler + vitest；frontend React + Vite。

**Spec:** `docs/superpowers/specs/2026-04-30-source-attribution-design.md`

---

## File Structure

**Backend (新增 / 修改)：**
- Create: `backend/scripts/probe-newapi-request-id.mjs` — Task 0 probe script
- Create: `backend/src/lib/sourceAttribution.ts` — `parseSourceHeader` / `parseUaSource` / `resolveSource`
- Modify: `backend/src/lib/store.ts` — `usage_attribution` 表 DDL + idempotent migration + 3 helper（`insertAttribution` / `getAttributionByRequestIds` / `getAttributionsForJoin`）
- Modify: `backend/src/lib/chatProxyCore.ts` — 入口生成 request_id + resolve source + sha256 → userId 反查 + INSERT OR IGNORE + forward `X-Request-ID`
- Modify: `backend/src/handlers/usageHandlers.ts` — `mapNewapiLog` 现状是 single-pass，改成两阶段：先拉 page，然后批量 join attribution → 回填 source；按 Task 0 probe 结果选 exact OR soft join
- Create: `backend/src/lib/__tests__/sourceAttribution.test.ts`
- Create: `backend/src/lib/__tests__/store.attribution.test.ts`
- Create: `backend/src/handlers/__tests__/chatProxyAttribution.test.ts`
- Modify: `backend/src/handlers/__tests__/usage.test.ts` — 加 join 集成测试

**Frontend (新增 / 修改)：**
- Create: `frontend/src/lib/sourceDisplay.ts` — `formatSource()`
- Create: `frontend/src/lib/__tests__/sourceDisplay.test.ts`
- Modify: `frontend/src/screens/UsageHistory.tsx` — `source` prop 改成显式三元 `r.source ? formatSource(r.source) : (r.keyHint ?? undefined)`
- Modify: `frontend/src/screens/Dashboard.tsx` — 同上

**Docs (新增 / 修改)：**
- Create: `docs/sdk-source-attribution.md` — SDK 端 X-Source 协议契约
- Modify: `docs/订阅测试指南.md` — 追加 source attribution e2e 章节

**Out of scope (followup)：**
- 30 天 cron 清理 attribution（spec § 3 + Open Q #4）—— v1.x followup；attribution 行 ~100B，10K calls/day = 1MB/day，SQLite 几个月内无压力，不阻塞 v1
- 实际 OpenClaw / Hermes / Claude Code / Codex 真实 UA 字符串调研（spec Open Q #2）—— 短期用宽松正则 `/openclaw/i` 等占位，正式上线前 SDK 端各自跑一次 tcpdump 校准，列入 v1.1 ticket

---

## Task 0: Probe newapi for forwarded X-Request-ID

**Goal:** 跑一次 probe 测试，决定 Task 5 用精确 join 还是软 join。本任务只产出**结论**和一个 reproducible 脚本，不改主线代码。

**Files:**
- Create: `backend/scripts/probe-newapi-request-id.mjs`

- [ ] **Step 1: 写 probe 脚本**

Create `backend/scripts/probe-newapi-request-id.mjs`:

```javascript
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

if (!NEWAPI_BASE || !ADMIN_TOKEN || !UPSTREAM_BASE || !UPSTREAM_KEY) {
  console.error("missing env: NEWAPI_BASE_URL / NEWAPI_ADMIN_TOKEN / UPSTREAM_API_URL / UPSTREAM_API_KEY");
  process.exit(2);
}

const probeId = `tb-probe-${randomBytes(4).toString("hex")}`;
console.log(`[probe] forwarding X-Request-ID: ${probeId} to ${UPSTREAM_BASE}/v1/chat/completions`);

const tNow = Math.floor(Date.now() / 1000);

// --- Step 1: send a tiny chat request through the upstream with our probe id ---
const r = await fetch(`${UPSTREAM_BASE}/v1/chat/completions`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "authorization": `Bearer ${UPSTREAM_KEY}`,
    "X-Request-ID": probeId,
  },
  body: JSON.stringify({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 1,
    stream: false,
  }),
});
console.log(`[probe] upstream status=${r.status}`);
const respText = await r.text();
console.log(`[probe] upstream response (first 200 chars): ${respText.slice(0, 200)}`);

// --- Step 2: wait a moment for newapi to flush its log row ---
await new Promise((res) => setTimeout(res, 2000));

// --- Step 3: query newapi admin /api/log for entries since tNow ---
const logRes = await fetch(`${NEWAPI_BASE}/api/log/?p=0&size=20&start_timestamp=${tNow}`, {
  headers: { authorization: ADMIN_TOKEN, "new-api-user": "1" },
});
const logBody = await logRes.json();
const items = logBody?.data?.items ?? logBody?.items ?? [];
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
```

- [ ] **Step 2: 跑 probe**

Run: `cd backend && node scripts/probe-newapi-request-id.mjs`
Expected output: 最后一行是 `PROBE RESULT: EXACT_JOIN_OK` 或 `PROBE RESULT: SOFT_JOIN_REQUIRED`。**记下结论 —— Task 5 据此选 join 路径。**

如果 probe 出错（newapi 不可达、credentials 错、log API 路径不同），先调通 probe 再继续；不要假设结果。

- [ ] **Step 3: 把 probe 结论写到本 plan 的 Task 5 顶部**

在本 plan 文件 Task 5 标题行下面加一行：
```
> **PROBE RESULT (Task 0):** EXACT_JOIN_OK   <!-- 或 SOFT_JOIN_REQUIRED -->
> 因此 Task 5 实施 [精确 join | 软 join] 路径。
```

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/probe-newapi-request-id.mjs docs/superpowers/plans/2026-04-30-source-attribution.md
git commit -m "chore(probe): newapi X-Request-ID forwarding probe

Outcome (recorded in plan): [EXACT_JOIN_OK | SOFT_JOIN_REQUIRED]

Probe sends a chat completion through the upstream with a known
X-Request-ID, then queries newapi /api/log to see whether the
forwarded id appears in entry.request_id."
```

---

## Task 1: usage_attribution table + DDL + migration

**Files:**
- Modify: `backend/src/lib/store.ts` (add table to `init()`)
- Test: `backend/src/lib/__tests__/store.attribution.test.ts` (new)

- [ ] **Step 1: 写失败测试**

Create `backend/src/lib/__tests__/store.attribution.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';

process.env.SESSION_SECRET = 'test-secret-32bytes-min-aaaaaaaaaaa';
process.env.SQLITE_PATH = ':memory:';

import { init, db } from '../store.js';

beforeAll(() => {
  init();
});

describe('usage_attribution table — schema', () => {
  it('exists with the required columns + types', () => {
    const cols = db
      .prepare(`PRAGMA table_info(usage_attribution)`)
      .all() as { name: string; type: string; notnull: number; pk: number }[];
    const byName = new Map(cols.map((c) => [c.name, c]));
    expect(byName.get('requestId')?.pk).toBe(1);
    expect(byName.get('requestId')?.type).toBe('TEXT');
    expect(byName.get('userId')?.notnull).toBe(1);
    expect(byName.get('userId')?.type).toBe('TEXT');
    expect(byName.get('source')?.notnull).toBe(1);
    expect(byName.get('sourceMethod')?.notnull).toBe(1);
    expect(byName.get('model')).toBeDefined();
    expect(byName.get('capturedAt')?.notnull).toBe(1);
    expect(byName.get('capturedAt')?.type).toBe('TEXT');
  });

  it('rejects source / sourceMethod longer than 32 chars (CHECK constraint)', () => {
    const baseInsert = (source: string, sourceMethod: string, model: string | null) =>
      db.prepare(
        `INSERT INTO usage_attribution (requestId, userId, source, sourceMethod, model, capturedAt) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run('tb-aaaaaaaa', 'u_x', source, sourceMethod, model, new Date().toISOString());
    expect(() => baseInsert('a'.repeat(40), 'header', 'gpt-4o')).toThrow();
    expect(() => baseInsert('openclaw', 'a'.repeat(40), 'gpt-4o')).toThrow();
    expect(() => baseInsert('openclaw', 'header', 'a'.repeat(200))).toThrow();
  });

  it('has the user+time index for soft-join queries (PK index for requestId is implicit, not duplicated)', () => {
    const idx = db
      .prepare(`PRAGMA index_list(usage_attribution)`)
      .all() as { name: string }[];
    const names = new Set(idx.map((i) => i.name));
    // We rely on SQLite's implicit PK index for requestId lookups; only
    // need to verify our explicit secondary index for soft-join.
    expect(names.has('idx_attribution_user_time')).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx vitest run src/lib/__tests__/store.attribution.test.ts`
Expected: FAIL — table `usage_attribution` does not exist.

- [ ] **Step 3: 加 DDL 到 store.ts init()**

在 `backend/src/lib/store.ts` 的 `init()` 函数末尾（`UPDATE orders SET planId = CASE...` 之后），在 `// Initialise on module load` 注释之前，加：

```typescript
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_attribution (
      requestId    TEXT PRIMARY KEY,
      userId       TEXT NOT NULL,
      source       TEXT NOT NULL,
      sourceMethod TEXT NOT NULL,
      model        TEXT,
      capturedAt   TEXT NOT NULL,
      CHECK (length(source) <= 32),
      CHECK (length(sourceMethod) <= 32),
      CHECK (model IS NULL OR length(model) <= 128)
    );
    CREATE INDEX IF NOT EXISTS idx_attribution_user_time
      ON usage_attribution(userId, capturedAt DESC);
  `);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npx vitest run src/lib/__tests__/store.attribution.test.ts`
Expected: PASS (3 tests).

Run wider suite: `cd backend && npx vitest run`
Expected: 80/80 (was 77 + 3 new). No regressions.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/store.ts backend/src/lib/__tests__/store.attribution.test.ts
git commit -m "feat(store): add usage_attribution table

Foundation for X-Source agent attribution. Records (requestId, userId,
source, sourceMethod, model, capturedAt) per chat completion at proxy
entry. camelCase columns matching rest of store.ts. Indexed for soft
join (userId+capturedAt); requestId PK carries its own implicit index."
```

---

## Task 2: store helpers — insert + 2 join queries

**Files:**
- Modify: `backend/src/lib/store.ts` (append helpers)
- Test: `backend/src/lib/__tests__/store.attribution.test.ts` (extend)

- [ ] **Step 1: 写失败测试 — append 到 attribution test**

Append to `backend/src/lib/__tests__/store.attribution.test.ts`:

```typescript
import {
  insertAttribution,
  getAttributionByRequestIds,
  getAttributionsForJoin,
} from '../store.js';

describe('attribution helpers', () => {
  it('insertAttribution + getAttributionByRequestIds round-trip', () => {
    const now = new Date().toISOString();
    insertAttribution({
      requestId: 'tb-r-1',
      userId: 'u_alice',
      source: 'openclaw',
      sourceMethod: 'header',
      model: 'gpt-5.4-mini',
      capturedAt: now,
    });
    insertAttribution({
      requestId: 'tb-r-2',
      userId: 'u_alice',
      source: 'hermes',
      sourceMethod: 'ua',
      model: 'gpt-5.4',
      capturedAt: now,
    });
    insertAttribution({
      requestId: 'tb-r-3',
      userId: 'u_bob',
      source: 'other',
      sourceMethod: 'fallback',
      model: 'gpt-5.5',
      capturedAt: now,
    });

    const got = getAttributionByRequestIds(['tb-r-1', 'tb-r-3', 'tb-missing']);
    expect(got.size).toBe(2);
    expect(got.get('tb-r-1')?.source).toBe('openclaw');
    expect(got.get('tb-r-3')?.source).toBe('other');
    expect(got.get('tb-missing')).toBeUndefined();
  });

  it('insertAttribution is idempotent on duplicate requestId (INSERT OR IGNORE)', () => {
    const now = new Date().toISOString();
    insertAttribution({
      requestId: 'tb-dup', userId: 'u_alice', source: 'openclaw', sourceMethod: 'header', model: 'm', capturedAt: now,
    });
    // Second insert with same requestId but different source should be a no-op.
    insertAttribution({
      requestId: 'tb-dup', userId: 'u_alice', source: 'hermes', sourceMethod: 'header', model: 'm', capturedAt: now,
    });
    const got = getAttributionByRequestIds(['tb-dup']);
    expect(got.get('tb-dup')?.source).toBe('openclaw'); // first wins
  });

  it('getAttributionsForJoin filters by user + model + time window', () => {
    const t0 = new Date('2026-04-30T12:00:00Z').toISOString();
    const t3 = new Date('2026-04-30T12:00:03Z').toISOString();
    const t10 = new Date('2026-04-30T12:00:10Z').toISOString();

    insertAttribution({ requestId: 'tb-j-1', userId: 'u_join', source: 'openclaw', sourceMethod: 'header', model: 'gpt-5.4', capturedAt: t0 });
    insertAttribution({ requestId: 'tb-j-2', userId: 'u_join', source: 'hermes', sourceMethod: 'header', model: 'gpt-5.4', capturedAt: t3 });
    insertAttribution({ requestId: 'tb-j-3', userId: 'u_join', source: 'codex', sourceMethod: 'header', model: 'gpt-5.4', capturedAt: t10 });
    insertAttribution({ requestId: 'tb-j-4', userId: 'u_join', source: 'codex', sourceMethod: 'header', model: 'gpt-4o-mini', capturedAt: t3 });
    insertAttribution({ requestId: 'tb-j-5', userId: 'u_other', source: 'openclaw', sourceMethod: 'header', model: 'gpt-5.4', capturedAt: t3 });

    // Window: t0 → t3+5s = 12:00:08; user_join + model gpt-5.4
    const rows = getAttributionsForJoin('u_join', ['gpt-5.4'], t0, '2026-04-30T12:00:08.000Z');
    const ids = new Set(rows.map((r) => r.requestId));
    expect(ids.has('tb-j-1')).toBe(true); // in window, matching model+user
    expect(ids.has('tb-j-2')).toBe(true);
    expect(ids.has('tb-j-3')).toBe(false); // capturedAt > window end
    expect(ids.has('tb-j-4')).toBe(false); // wrong model
    expect(ids.has('tb-j-5')).toBe(false); // wrong user
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx vitest run src/lib/__tests__/store.attribution.test.ts`
Expected: FAIL — `insertAttribution` not exported.

- [ ] **Step 3: 实现 helpers**

Append to `backend/src/lib/store.ts` (after the existing order helpers, before any final block):

```typescript
// ---------- Public API — Usage Attribution ----------

export interface AttributionRecord {
  requestId: string;
  userId: string;
  source: string;
  sourceMethod: 'header' | 'ua' | 'fallback';
  model: string | null;
  capturedAt: string;
}

/** INSERT OR IGNORE — duplicate requestId is a no-op (first write wins).
 *  Caller should not depend on whether the insert actually happened; this
 *  is best-effort observability data. */
export function insertAttribution(rec: AttributionRecord): void {
  db.prepare(`
    INSERT OR IGNORE INTO usage_attribution
      (requestId, userId, source, sourceMethod, model, capturedAt)
    VALUES
      (@requestId, @userId, @source, @sourceMethod, @model, @capturedAt)
  `).run({
    requestId: rec.requestId,
    userId: rec.userId,
    source: rec.source,
    sourceMethod: rec.sourceMethod,
    model: rec.model ?? null,
    capturedAt: rec.capturedAt,
  });
}

/** Batch fetch by requestId. Returns a Map for O(1) lookup. Missing
 *  requestIds are simply absent from the result. */
export function getAttributionByRequestIds(
  requestIds: string[],
): Map<string, AttributionRecord> {
  const out = new Map<string, AttributionRecord>();
  if (requestIds.length === 0) return out;
  const placeholders = requestIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT requestId, userId, source, sourceMethod, model, capturedAt
         FROM usage_attribution
        WHERE requestId IN (${placeholders})`,
    )
    .all(...requestIds) as Array<{
      requestId: string;
      userId: string;
      source: string;
      sourceMethod: AttributionRecord['sourceMethod'];
      model: string | null;
      capturedAt: string;
    }>;
  for (const r of rows) {
    out.set(r.requestId, {
      requestId: r.requestId,
      userId: r.userId,
      source: r.source,
      sourceMethod: r.sourceMethod,
      model: r.model,
      capturedAt: r.capturedAt,
    });
  }
  return out;
}

/** Soft-join fetch: returns all attribution rows in the window matching
 *  user + any of the given models. Caller picks the closest capturedAt
 *  per newapi log entry. */
export function getAttributionsForJoin(
  userId: string,
  models: string[],
  minCapturedAt: string,  // inclusive ISO
  maxCapturedAt: string,  // inclusive ISO
): AttributionRecord[] {
  if (models.length === 0) return [];
  const placeholders = models.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT requestId, userId, source, sourceMethod, model, capturedAt
         FROM usage_attribution
        WHERE userId = ?
          AND capturedAt BETWEEN ? AND ?
          AND model IN (${placeholders})`,
    )
    .all(userId, minCapturedAt, maxCapturedAt, ...models) as Array<{
      requestId: string;
      userId: string;
      source: string;
      sourceMethod: AttributionRecord['sourceMethod'];
      model: string | null;
      capturedAt: string;
    }>;
  return rows.map((r) => ({
    requestId: r.requestId,
    userId: r.userId,
    source: r.source,
    sourceMethod: r.sourceMethod,
    model: r.model,
    capturedAt: r.capturedAt,
  }));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npx vitest run src/lib/__tests__/store.attribution.test.ts`
Expected: PASS (6 tests).

Run wider suite: `cd backend && npx vitest run`
Expected: 83/83 (was 80 + 3 new). No regressions.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/store.ts backend/src/lib/__tests__/store.attribution.test.ts
git commit -m "feat(store): attribution insert + batched join helpers

insertAttribution (INSERT OR IGNORE for idempotency on race),
getAttributionByRequestIds (batched exact join via Map),
getAttributionsForJoin (soft-join window query). All three are O(1)
or single-SQL-batch — no N+1 from /v1/usage."
```

---

## Task 3: sourceAttribution.ts — header / UA parsing

**Files:**
- Create: `backend/src/lib/sourceAttribution.ts`
- Test: `backend/src/lib/__tests__/sourceAttribution.test.ts` (new)

- [ ] **Step 1: 写失败测试**

Create `backend/src/lib/__tests__/sourceAttribution.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseSourceHeader, parseUaSource, resolveSource } from '../sourceAttribution.js';

describe('parseSourceHeader', () => {
  it('lowercases + accepts a valid slug', () => {
    expect(parseSourceHeader('OpenClaw')).toEqual({ slug: 'openclaw', method: 'header' });
    expect(parseSourceHeader('hermes')).toEqual({ slug: 'hermes', method: 'header' });
    expect(parseSourceHeader('claude-code')).toEqual({ slug: 'claude-code', method: 'header' });
  });

  it('truncates to 32 chars', () => {
    const long = 'a'.repeat(50);
    const got = parseSourceHeader(long);
    expect(got?.slug).toHaveLength(32);
  });

  it('rejects illegal characters (returns null → fall through)', () => {
    expect(parseSourceHeader('open claw')).toBeNull();        // space
    expect(parseSourceHeader('open_claw')).toBeNull();        // underscore
    expect(parseSourceHeader('open/claw')).toBeNull();        // slash
    expect(parseSourceHeader('open.claw')).toBeNull();        // dot
    expect(parseSourceHeader('🤖')).toBeNull();                // emoji
  });

  it('returns null on undefined / empty', () => {
    expect(parseSourceHeader(undefined)).toBeNull();
    expect(parseSourceHeader('')).toBeNull();
    expect(parseSourceHeader('   ')).toBeNull();
  });
});

describe('parseUaSource', () => {
  it('matches each of the 4 known agent UA patterns', () => {
    expect(parseUaSource('openclaw-cli/1.2.3')?.slug).toBe('openclaw');
    expect(parseUaSource('Hermes-SDK/0.5.0 (linux)')?.slug).toBe('hermes');
    expect(parseUaSource('Mozilla/5.0 Claude-Code/1.0')?.slug).toBe('claude-code');
    expect(parseUaSource('codex-runtime/2.1')?.slug).toBe('codex');
  });

  it('matches case-insensitively', () => {
    expect(parseUaSource('OPENCLAW/1.0')?.slug).toBe('openclaw');
    expect(parseUaSource('claude_code/1.0')?.slug).toBe('claude-code'); // claude.?code regex
  });

  it('returns null when no pattern matches', () => {
    expect(parseUaSource('curl/8.0')).toBeNull();
    expect(parseUaSource('Mozilla/5.0 (X11; Linux)')).toBeNull();
    expect(parseUaSource(undefined)).toBeNull();
    expect(parseUaSource('')).toBeNull();
  });

  it('all matches carry method=ua', () => {
    expect(parseUaSource('openclaw/1.0')?.method).toBe('ua');
  });
});

describe('resolveSource', () => {
  it('header wins over UA', () => {
    const got = resolveSource({
      'x-source': 'codex',
      'user-agent': 'openclaw-cli/1.0',
    });
    expect(got).toEqual({ slug: 'codex', method: 'header' });
  });

  it('UA wins when no header', () => {
    expect(resolveSource({ 'user-agent': 'hermes/1.0' })).toEqual({
      slug: 'hermes',
      method: 'ua',
    });
  });

  it("falls back to 'other' when neither header nor UA matches", () => {
    expect(resolveSource({ 'user-agent': 'curl/8.0' })).toEqual({
      slug: 'other',
      method: 'fallback',
    });
    expect(resolveSource({})).toEqual({
      slug: 'other',
      method: 'fallback',
    });
  });

  it('illegal X-Source falls through to UA / fallback', () => {
    expect(resolveSource({ 'x-source': 'bad space', 'user-agent': 'openclaw/1.0' })).toEqual({
      slug: 'openclaw',
      method: 'ua',
    });
  });

  it('header lookup is case-insensitive (Lambda lowercases, but be safe)', () => {
    expect(resolveSource({ 'X-Source': 'openclaw' })).toEqual({
      slug: 'openclaw',
      method: 'header',
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx vitest run src/lib/__tests__/sourceAttribution.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: 实现 sourceAttribution.ts**

Create `backend/src/lib/sourceAttribution.ts`:

```typescript
/**
 * Per-call source attribution: resolve which Agent (OpenClaw / Hermes /
 * Claude Code / Codex / third-party / other) made a chat completion
 * request, given its incoming HTTP headers.
 *
 * Resolution chain (first match wins):
 *   1. Explicit `X-Source: <slug>` header (validated against [a-z0-9-]{1,32})
 *   2. `User-Agent` regex match against the four canonical agent patterns
 *   3. Fallback to `'other'`
 *
 * The chat-completions line guarantees a non-null source by always
 * falling through to 'other' — downstream / frontend never has to
 * handle null for chat traffic.
 */

export type SourceMethod = 'header' | 'ua' | 'fallback';

export interface ResolvedSource {
  slug: string;
  method: SourceMethod;
}

const MAX_SLUG_LEN = 32;
const SLUG_RE = /^[a-z0-9-]+$/;

/** Normalize + validate an X-Source header value.
 *  Returns null when the input is missing, empty, or contains illegal chars. */
export function parseSourceHeader(raw: string | undefined): ResolvedSource | null {
  if (!raw) return null;
  const lowered = raw.trim().toLowerCase();
  if (!lowered) return null;
  const truncated = lowered.slice(0, MAX_SLUG_LEN);
  if (!SLUG_RE.test(truncated)) return null;
  return { slug: truncated, method: 'header' };
}

// UA → slug mapping. First match wins. Patterns are intentionally loose —
// SDKs may include version suffixes, platform info, etc.
const UA_PATTERNS: Array<[RegExp, string]> = [
  [/openclaw/i, 'openclaw'],
  [/hermes/i, 'hermes'],
  [/claude.?code/i, 'claude-code'],  // matches 'claude-code', 'claude_code', 'claudecode'
  [/codex/i, 'codex'],
];

/** Match incoming User-Agent against the 4 canonical agent patterns. */
export function parseUaSource(ua: string | undefined): ResolvedSource | null {
  if (!ua) return null;
  for (const [re, slug] of UA_PATTERNS) {
    if (re.test(ua)) return { slug, method: 'ua' };
  }
  return null;
}

/** Headers map (case-insensitive lookup tolerated). Falls back to 'other'
 *  so chat-completions source is never null. */
export function resolveSource(headers: Record<string, string | undefined>): ResolvedSource {
  // Lambda lowercases header names, but be defensive about case-mixed inputs.
  const get = (name: string): string | undefined => {
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === lower) return v;
    }
    return undefined;
  };

  return (
    parseSourceHeader(get('x-source')) ??
    parseUaSource(get('user-agent')) ??
    { slug: 'other', method: 'fallback' }
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npx vitest run src/lib/__tests__/sourceAttribution.test.ts`
Expected: PASS — all describes green.

Run wider suite: `cd backend && npx vitest run`
Expected: green; new test count adds the source-attribution tests on top of 83.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/sourceAttribution.ts backend/src/lib/__tests__/sourceAttribution.test.ts
git commit -m "feat(attribution): X-Source header + UA fallback resolver

Pure functions: parseSourceHeader (slug validation) + parseUaSource
(4-agent regex) + resolveSource (chain). Always returns a slug —
chat-completions source is never null after this lands."
```

---

## Task 4: chatProxy entry — capture + forward X-Request-ID

**Files:**
- Modify: `backend/src/lib/chatProxyCore.ts` (entry block + upstream fetch headers)
- Test: `backend/src/handlers/__tests__/chatProxyAttribution.test.ts` (new)

- [ ] **Step 1: 写失败测试 (mock upstream)**

Create `backend/src/handlers/__tests__/chatProxyAttribution.test.ts`:

```typescript
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';

process.env.SESSION_SECRET = 'test-secret-32bytes-min-aaaaaaaaaaa';
process.env.SQLITE_PATH = ':memory:';
process.env.MOCK_UPSTREAM = '1';            // chatProxyCore synthesizes a fake response
process.env.UPSTREAM_API_URL = 'http://upstream.test.local';
process.env.NEWAPI_BASE_URL = 'http://newapi.test.local';

import { init, db, putUser, putApiKeyIndex } from '../../lib/store.js';
import { streamChatCore } from '../../lib/chatProxyCore.js';

const userId = 'u_proxy_test';
const rawKey = 'sk-test-12345678';
const keyHash = createHash('sha256').update(rawKey).digest('hex');

beforeAll(() => {
  init();
  putUser({
    userId,
    email: 'proxy@test.local',
    createdAt: new Date().toISOString(),
    newapiUserId: 100,
    newapiPassword: 'pwd',
  });
  putApiKeyIndex({ userId, newapiTokenId: 1, keyHash });
});

function captureWriter() {
  let status = 0;
  const headers: Record<string, string> = {};
  const chunks: string[] = [];
  return {
    writer: {
      writeHead(s: number, h: Record<string, string>) { status = s; Object.assign(headers, h); },
      write(c: Uint8Array | string) {
        chunks.push(typeof c === 'string' ? c : new TextDecoder().decode(c));
      },
      end() {},
    },
    get status() { return status; },
    get headers() { return headers; },
    get capturedHeader() {
      // chatProxy may set x-request-id back on response too; surface it for assertions.
      return headers['x-request-id'] ?? null;
    },
  };
}

function chatEvent(extraHeaders: Record<string, string> = {}, model = 'gpt-4o-mini') {
  return {
    headers: { authorization: `Bearer ${rawKey}`, ...extraHeaders },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
    isBase64Encoded: false,
  } as any;
}

beforeEach(() => {
  // Clear attribution rows between tests so assertions are deterministic.
  db.exec(`DELETE FROM usage_attribution`);
});

describe('chatProxy — attribution capture', () => {
  it('writes attribution row with source=openclaw / method=header when X-Source set', async () => {
    const cap = captureWriter();
    await streamChatCore(chatEvent({ 'x-source': 'openclaw' }), cap.writer);
    const rows = db.prepare(`SELECT * FROM usage_attribution`).all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(userId);
    expect(rows[0].source).toBe('openclaw');
    expect(rows[0].sourceMethod).toBe('header');
    expect(rows[0].model).toBe('gpt-4o-mini');
    expect(rows[0].requestId).toMatch(/^tb-[0-9a-f]{8}$/);
  });

  it('falls back to UA when no X-Source', async () => {
    const cap = captureWriter();
    await streamChatCore(chatEvent({ 'user-agent': 'hermes-cli/1.0' }), cap.writer);
    const rows = db.prepare(`SELECT * FROM usage_attribution`).all() as any[];
    expect(rows[0].source).toBe('hermes');
    expect(rows[0].sourceMethod).toBe('ua');
  });

  it("falls back to 'other' when neither X-Source nor UA matches", async () => {
    const cap = captureWriter();
    await streamChatCore(chatEvent({ 'user-agent': 'curl/8.0' }), cap.writer);
    const rows = db.prepare(`SELECT * FROM usage_attribution`).all() as any[];
    expect(rows[0].source).toBe('other');
    expect(rows[0].sourceMethod).toBe('fallback');
  });

  it('skips attribution when bearer key is unknown (no api_key_index entry)', async () => {
    const cap = captureWriter();
    const evt = {
      headers: { authorization: 'Bearer sk-unknown-99999999', 'x-source': 'openclaw' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }),
      isBase64Encoded: false,
    } as any;
    await streamChatCore(evt, cap.writer);
    const rows = db.prepare(`SELECT * FROM usage_attribution`).all() as any[];
    expect(rows).toHaveLength(0);
  });

  it('respects SOURCE_ATTRIBUTION=off env (no row written)', async () => {
    process.env.SOURCE_ATTRIBUTION = 'off';
    const cap = captureWriter();
    await streamChatCore(chatEvent({ 'x-source': 'openclaw' }), cap.writer);
    const rows = db.prepare(`SELECT * FROM usage_attribution`).all() as any[];
    expect(rows).toHaveLength(0);
    delete process.env.SOURCE_ATTRIBUTION;
  });

  it('attribution write failure does not block the chat response', async () => {
    // Force the next insert to throw by spying on the underlying store.
    const spy = vi.spyOn(await import('../../lib/store.js'), 'insertAttribution').mockImplementation(() => {
      throw new Error('synthetic SQLite failure');
    });
    const cap = captureWriter();
    await streamChatCore(chatEvent({ 'x-source': 'openclaw' }), cap.writer);
    expect(cap.status).toBeGreaterThanOrEqual(200);
    expect(cap.status).toBeLessThan(500);
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx vitest run src/handlers/__tests__/chatProxyAttribution.test.ts`
Expected: FAIL — chatProxy doesn't write attribution rows yet.

- [ ] **Step 3: 修改 chatProxyCore.ts**

In `backend/src/lib/chatProxyCore.ts`, add imports near the top (after the existing `import` block):

```typescript
import { createHash, randomBytes } from 'node:crypto';

import {
  getUserIdByKeyHash,
  insertAttribution,
} from './store.js';
import { resolveSource } from './sourceAttribution.js';
```

Then, near the top of `streamChatCore` (right after the body parse, around the existing line 117 `body = ...`), insert the attribution capture block. The block runs BEFORE the upstream fetch so we can also stash the request_id and forward it.

Find this section in `streamChatCore`:

```typescript
  // ---------- Parse body ----------
  let body: Record<string, unknown>;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? "", "base64").toString("utf8")
      : (event.body ?? "");
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch (err) {
    writeJsonError(
      writer,
      400,
      "invalid_request_error",
      `Could not parse JSON body: ${String(err)}`,
    );
    return;
  }
```

After it (before any model resolution), add:

```typescript
  // ---------- Source attribution (best-effort, non-blocking) ----------
  // Generate our own request_id; forward to upstream as X-Request-ID so
  // that newapi can (hopefully) log it as the entry's request_id, enabling
  // exact join in /v1/usage. Even if newapi reroles, the soft-join path
  // covers it.
  const requestId = `tb-${randomBytes(4).toString('hex')}`;

  // Capture attribution row only when (a) feature isn't disabled and
  // (b) we can identify the TokenBoss user from the bearer.
  if (process.env.SOURCE_ATTRIBUTION !== 'off') {
    try {
      const bearer = (() => {
        if (!authHeader) return null;
        const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
        return m ? m[1].trim() : authHeader.trim();
      })();
      if (bearer && bearer.length > 0) {
        const keyHash = createHash('sha256').update(bearer).digest('hex');
        const ownerUserId = getUserIdByKeyHash(keyHash);
        if (ownerUserId) {
          const headerMap: Record<string, string | undefined> = {};
          for (const [k, v] of Object.entries(event.headers ?? {})) {
            if (typeof v === 'string') headerMap[k] = v;
          }
          const { slug, method } = resolveSource(headerMap);
          insertAttribution({
            requestId,
            userId: ownerUserId,
            source: slug,
            sourceMethod: method,
            model: typeof body.model === 'string' ? body.model : null,
            capturedAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      // Best-effort: never block the chat completion on attribution.
      console.warn('[chatProxy] attribution insert failed', {
        requestId,
        error: (err as Error).message,
      });
    }
  }
```

Then, in the upstream `fetch` call (around lines 236-245 — the `headers: { ... }` block), add the X-Request-ID header:

```typescript
        const res = await fetch(`${base}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: authHeader,
            "x-request-id": requestId,
          },
          body: JSON.stringify(body),
          // @ts-expect-error undici-specific extension on fetch init
          dispatcher: upstreamDispatcher,
        });
```

(`authHeader` MAY be undefined per existing nullable handling; the upstream call already passes it through with that risk, so no new behaviour. The `x-request-id` is always defined since we generated it.)

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npx vitest run src/handlers/__tests__/chatProxyAttribution.test.ts`
Expected: PASS (6 tests).

Run wider suite: `cd backend && npx vitest run`
Expected: green. No regressions.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/chatProxyCore.ts backend/src/handlers/__tests__/chatProxyAttribution.test.ts
git commit -m "feat(chatProxy): capture source + forward X-Request-ID

At /v1/chat/completions entry: generate tb-<hex> request_id, resolve
source via header → UA → 'other', sha256(bearer) → api_key_index
lookup for userId, INSERT OR IGNORE attribution row. Forward
X-Request-ID to upstream for exact-join fallback. All wrapped in
try/catch — chat completion never fails because attribution failed.

Gated by SOURCE_ATTRIBUTION=off env for emergency rollback."
```

---

## Task 5: usageHandlers — join attribution into source field

> **PROBE RESULT (Task 0):** SOFT_JOIN_REQUIRED
> 因此 Task 5 实施软 join 路径。newapi 忽略转发的 `X-Request-ID`，始终自己生成（格式如 `202604300158119389174738268d9d6JRPexzr9`）；无法用精确 join。

**Files:**
- Modify: `backend/src/handlers/usageHandlers.ts` (mapNewapiLog + join layer in `/v1/usage` handler)
- Modify: `backend/src/handlers/__tests__/usage.test.ts` (extend with join tests)

- [ ] **Step 1: 写失败测试 — extend usage.test.ts**

Append to `backend/src/handlers/__tests__/usage.test.ts` (within the existing `describe` for the GET handler):

```typescript
// (Add at top of file if not present:)
// import { insertAttribution } from '../../lib/store.js';

describe('GET /v1/usage — source attribution join', () => {
  it('fills source from attribution when matched', async () => {
    // Pre-insert attribution rows that match the upcoming mock newapi log entries.
    insertAttribution({
      requestId: 'tb-aaaaaaaa',
      userId: 'u_alice',  // must match the user behind the test bearer
      source: 'openclaw',
      sourceMethod: 'header',
      model: 'gpt-4o-mini',
      capturedAt: new Date().toISOString(),
    });

    // Mock newapi.queryUserLogs to return one entry whose request_id
    // matches the attribution row above.
    // [Existing tests show how queryUserLogs is mocked — follow that pattern.]
    // Then call the handler and assert the response.records[0].source === 'openclaw'.
  });

  it("fills source='other' when attribution misses", async () => {
    // Mock a newapi entry whose request_id is NOT in usage_attribution.
    // Assert response.records[0].source === 'other'.
  });

  it("fills source='other' for entries from before the feature deployed", async () => {
    // No attribution rows. Mock newapi entry from a week ago.
    // Assert source === 'other'.
  });
});
```

(The exact mocking shape depends on how `usage.test.ts` already mocks newapi — read existing tests in this file before writing the new ones; follow the established pattern. The assertions above are what matters.)

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx vitest run src/handlers/__tests__/usage.test.ts`
Expected: FAIL — `mapNewapiLog` still returns `source: null`, no join performed.

- [ ] **Step 3a: 实现精确 join (use only if PROBE = EXACT_JOIN_OK)**

In `backend/src/handlers/usageHandlers.ts`, find the handler that calls `newapi.queryUserLogs(...)` (the `/v1/usage` GET handler). After it gets the page back, add a join step:

```typescript
import { getAttributionByRequestIds } from '../lib/store.js';

// ... inside the handler, after fetching `page` from newapi:
const requestIds = page.items.map((e) => e.request_id).filter(Boolean) as string[];
const attrMap = getAttributionByRequestIds(requestIds);

const records = page.items.map((entry) => {
  const base = mapNewapiLog(entry, userId);
  const attr = attrMap.get(entry.request_id);
  return {
    ...base,
    source: attr?.source ?? 'other',  // chat-completions line never null
  };
});
```

Also remove the `source: null` line from `mapNewapiLog` (around line 92) — change it to `source: null` as a placeholder (the join layer always overrides it for chat-completions). Or simpler: leave `mapNewapiLog` returning `source: null`, and the join layer above explicitly sets `'other'` when no attribution. Either reads cleanly; pick the version that produces the smaller diff.

- [ ] **Step 3b: 实现软 join (use only if PROBE = SOFT_JOIN_REQUIRED)**

If exact join is not available, replace Step 3a with:

```typescript
import { getAttributionsForJoin } from '../lib/store.js';

// ... inside the handler, after fetching `page` from newapi:
const minTs = Math.min(...page.items.map((e) => e.created_at));
const maxTs = Math.max(...page.items.map((e) => e.created_at));
const minIso = new Date((minTs - 5) * 1000).toISOString();
const maxIso = new Date((maxTs + 5) * 1000).toISOString();
const distinctModels = Array.from(new Set(page.items.map((e) => e.model_name).filter(Boolean)));

const attributions = page.items.length > 0
  ? getAttributionsForJoin(userId, distinctModels, minIso, maxIso)
  : [];

const records = page.items.map((entry) => {
  const base = mapNewapiLog(entry, userId);
  // Pick the closest attribution by |capturedAt - entry.created_at|, with
  // matching model + within ±5s window.
  let best: { slug: string; deltaMs: number } | null = null;
  const entryMs = entry.created_at * 1000;
  for (const attr of attributions) {
    if (attr.model !== entry.model_name) continue;
    const captureMs = new Date(attr.capturedAt).getTime();
    const delta = Math.abs(captureMs - entryMs);
    if (delta > 5000) continue;
    if (!best || delta < best.deltaMs) {
      best = { slug: attr.source, deltaMs: delta };
    }
  }
  return { ...base, source: best?.slug ?? 'other' };
});
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npx vitest run src/handlers/__tests__/usage.test.ts`
Expected: PASS — 3 new tests + existing tests still green.

Run wider suite: `cd backend && npx vitest run`
Expected: green. No regressions.

- [ ] **Step 5: Commit**

```bash
git add backend/src/handlers/usageHandlers.ts backend/src/handlers/__tests__/usage.test.ts
git commit -m "feat(usage): join attribution into source field

[EXACT_JOIN | SOFT_JOIN per Task 0 probe]: /v1/usage now resolves the
source for each chat-completions log entry by joining usage_attribution.
Falls back to 'other' on miss — chat-completions source is never null
in the API response after this lands.

Other endpoints (embeddings/audio) still return source=null and rely
on the existing keyHint UI fallback (commit 1be9be2)."
```

---

## Task 6: frontend sourceDisplay.ts

**Files:**
- Create: `frontend/src/lib/sourceDisplay.ts`
- Test: `frontend/src/lib/__tests__/sourceDisplay.test.ts` (new)

- [ ] **Step 1: 写失败测试**

Create `frontend/src/lib/__tests__/sourceDisplay.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatSource } from '../sourceDisplay';

describe('formatSource', () => {
  it('renders the 4 known agent slugs as their brand-correct display names', () => {
    expect(formatSource('openclaw')).toBe('OpenClaw');
    expect(formatSource('hermes')).toBe('Hermes');
    expect(formatSource('claude-code')).toBe('Claude Code');
    expect(formatSource('codex')).toBe('Codex');
  });

  it("renders 'other' as 'Other'", () => {
    expect(formatSource('other')).toBe('Other');
  });

  it('title-cases unknown slugs (third-party agents)', () => {
    expect(formatSource('random-test')).toBe('Random Test');
    expect(formatSource('my-bot')).toBe('My Bot');
    expect(formatSource('singleword')).toBe('Singleword');
  });

  it('returns — for null / undefined / empty', () => {
    expect(formatSource(null)).toBe('—');
    expect(formatSource(undefined)).toBe('—');
    expect(formatSource('')).toBe('—');
    expect(formatSource('   ')).toBe('—');
  });

  it('handles uppercase input via lowercase-first', () => {
    expect(formatSource('OpenClaw')).toBe('OpenClaw');  // re-cased via display map
    expect(formatSource('OTHER')).toBe('Other');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/lib/__tests__/sourceDisplay.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: 实现 sourceDisplay.ts**

Create `frontend/src/lib/sourceDisplay.ts`:

```typescript
/**
 * Display layer for `usage.records[*].source`. Backend ships normalized
 * lowercase slugs (per spec § 2 — `[a-z0-9-]{1,32}`); the frontend
 * maps known slugs to their brand-correct display names and titlecases
 * everything else.
 *
 * Mirrors the design of `formatModelName` — known list gets explicit
 * pretty names; unknown patterns are passed through with light cleanup
 * so we never lose information.
 */

const KNOWN_DISPLAY: Record<string, string> = {
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
  'claude-code': 'Claude Code',
  codex: 'Codex',
  other: 'Other',
};

export function formatSource(slug: string | null | undefined): string {
  if (!slug) return '—';
  const cleaned = slug.trim().toLowerCase();
  if (!cleaned) return '—';

  const known = KNOWN_DISPLAY[cleaned];
  if (known) return known;

  // Unknown slug — split by '-', titlecase each word.
  const parts = cleaned.split('-').filter(Boolean);
  if (parts.length === 0) return '—';
  return parts.map((p) => p[0]!.toUpperCase() + p.slice(1)).join(' ');
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd frontend && npx vitest run src/lib/__tests__/sourceDisplay.test.ts`
Expected: PASS — all describes green.

Run wider suite: `cd frontend && npx vitest run`
Expected: green. No regressions.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/sourceDisplay.ts frontend/src/lib/__tests__/sourceDisplay.test.ts
git commit -m "feat(frontend): formatSource() display map for source slugs

Known agents (openclaw / hermes / claude-code / codex / other) get
brand-correct display names; unknown slugs are titlecased by '-' words.
Mirror of formatModelName design — never lose information."
```

---

## Task 7: UI integration — UsageHistory + Dashboard call sites

**Files:**
- Modify: `frontend/src/screens/UsageHistory.tsx` (1 line)
- Modify: `frontend/src/screens/Dashboard.tsx` (1 line)

- [ ] **Step 1: 改 UsageHistory.tsx**

In `frontend/src/screens/UsageHistory.tsx`, add the import at the top:

```tsx
import { formatSource } from '../lib/sourceDisplay';
```

Then find the `<UsageRow ...>` invocation. Locate the source prop (currently `source={r.source || r.keyHint || undefined}`) and replace with the explicit ternary required by the spec:

```tsx
                    source={r.source ? formatSource(r.source) : (r.keyHint ?? undefined)}
```

The associated comment block (above the `source=` line, explaining the keyHint fallback) should be updated to reflect the new chain:

```tsx
                    // chat-completions line: r.source non-null (worst case 'other')
                    // → formatSource displays the brand name. Other endpoints
                    // (embeddings/audio etc.) still return source=null →
                    // right-hand keyHint fallback (legacy path, commit 1be9be2).
```

- [ ] **Step 2: 改 Dashboard.tsx**

In `frontend/src/screens/Dashboard.tsx`, add the import:

```tsx
import { formatSource } from '../lib/sourceDisplay';
```

Find the `<UsageRow ...>` invocation near line 501. Same edit:

```tsx
                      source={r.source ? formatSource(r.source) : (r.keyHint ?? undefined)}
```

Update the surrounding comment to match the UsageHistory version above.

- [ ] **Step 3: 跑测试 + tsc**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 errors.

Run: `cd frontend && npx vitest run`
Expected: all tests still green.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screens/UsageHistory.tsx frontend/src/screens/Dashboard.tsx
git commit -m "feat(frontend): wire formatSource into UsageHistory + Dashboard

Switch from 'source ?? keyHint ?? —' to explicit ternary
'r.source ? formatSource(r.source) : (r.keyHint ?? undefined)'.

Important: NOT 'formatSource(r.source) ?? r.keyHint' — formatSource
returns '—' (truthy) for null input, which would break the keyHint
fallback for non-chat endpoints."
```

---

## Task 8: Docs — SDK contract + e2e test guide + final regression

**Files:**
- Create: `docs/sdk-source-attribution.md`
- Modify: `docs/订阅测试指南.md` (append section)

- [ ] **Step 1: 写 SDK 协议文档**

Create `docs/sdk-source-attribution.md`:

````markdown
# SDK Source Attribution Contract

## What this is

TokenBoss tracks which Agent (OpenClaw / Hermes / Claude Code / Codex /
third-party) made each `POST /v1/chat/completions` call so the user's
`/console/history` can show real attribution instead of generic API-key
labels.

## What an SDK should do

Send a `X-Source` header on every chat completion request:

```http
POST /v1/chat/completions
X-Source: openclaw
Authorization: Bearer sk-xxx
Content-Type: application/json
```

### Header value

- Charset: `[a-z0-9-]`
- Length: 1-32 chars (longer is silently truncated)
- Lowercase (uppercase is silently lowercased)

### Canonical slugs (TokenBoss-recognized)

| Slug | Display |
|---|---|
| `openclaw` | OpenClaw |
| `hermes` | Hermes |
| `claude-code` | Claude Code |
| `codex` | Codex |

Third-party Agents pick their own slug; TokenBoss titlecases it for
display (e.g. `my-bot` → "My Bot").

## Fallback: User-Agent sniffing

If no `X-Source` header is present, TokenBoss falls back to scanning
the `User-Agent` header:

| UA pattern | → slug |
|---|---|
| `/openclaw/i` | `openclaw` |
| `/hermes/i` | `hermes` |
| `/claude.?code/i` | `claude-code` |
| `/codex/i` | `codex` |

This is best-effort — explicit `X-Source` is **strongly recommended**
for accurate attribution.

## Last fallback: 'other'

Calls with neither matching `X-Source` nor recognized UA appear in the
dashboard as "Other". This is expected for hand-`curl`'d requests,
unknown integrations, etc.

## Privacy

`X-Source` values are stored on TokenBoss-side for 30 days, then
purged. No PII; just the agent slug.
````

- [ ] **Step 2: 追加 e2e 章节到测试指南**

Append to `docs/订阅测试指南.md`:

```markdown

---

## X-Source 全链路 Agent 归属 e2e 测试

### 准备

- 后端 `SOURCE_ATTRIBUTION` env 不设或设为非 'off'
- chatProxy 已部署带 attribution 写入的 commit
- 至少 1 个 TokenBoss 用户配好可调用的 sk-xxx key

### 场景 1 — 显式 X-Source header → /console/history 显 OpenClaw

1. curl 调一次 chat completion，带 `-H "X-Source: openclaw"`
2. 等 60s，登录该用户的 /console/history
3. 那条 entry 的 来源 列应显示 `OpenClaw`

### 场景 2 — UA fallback

1. curl 调一次 chat completion，带 `-H "User-Agent: hermes-cli/1.0"`，**不带** X-Source
2. /console/history 来源应显 `Hermes`

### 场景 3 — 兜底 Other

1. curl 调一次 chat completion，不带 X-Source 也不带能识别的 UA（`-H "User-Agent: curl/8.0"`）
2. /console/history 来源应显 `Other`

### 场景 4 — 第三方 slug 透传

1. curl 带 `-H "X-Source: random-test"`
2. /console/history 来源应显 `Random Test`

### 场景 5 — 非法 X-Source 落到 UA fallback

1. curl 带 `-H "X-Source: bad space"` + `-H "User-Agent: openclaw/1.0"`
2. /console/history 来源应显 `OpenClaw`（X-Source 因含空格被丢，UA 接力）

### 场景 6 — SOURCE_ATTRIBUTION=off rollback

1. 后端 env 设 `SOURCE_ATTRIBUTION=off`，重启
2. curl 带 X-Source 调一次
3. /console/history 来源应显 token 名（commit 1be9be2 keyHint fallback）—— 跟没接 attribution 的状态一致
4. 改回 `SOURCE_ATTRIBUTION=on`（或 unset），重启
5. 新调用恢复 attribution

### 场景 7 — attribution 写入失败不阻塞主流程

1. （仅本地测试）临时把 `usage_attribution` 表 drop
2. curl 调一次 chat completion → 应正常 200
3. backend log 应有 `[chatProxy] attribution insert failed` warn 行
4. 重启后表自动重建
```

- [ ] **Step 3: 全套回归 + tsc**

```bash
cd backend && npx vitest run
cd frontend && npx tsc --noEmit && npx vitest run
```

Both green. Backend should be ~89/89; frontend ~50/50 (depending on exact pre-existing counts; verify everything green).

- [ ] **Step 4: Commit**

```bash
git add docs/sdk-source-attribution.md "docs/订阅测试指南.md"
git commit -m "docs(attribution): SDK contract + e2e test scenarios

- New docs/sdk-source-attribution.md: header contract, canonical slugs,
  UA fallback patterns, privacy. SDK authors integrate from this.
- 订阅测试指南.md: 7 e2e scenarios covering header / UA / Other /
  third-party / illegal input / rollback / write-failure paths."
```

---

## Open issues to revisit during implementation

These are spec Open Questions deferred to implementation. Surface at execute time:

1. **Real UA strings** — Spec § Open Q #2. The UA regex in Task 3 (`/openclaw/i` etc.) is a wide net; before declaring the feature done, run a real OpenClaw / Hermes / Claude Code / Codex client and confirm they actually trigger the regex. Tighten the patterns if needed (e.g. `^OpenClaw/`).

2. **api_key_index coverage** — Spec § Open Q #3. Verify that ALL key creation paths (register, verify-code, OAuth, /v1/keys self-service) call `putApiKeyIndex`. Otherwise some users' attribution writes silently no-op (Task 4 Step 3 returns early when `getUserIdByKeyHash` returns null). Grep for `putApiKeyIndex` callers; cross-check against `createAndRevealToken` callers.

3. **30-day cleanup cron** — Spec § Open Q #4. Out of scope for this plan (called out in File Structure). Track as v1.x followup ticket: either a SQLite-side `DELETE FROM usage_attribution WHERE capturedAt < datetime('now', '-30 days')` triggered by a `/v1/admin/sweep` endpoint, OR a startup-time cleanup in `init()`.

---

## Self-review

**Spec coverage:**
- § 1 范围 ✅ (Tasks 1-7 cover chat-completions only; other endpoints untouched per File Structure)
- § 2 API 契约 + SDK 约定 ✅ (Task 3 implements parsing; Task 8 docs the contract)
- § 3 数据模型 ✅ (Task 1 DDL + indexes; Task 2 helpers — schema matches verbatim)
- § 4 chatProxy capture 流程 ✅ (Task 4)
- § 5 usageHandlers 端 join 流程 ✅ (Task 5, branched by Task 0 probe)
- § 6 前端展示 ✅ (Task 6 + 7 — note: Task 7 uses the explicit ternary fix from spec § 6 footnote)
- § 7 校验、错误处理、边界 ✅ (Task 3 validates; Task 4 try/catch + INSERT OR IGNORE; Task 5 falls back to 'other')
- § 8 测试策略 ✅ (Task 3 unit, Task 4 integration, Task 6 unit, Task 8 e2e guide)
- Probe ✅ (Task 0 — produces the data needed by Task 5 branch)

**Placeholder scan:** No "TBD/TODO/implement later" in step bodies. Task 5 has two implementation alternatives (3a / 3b) gated on Task 0 probe — that's a deliberate fork, not a placeholder. Open issues at the bottom are explicit followup work, not gaps.

**Type consistency:**
- `AttributionRecord` fields (`requestId`, `userId`, `source`, `sourceMethod`, `model`, `capturedAt`) used identically in Tasks 2, 4, 5.
- `SourceMethod` literal union (`'header' | 'ua' | 'fallback'`) consistent across Task 3 and Task 4.
- `ResolvedSource` shape (`{ slug, method }`) consistent in Task 3; consumed by Task 4.
- DB column names (`requestId`, `userId`, `source`, `sourceMethod`, `model`, `capturedAt`) consistent in Task 1 (DDL), Task 2 (queries), Task 4 (insert), Task 5 (join).
- Index name `idx_attribution_user_time` consistent; no explicit `idx_attribution_request_id` (PK carries implicit index).

No drift detected.
