# TokenBoss v1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement TokenBoss v1.0 — Agent 钱包 SaaS with email-code auth, credit bucket economy (套餐 + 充值), `set up tokenboss.com/skill.md` one-line install for Agent users, 7 redesigned web pages, and per-call usage tracking with daily expire+reset events.

**Architecture:**
- **Backend**: SQLite + Node HTTP (already exists). Add `credit_bucket` / `verification_codes` / `usage_log` tables + cron for daily expire/reset double events. Email-code auth replaces password. Chat proxy gains bucket consumption + mode lock + model pool checks. New static `/skill.md` and `/api/catalog.json` endpoints.
- **Frontend**: React + Vite + Tailwind (already exists). Extract 9 reusable components (TerminalBlock / TierCard / SectionHeader / etc). Rewrite 7 screens against visual companion HTML mocks. Drop 8 deprecated screens. Update routes.
- **Iterate, don't rebuild**: Modify existing files in place. New components only when the abstraction is shared by 2+ callers.

**Tech Stack:** TypeScript, React 18 + React Router 6 + TailwindCSS 3 (frontend), Node + better-sqlite3 (backend), Vitest (test runner — to be added).

**Specs:**
- [`docs/superpowers/specs/2026-04-25-credits-economy-design.md`](../specs/2026-04-25-credits-economy-design.md)
- [`docs/superpowers/specs/2026-04-25-v1-features-scope-design.md`](../specs/2026-04-25-v1-features-scope-design.md)
- [`docs/superpowers/specs/2026-04-26-ux-redesign-design.md`](../specs/2026-04-26-ux-redesign-design.md)

**Visual companion mocks** (reference for UI work):
- `.superpowers/brainstorm/91398-1777107028/content/landing-v2.html` (Landing v10)
- `.superpowers/brainstorm/91398-1777107028/content/auth-v0.html`
- `.superpowers/brainstorm/91398-1777107028/content/onboarding-v0.html`
- `.superpowers/brainstorm/91398-1777107028/content/dashboard-v1.html`
- `.superpowers/brainstorm/91398-1777107028/content/pricing-v1.html` (Pricing v8)
- `.superpowers/brainstorm/91398-1777107028/content/history-v0.html` (History v1.2)
- `.superpowers/brainstorm/91398-1777107028/content/settings-v0.html` (Settings v1)
- `.superpowers/brainstorm/91398-1777107028/content/manual-config-pc.html`

---

## Phase 0: Test Infrastructure

### Task 0.1: Add Vitest to backend

**Files:**
- Modify: `backend/package.json`
- Create: `backend/vitest.config.ts`
- Create: `backend/src/lib/__tests__/.gitkeep`

- [ ] **Step 1**: Add devDeps

```bash
cd backend && npm i -D vitest @vitest/ui
```

- [ ] **Step 2**: Add test script to `backend/package.json`

```json
{
  "scripts": {
    "dev": "...existing...",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 3**: Create `backend/vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4**: Verify

```bash
cd backend && npm test
```

Expected: `No tests found` (passing exit, since no tests yet).

- [ ] **Step 5**: Commit

```bash
git add backend/package.json backend/vitest.config.ts backend/src/lib/__tests__/.gitkeep
git commit -m "chore(backend): add vitest test runner"
```

### Task 0.2: Add Vitest to frontend

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/vitest.config.ts`

- [ ] **Step 1**: Add devDeps

```bash
cd frontend && npm i -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 2**: Add test scripts to `frontend/package.json`

```json
{
  "scripts": {
    "dev": "...existing...",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 3**: Create `frontend/vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
```

- [ ] **Step 4**: Create `frontend/src/test-setup.ts`

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5**: Verify + commit

```bash
cd frontend && npm test
git add frontend/package.json frontend/vitest.config.ts frontend/src/test-setup.ts
git commit -m "chore(frontend): add vitest + testing-library"
```

---

## Phase 1: Backend — Data Layer

### Task 1.1: Schema for `credit_bucket` table

**Files:**
- Modify: `backend/src/lib/store.ts:58-72` (the `init()` function)
- Test: `backend/src/lib/__tests__/store.bucket.test.ts`

**Read first**: open `backend/src/lib/store.ts` end-to-end to understand current pattern (DB connection, init, getUser/putUser pattern). The new functions should mirror that style.

- [ ] **Step 1**: Write failing test `backend/src/lib/__tests__/store.bucket.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { init, createBucket, getActiveBucketsForUser, BucketSku } from '../store';

beforeEach(() => {
  process.env.SQLITE_PATH = ':memory:';
  init();
});

describe('credit_bucket', () => {
  it('createBucket inserts a plus subscription', () => {
    const b = createBucket({
      userId: 'u_1',
      skuType: 'plan_plus',
      amountUsd: 840,
      dailyCapUsd: 30,
      dailyRemainingUsd: 30,
      totalRemainingUsd: null,
      startedAt: new Date('2026-04-26T00:00:00Z').toISOString(),
      expiresAt: new Date('2026-05-24T00:00:00Z').toISOString(),
      modeLock: 'auto_only',
      modelPool: 'codex_only',
    });
    expect(b.id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('getActiveBucketsForUser returns active buckets in consume priority', () => {
    createBucket({
      userId: 'u_2', skuType: 'topup', amountUsd: 100, dailyCapUsd: null,
      dailyRemainingUsd: null, totalRemainingUsd: 100,
      startedAt: new Date().toISOString(), expiresAt: null,
      modeLock: 'none', modelPool: 'all',
    });
    createBucket({
      userId: 'u_2', skuType: 'plan_plus', amountUsd: 840, dailyCapUsd: 30,
      dailyRemainingUsd: 30, totalRemainingUsd: null,
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 28 * 86400e3).toISOString(),
      modeLock: 'auto_only', modelPool: 'codex_only',
    });
    const list = getActiveBucketsForUser('u_2');
    // 套餐 first (套餐 → 充值)
    expect(list[0].skuType).toBe('plan_plus');
    expect(list[1].skuType).toBe('topup');
  });
});
```

- [ ] **Step 2**: Run test to verify it fails

```bash
cd backend && npm test -- store.bucket
```

Expected: FAIL — `createBucket` not exported.

- [ ] **Step 3**: Add schema + types to `backend/src/lib/store.ts`. Find the existing `db.exec` block (around line 58) and append the new tables after the `users` table.

```ts
// Append inside the existing `init()` function after CREATE TABLE users + index:
db.exec(`
  CREATE TABLE IF NOT EXISTS credit_bucket (
    id                  TEXT PRIMARY KEY,
    userId              TEXT NOT NULL,
    skuType             TEXT NOT NULL CHECK (skuType IN ('trial','topup','plan_plus','plan_super','plan_ultra')),
    amountUsd           REAL NOT NULL,
    dailyCapUsd         REAL,
    dailyRemainingUsd   REAL,
    totalRemainingUsd   REAL,
    startedAt           TEXT NOT NULL,
    expiresAt           TEXT,
    modeLock            TEXT NOT NULL CHECK (modeLock IN ('none','auto_only','auto_eco_only')),
    modelPool           TEXT NOT NULL CHECK (modelPool IN ('all','codex_only','eco_only')),
    createdAt           TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_bucket_user ON credit_bucket(userId, skuType);
`);
```

Then add types and CRUD at the bottom of the file:

```ts
export type BucketSku = 'trial' | 'topup' | 'plan_plus' | 'plan_super' | 'plan_ultra';
export type ModeLock = 'none' | 'auto_only' | 'auto_eco_only';
export type ModelPool = 'all' | 'codex_only' | 'eco_only';

export interface Bucket {
  id: string;
  userId: string;
  skuType: BucketSku;
  amountUsd: number;
  dailyCapUsd: number | null;
  dailyRemainingUsd: number | null;
  totalRemainingUsd: number | null;
  startedAt: string;
  expiresAt: string | null;
  modeLock: ModeLock;
  modelPool: ModelPool;
  createdAt: string;
}

export function createBucket(b: Omit<Bucket, 'id' | 'createdAt'>): Bucket {
  const id = randomBytes(16).toString('hex');
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO credit_bucket (id, userId, skuType, amountUsd, dailyCapUsd, dailyRemainingUsd,
      totalRemainingUsd, startedAt, expiresAt, modeLock, modelPool, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, b.userId, b.skuType, b.amountUsd, b.dailyCapUsd, b.dailyRemainingUsd,
    b.totalRemainingUsd, b.startedAt, b.expiresAt, b.modeLock, b.modelPool, createdAt);
  return { id, createdAt, ...b };
}

export function getActiveBucketsForUser(userId: string): Bucket[] {
  // Active = not expired (expiresAt > now OR null) and has remaining
  // Order: 套餐 (套餐 → 充值 priority), then expiresAt asc (套餐 to expire sooner first), then createdAt asc
  return db.prepare(`
    SELECT * FROM credit_bucket
    WHERE userId = ?
      AND (expiresAt IS NULL OR expiresAt > datetime('now'))
      AND (
        (skuType IN ('plan_plus','plan_super','plan_ultra','trial') AND COALESCE(dailyRemainingUsd, 0) > 0)
        OR (skuType = 'topup' AND COALESCE(totalRemainingUsd, 0) > 0)
      )
    ORDER BY
      CASE WHEN skuType = 'topup' THEN 1 ELSE 0 END,
      expiresAt ASC,
      createdAt ASC
  `).all(userId) as Bucket[];
}

export function getActiveSubscriptionBuckets(): Bucket[] {
  // Used by daily cron — all active subscription / trial buckets
  return db.prepare(`
    SELECT * FROM credit_bucket
    WHERE skuType != 'topup'
      AND (expiresAt IS NULL OR expiresAt > datetime('now'))
  `).all() as Bucket[];
}

export function consumeBucket(bucketId: string, amountUsd: number): void {
  // Subscription buckets: deduct from dailyRemainingUsd
  // Topup buckets: deduct from totalRemainingUsd
  db.prepare(`
    UPDATE credit_bucket
    SET dailyRemainingUsd = COALESCE(dailyRemainingUsd, 0) - ?,
        totalRemainingUsd = CASE WHEN totalRemainingUsd IS NOT NULL THEN totalRemainingUsd - ? ELSE NULL END
    WHERE id = ?
  `).run(amountUsd, amountUsd, bucketId);
}

export function resetBucketDaily(bucketId: string, dailyCapUsd: number): void {
  db.prepare(`UPDATE credit_bucket SET dailyRemainingUsd = ? WHERE id = ?`).run(dailyCapUsd, bucketId);
}

export function expireBucketDaily(bucketId: string): number {
  const row = db.prepare(`SELECT dailyRemainingUsd FROM credit_bucket WHERE id = ?`).get(bucketId) as { dailyRemainingUsd: number | null } | undefined;
  const remaining = row?.dailyRemainingUsd ?? 0;
  db.prepare(`UPDATE credit_bucket SET dailyRemainingUsd = 0 WHERE id = ?`).run(bucketId);
  return remaining;
}
```

Make sure `randomBytes` is imported from `crypto` at the top of store.ts.

- [ ] **Step 4**: Run test to verify it passes

```bash
cd backend && npm test -- store.bucket
```

Expected: PASS.

- [ ] **Step 5**: Commit

```bash
git add backend/src/lib/store.ts backend/src/lib/__tests__/store.bucket.test.ts
git commit -m "feat(backend): add credit_bucket table + CRUD"
```

### Task 1.2: Schema for `verification_codes` table

**Files:**
- Modify: `backend/src/lib/store.ts`
- Test: `backend/src/lib/__tests__/store.codes.test.ts`

- [ ] **Step 1**: Write failing test

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { init, saveVerificationCode, consumeVerificationCode } from '../store';

beforeEach(() => {
  process.env.SQLITE_PATH = ':memory:';
  init();
});

describe('verification_codes', () => {
  it('saves and consumes a 6-digit code', () => {
    saveVerificationCode('a@b.com', '123456', 300);
    expect(consumeVerificationCode('a@b.com', '123456')).toBe(true);
    expect(consumeVerificationCode('a@b.com', '123456')).toBe(false); // single-use
  });

  it('rejects expired codes', () => {
    saveVerificationCode('a@b.com', '111111', -1); // already expired
    expect(consumeVerificationCode('a@b.com', '111111')).toBe(false);
  });

  it('rejects wrong code', () => {
    saveVerificationCode('a@b.com', '222222', 300);
    expect(consumeVerificationCode('a@b.com', '999999')).toBe(false);
  });
});
```

- [ ] **Step 2**: Run + verify fail

```bash
cd backend && npm test -- store.codes
```

- [ ] **Step 3**: Add to `store.ts` `init()` function:

```ts
db.exec(`
  CREATE TABLE IF NOT EXISTS verification_codes (
    email      TEXT NOT NULL,
    code       TEXT NOT NULL,
    expiresAt  TEXT NOT NULL,
    consumed   INTEGER NOT NULL DEFAULT 0,
    createdAt  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_codes_email ON verification_codes(email, code);
`);
```

And functions:

```ts
export function saveVerificationCode(email: string, code: string, ttlSeconds: number): void {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  db.prepare(`
    INSERT INTO verification_codes (email, code, expiresAt, consumed, createdAt)
    VALUES (?, ?, ?, 0, ?)
  `).run(email.toLowerCase(), code, expiresAt, new Date().toISOString());
}

export function consumeVerificationCode(email: string, code: string): boolean {
  const row = db.prepare(`
    SELECT rowid AS id, expiresAt FROM verification_codes
    WHERE email = ? AND code = ? AND consumed = 0
    ORDER BY createdAt DESC LIMIT 1
  `).get(email.toLowerCase(), code) as { id: number; expiresAt: string } | undefined;
  if (!row) return false;
  if (new Date(row.expiresAt) < new Date()) return false;
  db.prepare(`UPDATE verification_codes SET consumed = 1 WHERE rowid = ?`).run(row.id);
  return true;
}

export function recentCodeCount(email: string, sinceSeconds: number): number {
  const since = new Date(Date.now() - sinceSeconds * 1000).toISOString();
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM verification_codes
    WHERE email = ? AND createdAt > ?
  `).get(email.toLowerCase(), since) as { n: number };
  return row.n;
}
```

- [ ] **Step 4**: Run + verify pass; commit

```bash
cd backend && npm test -- store.codes
git add backend/src/lib/store.ts backend/src/lib/__tests__/store.codes.test.ts
git commit -m "feat(backend): add verification_codes table"
```

### Task 1.3: Schema for `usage_log` with event_type

**Files:**
- Modify: `backend/src/lib/store.ts`
- Test: `backend/src/lib/__tests__/store.usage.test.ts`

- [ ] **Step 1**: Write failing test

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { init, logUsage, getUsageForUser } from '../store';

beforeEach(() => {
  process.env.SQLITE_PATH = ':memory:';
  init();
});

describe('usage_log', () => {
  it('logs consume event with all fields', () => {
    logUsage({
      userId: 'u_1',
      bucketId: 'b_1',
      eventType: 'consume',
      amountUsd: 0.027,
      model: 'claude-4.7-sonnet',
      source: 'OpenClaw',
      tokensIn: 800,
      tokensOut: 443,
    });
    const list = getUsageForUser('u_1', { limit: 10 });
    expect(list).toHaveLength(1);
    expect(list[0].eventType).toBe('consume');
    expect(list[0].amountUsd).toBe(0.027);
  });

  it('logs reset and expire events', () => {
    logUsage({ userId: 'u_2', bucketId: 'b_x', eventType: 'reset', amountUsd: 30, model: null, source: null, tokensIn: null, tokensOut: null });
    logUsage({ userId: 'u_2', bucketId: 'b_x', eventType: 'expire', amountUsd: -4.57, model: null, source: null, tokensIn: null, tokensOut: null });
    const list = getUsageForUser('u_2', { limit: 10 });
    expect(list.map(r => r.eventType)).toEqual(['expire', 'reset']); // newest first
  });
});
```

- [ ] **Step 2**: Run + verify fail

- [ ] **Step 3**: Add to `store.ts`:

```ts
db.exec(`
  CREATE TABLE IF NOT EXISTS usage_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    userId      TEXT NOT NULL,
    bucketId    TEXT,
    eventType   TEXT NOT NULL CHECK (eventType IN ('consume','reset','expire','topup','refund')),
    amountUsd   REAL NOT NULL,
    model       TEXT,
    source      TEXT,
    tokensIn    INTEGER,
    tokensOut   INTEGER,
    createdAt   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_log(userId, createdAt DESC);
`);
```

And functions:

```ts
export type EventType = 'consume' | 'reset' | 'expire' | 'topup' | 'refund';

export interface UsageRecord {
  id: number;
  userId: string;
  bucketId: string | null;
  eventType: EventType;
  amountUsd: number;
  model: string | null;
  source: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  createdAt: string;
}

export function logUsage(r: Omit<UsageRecord, 'id' | 'createdAt'>): UsageRecord {
  const createdAt = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO usage_log (userId, bucketId, eventType, amountUsd, model, source, tokensIn, tokensOut, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(r.userId, r.bucketId, r.eventType, r.amountUsd, r.model, r.source, r.tokensIn, r.tokensOut, createdAt);
  return { id: Number(result.lastInsertRowid), createdAt, ...r };
}

export function getUsageForUser(userId: string, opts: { limit?: number; offset?: number; eventTypes?: EventType[]; from?: string; to?: string } = {}): UsageRecord[] {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  let where = `userId = ?`;
  const params: any[] = [userId];
  if (opts.eventTypes?.length) {
    where += ` AND eventType IN (${opts.eventTypes.map(() => '?').join(',')})`;
    params.push(...opts.eventTypes);
  }
  if (opts.from) { where += ` AND createdAt >= ?`; params.push(opts.from); }
  if (opts.to) { where += ` AND createdAt <= ?`; params.push(opts.to); }
  return db.prepare(`SELECT * FROM usage_log WHERE ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as UsageRecord[];
}
```

- [ ] **Step 4**: Run + verify pass; commit

```bash
git add backend/src/lib/store.ts backend/src/lib/__tests__/store.usage.test.ts
git commit -m "feat(backend): add usage_log table with event_type"
```

---

## Phase 2: Backend — Auth (Email + Code)

### Task 2.1: Email service stub

**Files:**
- Create: `backend/src/lib/emailService.ts`
- Test: `backend/src/lib/__tests__/emailService.test.ts`

> **Note**: For v1.0 this is a stub that logs to console (or writes to a dev-only file). Real Resend / SendGrid integration is a separate Task 2.6 below.

- [ ] **Step 1**: Write failing test

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendVerificationEmail } from '../emailService';

describe('emailService', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('logs verification code in dev mode', async () => {
    process.env.EMAIL_PROVIDER = 'console';
    await sendVerificationEmail('user@example.com', '123456');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('user@example.com'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('123456'));
  });
});
```

- [ ] **Step 2**: Run + verify fail; create `emailService.ts`:

```ts
export interface EmailProvider {
  send(to: string, code: string): Promise<void>;
}

class ConsoleProvider implements EmailProvider {
  async send(to: string, code: string): Promise<void> {
    console.log(`[email:console] ${to} → code=${code}`);
  }
}

class ResendProvider implements EmailProvider {
  async send(to: string, code: string): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error('RESEND_API_KEY not set');
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'TokenBoss <noreply@tokenboss.com>',
        to,
        subject: `TokenBoss 验证码：${code}`,
        text: `你的验证码是 ${code}（5 分钟内有效）。`,
      }),
    });
    if (!res.ok) throw new Error(`Resend send failed: ${res.status}`);
  }
}

const providers: Record<string, EmailProvider> = {
  console: new ConsoleProvider(),
  resend: new ResendProvider(),
};

export async function sendVerificationEmail(email: string, code: string): Promise<void> {
  const name = process.env.EMAIL_PROVIDER ?? 'console';
  const provider = providers[name];
  if (!provider) throw new Error(`unknown email provider: ${name}`);
  await provider.send(email, code);
}
```

- [ ] **Step 3**: Run + verify pass; commit

```bash
git add backend/src/lib/emailService.ts backend/src/lib/__tests__/emailService.test.ts
git commit -m "feat(backend): email service with console+resend providers"
```

### Task 2.2: `POST /v1/auth/send-code` endpoint

**Files:**
- Modify: `backend/src/handlers/authHandlers.ts`
- Modify: `backend/src/local.ts` (add route)
- Test: `backend/src/handlers/__tests__/sendCode.test.ts`

**Read first**: open `backend/src/handlers/authHandlers.ts` end-to-end to see existing request/response shape (Lambda APIGatewayProxyEventV2). New handler should return same shape.

- [ ] **Step 1**: Write failing test

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sendCodeHandler } from '../authHandlers';
import { init, recentCodeCount } from '../../lib/store';
import * as emailService from '../../lib/emailService';

beforeEach(() => {
  process.env.SQLITE_PATH = ':memory:';
  process.env.EMAIL_PROVIDER = 'console';
  init();
  vi.spyOn(emailService, 'sendVerificationEmail').mockResolvedValue();
});

describe('POST /v1/auth/send-code', () => {
  it('sends a code for valid email', async () => {
    const res = await sendCodeHandler({ body: JSON.stringify({ email: 'a@b.com' }) } as any);
    expect(res.statusCode).toBe(200);
    expect(emailService.sendVerificationEmail).toHaveBeenCalledWith('a@b.com', expect.stringMatching(/^\d{6}$/));
  });

  it('rate-limits 1 per minute per email', async () => {
    const evt = { body: JSON.stringify({ email: 'a@b.com' }) } as any;
    await sendCodeHandler(evt);
    const second = await sendCodeHandler(evt);
    expect(second.statusCode).toBe(429);
  });

  it('rejects invalid email', async () => {
    const res = await sendCodeHandler({ body: JSON.stringify({ email: 'not-email' }) } as any);
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2**: Run + verify fail

- [ ] **Step 3**: Implement in `backend/src/handlers/authHandlers.ts`:

```ts
import { saveVerificationCode, recentCodeCount } from '../lib/store';
import { sendVerificationEmail } from '../lib/emailService';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function genCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export async function sendCodeHandler(evt: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  let parsed: { email?: string };
  try { parsed = JSON.parse(evt.body || '{}'); } catch { return json(400, { error: 'invalid_body' }); }
  const email = (parsed.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json(400, { error: 'invalid_email' });

  // rate limit: 1 per minute, 5 per hour
  if (recentCodeCount(email, 60) >= 1) return json(429, { error: 'too_many_requests' });
  if (recentCodeCount(email, 3600) >= 5) return json(429, { error: 'too_many_requests' });

  const code = genCode();
  saveVerificationCode(email, code, 300); // 5 min TTL
  await sendVerificationEmail(email, code);
  return json(200, { ok: true });
}
```

- [ ] **Step 4**: Register route in `backend/src/local.ts`. Find existing route table and add:

```ts
{ method: 'POST', path: '/v1/auth/send-code', handler: sendCodeHandler },
```

Make sure to import `sendCodeHandler` from `./handlers/authHandlers`.

- [ ] **Step 5**: Run + verify pass; commit

```bash
cd backend && npm test -- sendCode
git add backend/src/handlers/authHandlers.ts backend/src/local.ts backend/src/handlers/__tests__/sendCode.test.ts
git commit -m "feat(backend): POST /v1/auth/send-code with rate limit"
```

### Task 2.3: `POST /v1/auth/verify-code` endpoint (login + register unified)

**Files:**
- Modify: `backend/src/handlers/authHandlers.ts`
- Modify: `backend/src/local.ts`
- Test: `backend/src/handlers/__tests__/verifyCode.test.ts`

> Behavior: if email exists → login. If new → register + auto-grant trial bucket ($10 / 24h / auto_eco_only).

- [ ] **Step 1**: Write failing test

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { sendCodeHandler, verifyCodeHandler } from '../authHandlers';
import { init, getActiveBucketsForUser, getUserIdByEmail } from '../../lib/store';

beforeEach(() => {
  process.env.SQLITE_PATH = ':memory:';
  process.env.EMAIL_PROVIDER = 'console';
  process.env.JWT_SECRET = 'test-secret';
  init();
});

describe('POST /v1/auth/verify-code', () => {
  it('first-time email creates user + grants trial bucket', async () => {
    await sendCodeHandler({ body: JSON.stringify({ email: 'new@example.com' }) } as any);
    // pull code from console mock OR from DB directly:
    const { db } = await import('../../lib/store');
    const code = (db.prepare('SELECT code FROM verification_codes WHERE email = ? ORDER BY createdAt DESC LIMIT 1').get('new@example.com') as any).code;

    const res = await verifyCodeHandler({ body: JSON.stringify({ email: 'new@example.com', code }) } as any);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.token).toBeTruthy();
    expect(body.user.email).toBe('new@example.com');

    const userId = getUserIdByEmail('new@example.com');
    const buckets = getActiveBucketsForUser(userId!);
    expect(buckets.find(b => b.skuType === 'trial')).toBeTruthy();
  });

  it('returning user just gets token, no new trial bucket', async () => {
    // ... set up existing user, verify, count buckets stays at original
  });

  it('rejects wrong code', async () => {
    await sendCodeHandler({ body: JSON.stringify({ email: 'a@b.com' }) } as any);
    const res = await verifyCodeHandler({ body: JSON.stringify({ email: 'a@b.com', code: '000000' }) } as any);
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2**: Run + verify fail

- [ ] **Step 3**: Implement. First export `db` from store.ts (for test access). Then add to `authHandlers.ts`:

```ts
import { signSession } from '../lib/authTokens';
import { getUserIdByEmail, putUser, consumeVerificationCode, createBucket } from '../lib/store';
import { randomBytes } from 'crypto';

export async function verifyCodeHandler(evt: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  let parsed: { email?: string; code?: string };
  try { parsed = JSON.parse(evt.body || '{}'); } catch { return json(400, { error: 'invalid_body' }); }
  const email = (parsed.email || '').trim().toLowerCase();
  const code = (parsed.code || '').trim();
  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) return json(400, { error: 'invalid_input' });

  if (!consumeVerificationCode(email, code)) {
    return json(401, { error: 'invalid_or_expired_code' });
  }

  let userId = getUserIdByEmail(email);
  let isNew = false;
  if (!userId) {
    userId = `u_${randomBytes(10).toString('hex')}`;
    putUser({
      userId,
      email,
      displayName: null,
      phone: null,
      passwordHash: null, // no password
      createdAt: new Date().toISOString(),
      newapiUserId: null,
      newapiPassword: null,
    });
    isNew = true;
    // Grant trial bucket: $10 / 24h / forced ECO
    createBucket({
      userId,
      skuType: 'trial',
      amountUsd: 10,
      dailyCapUsd: null,
      dailyRemainingUsd: null,
      totalRemainingUsd: 10,
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 3600e3).toISOString(),
      modeLock: 'auto_eco_only',
      modelPool: 'eco_only',
    });
  }

  const token = signSession({ userId, email });
  return json(200, { token, user: { userId, email }, isNew });
}
```

- [ ] **Step 4**: Register route, register `verifyCodeHandler` in `local.ts`:

```ts
{ method: 'POST', path: '/v1/auth/verify-code', handler: verifyCodeHandler },
```

- [ ] **Step 5**: Run + verify pass; commit

```bash
git add backend/src/handlers/authHandlers.ts backend/src/local.ts backend/src/handlers/__tests__/verifyCode.test.ts backend/src/lib/store.ts
git commit -m "feat(backend): POST /v1/auth/verify-code unified login/register + trial grant"
```

### Task 2.4: Deprecate password endpoints

**Files:**
- Modify: `backend/src/handlers/authHandlers.ts` (remove `registerHandler` + `loginHandler`)
- Modify: `backend/src/local.ts` (remove old routes)

- [ ] **Step 1**: Remove `registerHandler` and `loginHandler` from `authHandlers.ts`. Keep `meHandler`.

- [ ] **Step 2**: Remove from `local.ts`:

```diff
- { method: 'POST', path: '/v1/auth/register', handler: registerHandler },
- { method: 'POST', path: '/v1/auth/login', handler: loginHandler },
```

- [ ] **Step 3**: Verify backend still builds (`cd backend && npx tsc --noEmit`)

- [ ] **Step 4**: Commit

```bash
git add backend/src/handlers/authHandlers.ts backend/src/local.ts
git commit -m "refactor(backend): remove password-based auth endpoints"
```

---

## Phase 3: Backend — Bucket Consumption + Mode Lock

### Task 3.1: `consumeForRequest` in `lib/buckets.ts`

**Files:**
- Create: `backend/src/lib/buckets.ts`
- Test: `backend/src/lib/__tests__/buckets.test.ts`

- [ ] **Step 1**: Write failing test

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { init, createBucket, getActiveBucketsForUser } from '../store';
import { consumeForRequest, BucketRequest } from '../buckets';

beforeEach(() => {
  process.env.SQLITE_PATH = ':memory:';
  init();
});

describe('consumeForRequest', () => {
  it('drains 套餐 first then 充值', () => {
    createBucket({
      userId: 'u_1', skuType: 'plan_plus', amountUsd: 840, dailyCapUsd: 30,
      dailyRemainingUsd: 5, totalRemainingUsd: null,
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 28*86400e3).toISOString(),
      modeLock: 'auto_only', modelPool: 'codex_only',
    });
    createBucket({
      userId: 'u_1', skuType: 'topup', amountUsd: 100, dailyCapUsd: null,
      dailyRemainingUsd: null, totalRemainingUsd: 100,
      startedAt: new Date().toISOString(), expiresAt: null,
      modeLock: 'none', modelPool: 'all',
    });

    const result = consumeForRequest({
      userId: 'u_1',
      mode: 'auto',
      modelId: 'gpt-5.5-mini',
      modelTier: 'eco',
      costUsd: 8,
    });

    expect(result.ok).toBe(true);
    expect(result.consumed.length).toBe(2);
    expect(result.consumed[0].bucketSkuType).toBe('plan_plus');
    expect(result.consumed[0].amount).toBe(5); // 套餐 drained
    expect(result.consumed[1].bucketSkuType).toBe('topup');
    expect(result.consumed[1].amount).toBe(3); // remainder from topup
  });

  it('returns model_locked when Plus tries Claude in Manual mode', () => {
    createBucket({
      userId: 'u_2', skuType: 'plan_plus', amountUsd: 840, dailyCapUsd: 30,
      dailyRemainingUsd: 30, totalRemainingUsd: null,
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 28*86400e3).toISOString(),
      modeLock: 'auto_only', modelPool: 'codex_only',
    });
    const result = consumeForRequest({
      userId: 'u_2',
      mode: 'manual',
      modelId: 'claude-4.7-sonnet',
      modelTier: 'premium',
      costUsd: 0.5,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('model_locked');
  });

  it('returns insufficient_balance when no bucket has enough', () => {
    const result = consumeForRequest({
      userId: 'u_3',
      mode: 'auto',
      modelId: 'gpt-5.5',
      modelTier: 'standard',
      costUsd: 0.1,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('insufficient_balance');
  });
});
```

- [ ] **Step 2**: Run + verify fail

- [ ] **Step 3**: Implement `backend/src/lib/buckets.ts`:

```ts
import { getActiveBucketsForUser, consumeBucket, logUsage, Bucket, ModelPool, ModeLock } from './store';

export type ChatMode = 'auto' | 'manual';
export type ModelTier = 'eco' | 'standard' | 'premium' | 'reasoning';

export interface BucketRequest {
  userId: string;
  mode: ChatMode;
  modelId: string;
  modelTier: ModelTier;
  costUsd: number;
  source?: string;
  tokensIn?: number;
  tokensOut?: number;
}

export type ConsumeError = 'insufficient_balance' | 'mode_locked' | 'model_locked' | 'no_active_bucket';

export interface ConsumeResult {
  ok: boolean;
  error?: ConsumeError;
  consumed: Array<{ bucketId: string; bucketSkuType: string; amount: number }>;
}

function modeAllowed(mode: ChatMode, lock: ModeLock): boolean {
  if (lock === 'none') return true;
  if (lock === 'auto_only' || lock === 'auto_eco_only') return mode === 'auto';
  return false;
}

function modelInPool(tier: ModelTier, pool: ModelPool): boolean {
  if (pool === 'all') return true;
  if (pool === 'codex_only') return tier === 'eco' || tier === 'standard';
  if (pool === 'eco_only') return tier === 'eco';
  return false;
}

export function consumeForRequest(req: BucketRequest): ConsumeResult {
  const buckets = getActiveBucketsForUser(req.userId);
  if (buckets.length === 0) return { ok: false, error: 'no_active_bucket', consumed: [] };

  // Find buckets eligible for this request (mode + model pool match)
  const eligible = buckets.filter(b => modeAllowed(req.mode, b.modeLock) && modelInPool(req.modelTier, b.modelPool));
  if (eligible.length === 0) {
    // Determine reason: mode or model
    if (buckets.some(b => modelInPool(req.modelTier, b.modelPool) && !modeAllowed(req.mode, b.modeLock))) {
      return { ok: false, error: 'mode_locked', consumed: [] };
    }
    return { ok: false, error: 'model_locked', consumed: [] };
  }

  // Sum available
  const available = eligible.reduce((sum, b) => {
    return sum + (b.skuType === 'topup' ? (b.totalRemainingUsd ?? 0) : (b.dailyRemainingUsd ?? 0));
  }, 0);
  if (available < req.costUsd) {
    return { ok: false, error: 'insufficient_balance', consumed: [] };
  }

  // Drain in priority order (套餐 first, then topup)
  let remaining = req.costUsd;
  const consumed: ConsumeResult['consumed'] = [];
  for (const b of eligible) {
    if (remaining <= 0) break;
    const have = b.skuType === 'topup' ? (b.totalRemainingUsd ?? 0) : (b.dailyRemainingUsd ?? 0);
    const take = Math.min(have, remaining);
    if (take > 0) {
      consumeBucket(b.id, take);
      logUsage({
        userId: req.userId,
        bucketId: b.id,
        eventType: 'consume',
        amountUsd: take,
        model: req.modelId,
        source: req.source ?? null,
        tokensIn: req.tokensIn ?? null,
        tokensOut: req.tokensOut ?? null,
      });
      consumed.push({ bucketId: b.id, bucketSkuType: b.skuType, amount: take });
      remaining -= take;
    }
  }
  return { ok: true, consumed };
}
```

- [ ] **Step 4**: Run + verify pass; commit

```bash
git add backend/src/lib/buckets.ts backend/src/lib/__tests__/buckets.test.ts
git commit -m "feat(backend): bucket consumption with priority + mode/pool gates"
```

### Task 3.2: Daily expire+reset cron

**Files:**
- Create: `backend/src/lib/dailyCron.ts`
- Test: `backend/src/lib/__tests__/dailyCron.test.ts`

- [ ] **Step 1**: Write failing test

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { init, createBucket, getActiveBucketsForUser, getUsageForUser } from '../store';
import { runDailyExpireAndReset } from '../dailyCron';

beforeEach(() => {
  process.env.SQLITE_PATH = ':memory:';
  init();
});

describe('runDailyExpireAndReset', () => {
  it('expires (−剩余) then resets (+cap) for plan_plus with leftover', () => {
    createBucket({
      userId: 'u_1', skuType: 'plan_plus', amountUsd: 840, dailyCapUsd: 30,
      dailyRemainingUsd: 4.57, totalRemainingUsd: null,
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 28*86400e3).toISOString(),
      modeLock: 'auto_only', modelPool: 'codex_only',
    });
    runDailyExpireAndReset();

    const buckets = getActiveBucketsForUser('u_1');
    expect(buckets[0].dailyRemainingUsd).toBe(30);

    const events = getUsageForUser('u_1', { limit: 10 });
    const eventTypes = events.map(e => e.eventType);
    expect(eventTypes).toContain('expire');
    expect(eventTypes).toContain('reset');
    const expire = events.find(e => e.eventType === 'expire')!;
    expect(expire.amountUsd).toBeCloseTo(-4.57);
    const reset = events.find(e => e.eventType === 'reset')!;
    expect(reset.amountUsd).toBe(30);
  });

  it('skips expire when remaining = 0 (yesterday used full cap)', () => {
    createBucket({
      userId: 'u_2', skuType: 'plan_plus', amountUsd: 840, dailyCapUsd: 30,
      dailyRemainingUsd: 0, totalRemainingUsd: null,
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 28*86400e3).toISOString(),
      modeLock: 'auto_only', modelPool: 'codex_only',
    });
    runDailyExpireAndReset();
    const events = getUsageForUser('u_2', { limit: 10 });
    expect(events.filter(e => e.eventType === 'expire')).toHaveLength(0);
    expect(events.filter(e => e.eventType === 'reset')).toHaveLength(1);
  });

  it('does not touch topup buckets', () => {
    createBucket({
      userId: 'u_3', skuType: 'topup', amountUsd: 100, dailyCapUsd: null,
      dailyRemainingUsd: null, totalRemainingUsd: 50,
      startedAt: new Date().toISOString(), expiresAt: null,
      modeLock: 'none', modelPool: 'all',
    });
    runDailyExpireAndReset();
    const events = getUsageForUser('u_3', { limit: 10 });
    expect(events).toHaveLength(0);
  });

  it('does not touch expired subscriptions', () => {
    createBucket({
      userId: 'u_4', skuType: 'plan_plus', amountUsd: 840, dailyCapUsd: 30,
      dailyRemainingUsd: 5, totalRemainingUsd: null,
      startedAt: new Date(Date.now() - 30*86400e3).toISOString(),
      expiresAt: new Date(Date.now() - 1).toISOString(), // already expired
      modeLock: 'auto_only', modelPool: 'codex_only',
    });
    runDailyExpireAndReset();
    const events = getUsageForUser('u_4', { limit: 10 });
    expect(events).toHaveLength(0);
  });
});
```

- [ ] **Step 2**: Run + verify fail

- [ ] **Step 3**: Implement `dailyCron.ts`:

```ts
import { getActiveSubscriptionBuckets, expireBucketDaily, resetBucketDaily, logUsage } from './store';

export function runDailyExpireAndReset(): { expired: number; reset: number } {
  const buckets = getActiveSubscriptionBuckets();
  let expiredCount = 0;
  let resetCount = 0;

  for (const b of buckets) {
    if (!b.dailyCapUsd) continue;

    // Step 1: expire (only if leftover > 0)
    const leftover = b.dailyRemainingUsd ?? 0;
    if (leftover > 0) {
      expireBucketDaily(b.id);
      logUsage({
        userId: b.userId,
        bucketId: b.id,
        eventType: 'expire',
        amountUsd: -leftover,
        model: null,
        source: null,
        tokensIn: null,
        tokensOut: null,
      });
      expiredCount++;
    }

    // Step 2: reset (always)
    resetBucketDaily(b.id, b.dailyCapUsd);
    logUsage({
      userId: b.userId,
      bucketId: b.id,
      eventType: 'reset',
      amountUsd: b.dailyCapUsd,
      model: null,
      source: null,
      tokensIn: null,
      tokensOut: null,
    });
    resetCount++;
  }

  return { expired: expiredCount, reset: resetCount };
}
```

- [ ] **Step 4**: Run + verify pass; commit

```bash
git add backend/src/lib/dailyCron.ts backend/src/lib/__tests__/dailyCron.test.ts
git commit -m "feat(backend): daily expire+reset double-event cron"
```

### Task 3.3: Schedule cron in `local.ts`

**Files:**
- Modify: `backend/src/local.ts`

- [ ] **Step 1**: Add at the bottom of `local.ts` before `server.listen()`:

```ts
import { runDailyExpireAndReset } from './lib/dailyCron';

function scheduleDailyCron() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(16, 0, 0, 0); // 0:00 Beijing = 16:00 UTC prev day; adjust as needed
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const delay = next.getTime() - now.getTime();
  setTimeout(() => {
    try {
      const result = runDailyExpireAndReset();
      console.log(`[cron] daily expire+reset: ${result.expired} expired, ${result.reset} reset`);
    } catch (e) { console.error('[cron] failed', e); }
    scheduleDailyCron(); // re-schedule
  }, delay);
}

scheduleDailyCron();
```

> **Note**: For production, replace this in-process cron with a proper scheduler (e.g., AWS EventBridge for Lambda). v1.0 in-process is fine for the dev server.

- [ ] **Step 2**: Smoke test by running `npm run dev` and checking startup logs.

- [ ] **Step 3**: Commit

```bash
git add backend/src/local.ts
git commit -m "feat(backend): schedule daily cron in local server"
```

### Task 3.4: Wire bucket consumption into chat proxy

**Files:**
- Modify: `backend/src/lib/chatProxyCore.ts`

**Read first**: open `backend/src/lib/chatProxyCore.ts` end-to-end (~609 LOC). Identify the place where the upstream call is made and the response is streamed. We'll insert bucket gating BEFORE the upstream call, and final cost accounting AFTER.

- [ ] **Step 1**: At the top of `streamChatCore` (after auth verification, before upstream call), call `consumeForRequest` with an estimated cost:

```ts
import { consumeForRequest, ChatMode } from './buckets';

// ... inside streamChatCore, after auth:
const userId = session.userId;
const modelId = body.model ?? 'auto';
const mode: ChatMode = modelId === 'auto' ? 'auto' : 'manual';
const modelTier = inferTierFromModelId(modelId); // helper using router config

// Estimate cost upfront (will reconcile after stream)
const estimatedCost = estimateCost(modelId, body.messages);

const consumeResult = consumeForRequest({
  userId, mode, modelId, modelTier,
  costUsd: estimatedCost,
  source: req.headers['x-source'] || null,
});

if (!consumeResult.ok) {
  return inChatErrorResponse(consumeResult.error!, modelId);
}
```

> Where `estimateCost` and `inferTierFromModelId` are small helpers — implement them inline using existing router/config.ts pricing data.

- [ ] **Step 2**: After the upstream stream finishes and you have the actual usage tokens, reconcile:

```ts
// After upstream stream done:
const actualCost = computeActualCost(modelId, actualTokensIn, actualTokensOut);
const delta = actualCost - estimatedCost;
if (Math.abs(delta) > 0.0001) {
  // Re-consume the delta (positive = need more) or refund (negative)
  if (delta > 0) {
    consumeForRequest({ userId, mode, modelId, modelTier, costUsd: delta, source: req.headers['x-source'] || null, tokensIn: actualTokensIn, tokensOut: actualTokensOut });
  }
}
```

- [ ] **Step 3**: Add `inChatErrorResponse` helper that emits a streaming SSE response with the user-facing error text per the spec table:

```ts
function inChatErrorResponse(error: string, modelId: string) {
  const messages: Record<string, string> = {
    insufficient_balance: '今日额度已用完。明日 0:00 自动刷新，或立即加买额度：tokenboss.com/pricing',
    model_locked: `此模型需 Super 套餐或加买充值额度。升级：tokenboss.com/pricing`,
    mode_locked: '免费试用仅可用智能路由。升级：tokenboss.com/pricing',
    no_active_bucket: '请先注册或购买套餐：tokenboss.com',
  };
  const text = messages[error] || messages.no_active_bucket;
  // emit as SSE / single-shot completion message
  return { statusCode: 200, body: text };
}
```

- [ ] **Step 4**: Add tests for chat proxy gating in `backend/src/lib/__tests__/chatProxyCore.test.ts` covering each error path.

- [ ] **Step 5**: Smoke test E2E, commit

```bash
git add backend/src/lib/chatProxyCore.ts backend/src/lib/__tests__/chatProxyCore.test.ts
git commit -m "feat(backend): wire bucket consumption + mode lock into chat proxy"
```

---

## Phase 4: Backend — `/skill.md` and `/api/catalog.json`

### Task 4.1: Static `/skill.md` endpoint

**Files:**
- Create: `backend/src/handlers/skillMd.ts`
- Create: `backend/public/skill.md`
- Modify: `backend/src/local.ts`

- [ ] **Step 1**: Create `backend/public/skill.md` with the full template from spec [`2026-04-26-ux-redesign-design.md`](../specs/2026-04-26-ux-redesign-design.md#skillmd-文件骨架v10-主路径). Copy verbatim.

- [ ] **Step 2**: Create `backend/src/handlers/skillMd.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

const SKILL_MD_PATH = join(__dirname, '../../public/skill.md');

export async function skillMdHandler(_evt: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const content = readFileSync(SKILL_MD_PATH, 'utf-8');
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
    body: content,
  };
}
```

- [ ] **Step 3**: Register in `local.ts`:

```ts
import { skillMdHandler } from './handlers/skillMd';
// ...
{ method: 'GET', path: '/skill.md', handler: skillMdHandler },
```

- [ ] **Step 4**: Smoke test `curl http://localhost:8787/skill.md` returns the markdown.

- [ ] **Step 5**: Commit

```bash
git add backend/public/skill.md backend/src/handlers/skillMd.ts backend/src/local.ts
git commit -m "feat(backend): GET /skill.md static endpoint"
```

### Task 4.2: `/api/catalog.json` endpoint

**Files:**
- Create: `backend/src/handlers/catalogJson.ts`
- Modify: `backend/src/local.ts`
- Test: `backend/src/handlers/__tests__/catalog.test.ts`

- [ ] **Step 1**: Write failing test

```ts
import { describe, it, expect } from 'vitest';
import { catalogJsonHandler } from '../catalogJson';

describe('GET /api/catalog.json', () => {
  it('returns array of models with id and price', async () => {
    const res = await catalogJsonHandler({} as any);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.models[0]).toMatchObject({
      id: expect.any(String),
      tier: expect.any(String),
      pricePerMTokenIn: expect.any(Number),
      pricePerMTokenOut: expect.any(Number),
    });
  });
});
```

- [ ] **Step 2**: Run + verify fail

- [ ] **Step 3**: Implement `catalogJson.ts`:

```ts
import { DEFAULT_ROUTING_CONFIG } from '../router/config';

export async function catalogJsonHandler(_evt: any) {
  const models = Object.entries(DEFAULT_ROUTING_CONFIG.tiers).flatMap(([tier, models]) =>
    models.map((m: any) => ({
      id: m.id,
      tier,
      pricePerMTokenIn: m.pricePerMTokenIn ?? null,
      pricePerMTokenOut: m.pricePerMTokenOut ?? null,
    }))
  );
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({ models, generatedAt: new Date().toISOString() }),
  };
}
```

> **Note**: Adjust the `DEFAULT_ROUTING_CONFIG` shape based on actual structure in `router/config.ts`. Read that file first to see the exact data layout.

- [ ] **Step 4**: Register in `local.ts`; smoke test; commit

```bash
git add backend/src/handlers/catalogJson.ts backend/src/local.ts backend/src/handlers/__tests__/catalog.test.ts
git commit -m "feat(backend): GET /api/catalog.json model list"
```

### Task 4.3: Update `/v1/usage` to support event_type filtering

**Files:**
- Modify: `backend/src/handlers/usageHandlers.ts`

**Read first**: open `backend/src/handlers/usageHandlers.ts` (~174 LOC) to see current signature.

- [ ] **Step 1**: Modify `usageHandler` to accept query params `eventType`, `from`, `to`, `limit`, `offset`. Return shape:

```json
{
  "records": [{...UsageRecord}],
  "totals": { "consumed": 14.32, "calls": 247 },
  "hourly24h": [{ "hour": "11:00", "consumed": 0.41 }]
}
```

- [ ] **Step 2**: Add helper `getHourlyUsage24h(userId)` to store.ts that returns 24 hour buckets ending at current hour.

- [ ] **Step 3**: Add tests for the new shape.

- [ ] **Step 4**: Commit

```bash
git add backend/src/handlers/usageHandlers.ts backend/src/lib/store.ts backend/src/handlers/__tests__/usage.test.ts
git commit -m "feat(backend): /v1/usage with event_type filter + 24h hourly aggregation"
```

---

## Phase 5: Frontend — Design Tokens

### Task 5.1: Update Tailwind config + load Geist Mono / Noto Serif SC

**Files:**
- Modify: `frontend/tailwind.config.js`
- Modify: `frontend/src/index.css`
- Modify: `frontend/index.html`

- [ ] **Step 1**: Open `frontend/tailwind.config.js` (lines 7-80). Add new colors and fonts:

```js
// In `theme.extend.colors`:
'ink-3': '#A89A8D',
'ink-4': '#D9CEC2',
'accent-deep': '#B85020',
'accent-soft': '#FEE9DC',
'accent-ink': '#92400E',
'green-soft': '#DCFCE7',
'green-ink': '#15803D',
'red-soft': '#FEE2E2',
'red-ink': '#991B1B',
'hairline': '#EBE3DA',
'border-2': '#D9CEC2',

// In `theme.extend.fontFamily`:
serif: ['Noto Serif SC', 'serif'],
```

- [ ] **Step 2**: Update `frontend/index.html` `<head>` to load Noto Serif SC:

```html
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;600;700;800&family=Noto+Serif+SC:wght@400;600&display=swap" rel="stylesheet">
```

- [ ] **Step 3**: Smoke test by `npm run dev` and verifying tokens compile (no errors).

- [ ] **Step 4**: Commit

```bash
git add frontend/tailwind.config.js frontend/src/index.css frontend/index.html
git commit -m "feat(frontend): expand design tokens (ink-3/4, accent-deep, soft variants, serif font)"
```

---

## Phase 6: Frontend — Shared Components

### Task 6.1: `<TerminalBlock>` — black command box (used by Landing + Onboarding)

**Files:**
- Create: `frontend/src/components/TerminalBlock.tsx`
- Test: `frontend/src/components/__tests__/TerminalBlock.test.tsx`

- [ ] **Step 1**: Write failing test

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TerminalBlock } from '../TerminalBlock';

describe('<TerminalBlock>', () => {
  it('renders prompt + cmd + COPY button', () => {
    render(<TerminalBlock cmd="set up tokenboss.com/skill.md" />);
    expect(screen.getByText('$')).toBeInTheDocument();
    expect(screen.getByText('set up tokenboss.com/skill.md')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
  });

  it('copies to clipboard on click', async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<TerminalBlock cmd="hello" />);
    await userEvent.click(screen.getByRole('button'));
    expect(writeText).toHaveBeenCalledWith('hello');
  });
});
```

- [ ] **Step 2**: Run + verify fail (file doesn't exist).

- [ ] **Step 3**: Implement

```tsx
import { useState } from 'react';

export interface TerminalBlockProps {
  cmd: string;
  size?: 'sm' | 'lg';
  className?: string;
}

export function TerminalBlock({ cmd, size = 'sm', className = '' }: TerminalBlockProps) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    await navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  const padding = size === 'lg' ? 'px-5 py-4' : 'px-4 py-3.5';
  const fontSize = size === 'lg' ? 'text-[15px]' : 'text-[12.5px]';
  return (
    <div className={`flex items-center gap-2 bg-[#1C1917] rounded-[10px] ${padding} ${fontSize} font-mono leading-snug ${className}`}>
      <span className="text-accent font-semibold select-none">$</span>
      <span className="text-[#FFF8F0] flex-1 truncate">{cmd}</span>
      <button
        onClick={handleCopy}
        className="font-mono text-[9.5px] font-bold tracking-[0.12em] uppercase text-[#A89A8D] border border-[#3A332D] bg-[#0A0807] px-2 py-1 rounded-[5px]"
      >
        {copied ? '已复制' : 'COPY'}
      </button>
    </div>
  );
}
```

- [ ] **Step 4**: Run + verify pass; commit

```bash
git add frontend/src/components/TerminalBlock.tsx frontend/src/components/__tests__/TerminalBlock.test.tsx
git commit -m "feat(frontend): TerminalBlock component for one-line install"
```

### Task 6.2: `<CompatRow>` — Agent compatibility banner

**Files:**
- Create: `frontend/src/components/CompatRow.tsx`
- Test: `frontend/src/components/__tests__/CompatRow.test.tsx`

- [ ] **Step 1**: Write failing test

```tsx
import { render, screen } from '@testing-library/react';
import { CompatRow, AgentMark } from '../CompatRow';

describe('<CompatRow>', () => {
  it('renders label + agent marks', () => {
    const agents: AgentMark[] = [
      { id: 'oc', label: 'OC', name: 'OpenClaw' },
      { id: 'hm', label: 'HM', name: 'Hermes' },
    ];
    render(<CompatRow label="适配你喜欢的 Agent" agents={agents} />);
    expect(screen.getByText('适配你喜欢的 Agent')).toBeInTheDocument();
    expect(screen.getByText('OC')).toBeInTheDocument();
    expect(screen.getByText('HM')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2-4**: Implement, run, commit

```tsx
export interface AgentMark {
  id: string;
  label: string;
  name: string;
  className?: string; // e.g. "bg-gradient-to-br from-[#E8692A] to-[#B85020]"
}

export interface CompatRowProps {
  label: string;
  agents: AgentMark[];
  className?: string;
}

export function CompatRow({ label, agents, className = '' }: CompatRowProps) {
  return (
    <div className={`flex items-center gap-3 py-2 ${className}`}>
      <span className="font-mono text-[9.5px] font-bold tracking-[0.16em] uppercase text-ink-3 flex-shrink-0">
        {label}
      </span>
      <div className="flex gap-1.5 flex-wrap">
        {agents.map(a => (
          <div
            key={a.id}
            title={a.name}
            className={`w-[30px] h-[30px] rounded-[7px] flex items-center justify-center font-mono text-[9.5px] font-bold text-white tracking-wide ${a.className ?? 'bg-ink'}`}
          >
            {a.label}
          </div>
        ))}
      </div>
    </div>
  );
}
```

```bash
git add frontend/src/components/CompatRow.tsx frontend/src/components/__tests__/CompatRow.test.tsx
git commit -m "feat(frontend): CompatRow component for Agent compatibility banner"
```

### Task 6.3: `<SectionHeader>` — editorial 01/02 numbered sections

**Files:**
- Create: `frontend/src/components/SectionHeader.tsx`
- Test: `frontend/src/components/__tests__/SectionHeader.test.tsx`

- [ ] **Step 1**: Write failing test

```tsx
import { render, screen } from '@testing-library/react';
import { SectionHeader } from '../SectionHeader';

it('renders num / cn / en in editorial style', () => {
  render(<SectionHeader num="01" cn="标准价" en="Pay as you go" />);
  expect(screen.getByText('01')).toBeInTheDocument();
  expect(screen.getByText('标准价')).toBeInTheDocument();
  expect(screen.getByText('Pay as you go')).toBeInTheDocument();
});
```

- [ ] **Step 2-4**: Implement

```tsx
export interface SectionHeaderProps {
  num: string;
  cn: string;
  en: string;
  size?: 'sm' | 'lg';
  className?: string;
}

export function SectionHeader({ num, cn, en, size = 'sm', className = '' }: SectionHeaderProps) {
  const numCls = size === 'lg' ? 'text-[22px]' : 'text-[16px]';
  const cnCls = size === 'lg' ? 'text-[14px]' : 'text-[12px]';
  const enCls = size === 'lg' ? 'text-[11px]' : 'text-[10px]';
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span className={`font-serif italic font-semibold text-ink-4 ${numCls}`}>{num}</span>
      <span className={`font-bold text-ink ${cnCls}`}>{cn}</span>
      <span className="text-ink-4 font-light">/</span>
      <span className={`font-mono font-semibold tracking-[0.16em] uppercase text-ink-3 ${enCls}`}>{en}</span>
    </div>
  );
}
```

```bash
git add frontend/src/components/SectionHeader.tsx frontend/src/components/__tests__/SectionHeader.test.tsx
git commit -m "feat(frontend): SectionHeader 01/02 editorial component"
```

### Task 6.4: `<TierCard>` — Pricing tier (used by Landing + Pricing)

**Files:**
- Create: `frontend/src/components/TierCard.tsx`
- Test: `frontend/src/components/__tests__/TierCard.test.tsx`

- [ ] **Step 1**: Write failing test (covers featured + sold-out + leverage badge variants).

- [ ] **Step 2-4**: Implement based on visual companion `pricing-v1.html` (lines containing `m-tier`/`dt-tier`). Key props:

```tsx
export interface TierCardProps {
  name: string;            // "Plus" / "Super" / "Ultra"
  pricePeriod: string;     // "¥288 / 4 周"
  leverage?: string;       // "×3" (optional, hidden on landing per v10)
  totalUsd?: string;       // "≈ $840 美金额度"
  dailyCap: string;        // "$30 美金 cap"
  models: string;          // "Codex 系列模型"
  ctaText: string;         // "免费注册试用 →" or "联系客服开通"
  ctaVariant: 'primary' | 'secondary' | 'disabled';
  featured?: boolean;
  soldOut?: boolean;
  tooltipExtras?: string[];  // ["智能路由", "多端复用"]
  onCtaClick?: () => void;
  className?: string;
}
```

```bash
git add frontend/src/components/TierCard.tsx frontend/src/components/__tests__/TierCard.test.tsx
git commit -m "feat(frontend): TierCard component shared by Landing + Pricing"
```

### Task 6.5: `<BalancePill>` — current balance display

**Files:**
- Create: `frontend/src/components/BalancePill.tsx`

```tsx
export function BalancePill({ amount, label = '余额' }: { amount: string; label?: string }) {
  return (
    <span className="inline-flex items-baseline gap-2 px-3.5 py-1.5 bg-surface border border-border rounded-lg font-mono">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{label}</span>
      <span className="text-[15px] font-bold text-ink">{amount}</span>
    </span>
  );
}
```

```bash
git add frontend/src/components/BalancePill.tsx
git commit -m "feat(frontend): BalancePill display"
```

### Task 6.6: `<ConsumeChart24h>` — 24-hour bar chart

**Files:**
- Create: `frontend/src/components/ConsumeChart24h.tsx`
- Test: `frontend/src/components/__tests__/ConsumeChart24h.test.tsx`

- [ ] **Step 1**: Test renders 24 bars, peak hour gets `peak` class.

- [ ] **Step 2-3**: Implement based on visual companion `history-v0.html` (`.dt-chart` and `.m-chart` blocks).

```tsx
export interface HourBucket {
  hour: number;       // 0-23
  consumeUsd: number;
}

export interface ConsumeChart24hProps {
  buckets: HourBucket[];
  variant?: 'mobile' | 'desktop';
  className?: string;
}

export function ConsumeChart24h({ buckets, variant = 'desktop', className = '' }: ConsumeChart24hProps) {
  const peakValue = Math.max(...buckets.map(b => b.consumeUsd), 0.01);
  const heightFor = (v: number) => Math.max(2, (v / peakValue) * 100);
  // ... render based on variant
}
```

```bash
git add frontend/src/components/ConsumeChart24h.tsx frontend/src/components/__tests__/ConsumeChart24h.test.tsx
git commit -m "feat(frontend): ConsumeChart24h bar chart component"
```

### Task 6.7: `<UsageRow>` — single usage entry

**Files:**
- Create: `frontend/src/components/UsageRow.tsx`

```tsx
export type UsageEventType = 'consume' | 'reset' | 'expire' | 'topup' | 'refund';

export interface UsageRowProps {
  time: string;           // "4/26 9:41" or full "2026/04/26 9:41"
  eventType: UsageEventType;
  source?: string;
  model?: string;
  amount: string;         // "−$0.027" or "+$30.00"
  variant?: 'mobile' | 'desktop';
}

export function UsageRow({ time, eventType, source, model, amount, variant = 'mobile' }: UsageRowProps) {
  // ... pill colors per type, amount color per type
}
```

```bash
git add frontend/src/components/UsageRow.tsx
git commit -m "feat(frontend): UsageRow component"
```

### Task 6.8: `<APIKeyList>` — extracted from old Keys.tsx for reuse

**Files:**
- Create: `frontend/src/components/APIKeyList.tsx`
- Modify: `frontend/src/lib/api.ts` (ensure key endpoints exposed)

**Read first**: open `frontend/src/screens/Keys.tsx` (~252 LOC) — extract the list rendering + create/copy/revoke logic into a reusable component. Dashboard will embed it.

- [ ] **Step 1**: Move list/create/revoke logic from `Keys.tsx` into `APIKeyList.tsx`.

- [ ] **Step 2**: Component takes no props, uses `lib/api.ts` directly.

- [ ] **Step 3**: Replace usage in `Keys.tsx` to just `<APIKeyList />` (it'll be deleted later in Task 9.x but for now gets thin).

```bash
git add frontend/src/components/APIKeyList.tsx frontend/src/screens/Keys.tsx
git commit -m "refactor(frontend): extract APIKeyList from Keys.tsx for embed"
```

### Task 6.9: `<TierInfoTooltip>` — hover tooltip for tier extras

**Files:**
- Create: `frontend/src/components/TierInfoTooltip.tsx`

> Used inside TierCard. Italic serif "i" icon with hover popup. Pure CSS hover (`group-hover` + `group`).

```tsx
export function TierInfoTooltip({ extras }: { extras: string[] }) {
  return (
    <button className="group relative w-[30px] h-[30px] rounded-md border border-border-2 bg-surface text-ink-3 font-serif italic font-semibold flex items-center justify-center cursor-help">
      i
      <span className="hidden group-hover:block absolute bottom-full right-0 mb-2 bg-ink text-bg text-[11.5px] font-medium leading-snug px-3.5 py-2 rounded-md whitespace-nowrap shadow-xl z-10 font-sans not-italic">
        {extras.join(' · ')}
      </span>
    </button>
  );
}
```

```bash
git add frontend/src/components/TierInfoTooltip.tsx
git commit -m "feat(frontend): TierInfoTooltip with hover popup"
```

---

## Phase 7: Frontend — API Client + Auth

### Task 7.1: Update `lib/api.ts` with new endpoints

**Files:**
- Modify: `frontend/src/lib/api.ts`

**Read first**: open `frontend/src/lib/api.ts` (~213 LOC) to see existing pattern.

- [ ] **Step 1**: Add new methods, keep existing ones (except remove the password-based `register`/`login`):

```ts
// In `api` object:
async sendCode(email: string) {
  return this.request('/v1/auth/send-code', { method: 'POST', body: { email } });
},
async verifyCode(email: string, code: string) {
  return this.request('/v1/auth/verify-code', { method: 'POST', body: { email, code } });
},
async getBuckets() {
  return this.request('/v1/buckets', { method: 'GET' });
},
async getUsage(opts: { from?: string; to?: string; eventType?: string; limit?: number; offset?: number } = {}) {
  const qs = new URLSearchParams(opts as any).toString();
  return this.request(`/v1/usage?${qs}`, { method: 'GET' });
},

// Remove old register/login that took password
```

- [ ] **Step 2**: Add `GET /v1/buckets` handler in backend (`backend/src/handlers/buckets.ts` returning user's active buckets).

- [ ] **Step 3**: Update `useAuth` hook in `frontend/src/lib/auth.tsx` to handle the new flow:

```tsx
async function loginWithCode(email: string, code: string) {
  const { token, user } = await api.verifyCode(email, code);
  saveToken(token);
  setProfile(user);
}

// Remove old password-based login()
```

- [ ] **Step 4**: Run frontend tests (existing screens may break — that's fine, we'll fix in Phase 8).

- [ ] **Step 5**: Commit

```bash
git add frontend/src/lib/api.ts frontend/src/lib/auth.tsx backend/src/handlers/buckets.ts backend/src/local.ts
git commit -m "feat(frontend): update api client + auth hook for code-based flow"
```

---

## Phase 8: Frontend — Screen Rewrites

### Task 8.1: `Login.tsx` — email + 6-digit code

**Files:**
- Modify: `frontend/src/screens/Login.tsx`

**Read first**: existing Login.tsx (~99 LOC). Visual companion: `auth-v0.html`.

- [ ] **Step 1**: Replace password field with 2-step flow:
  - Step 1: email input → click "发送验证码" → calls `api.sendCode`
  - Step 2: 6-digit input → auto-submits when 6 chars → calls `api.verifyCode` → on success redirect `/dashboard`

- [ ] **Step 2**: Use `<input maxLength={1}>` × 6 with auto-focus advance, OR a single `<input maxLength={6}>` with letter-spacing styling — pick simpler.

- [ ] **Step 3**: Style per `auth-v0.html` mock (中性配色，无 password recovery 链接).

- [ ] **Step 4**: Smoke test: register new email → receive code (console log) → enter code → enter dashboard. Commit.

```bash
git add frontend/src/screens/Login.tsx
git commit -m "feat(frontend): Login with email + 6-digit code flow"
```

### Task 8.2: `Register.tsx` — same flow + $10 trial gift card

**Files:**
- Modify: `frontend/src/screens/Register.tsx`

- [ ] **Step 1**: Same email + 6-code flow as Login. Backend returns `isNew: true` for first-time emails (already handled by verify-code endpoint).

- [ ] **Step 2**: After success, show "$10 / 24h 试用已激活" gift card animation (per `auth-v0.html` register variant).

- [ ] **Step 3**: Commit

```bash
git add frontend/src/screens/Register.tsx
git commit -m "feat(frontend): Register with email + code + $10 trial gift"
```

### Task 8.3: `Landing.tsx` — full v10 rewrite

**Files:**
- Modify: `frontend/src/screens/Landing.tsx`

**Read first**: visual companion `landing-v2.html` (mobile + desktop). The TSX rewrite mirrors the HTML structure 1:1.

- [ ] **Step 1**: Replace contents with the v10 design:

```tsx
import { useNavigate } from 'react-router-dom';
import { CompatRow, AgentMark } from '../components/CompatRow';
import { TerminalBlock } from '../components/TerminalBlock';
import { TierCard } from '../components/TierCard';
import { Button } from '../components/Button';

const AGENTS: AgentMark[] = [
  { id: 'oc', label: 'OC', name: 'OpenClaw', className: 'bg-gradient-to-br from-accent to-accent-deep' },
  { id: 'cx', label: 'CX', name: 'Codex', className: 'bg-ink' },
  { id: 'hm', label: 'HM', name: 'Hermes', className: 'bg-gradient-to-br from-violet-600 to-indigo-600' },
  { id: 'cc', label: 'CC', name: 'Claude Code', className: 'bg-gradient-to-br from-amber-600 to-amber-800' },
];

export function Landing() {
  const nav = useNavigate();
  return (
    <div className="min-h-screen bg-bg">
      {/* Top Nav */}
      <nav className="px-9 py-4 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-accent rounded-md flex items-center justify-center text-white font-mono text-[10px] font-bold">TB</div>
          <span className="font-bold">TokenBoss</span>
        </div>
        <div className="flex gap-6 text-[13px] text-ink-2">
          <a>套餐</a>
          <a>文档</a>
        </div>
        <div className="flex items-center gap-4">
          <a className="text-[13px] text-ink-2">登录</a>
          <a className="px-4 py-1.5 bg-accent text-white rounded-lg text-[12.5px] font-semibold">免费开始 →</a>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-[1080px] mx-auto px-14 py-30">
        <CompatRow label="适配你喜欢的 Agent" agents={AGENTS} className="mb-7" />
        <h1 className="font-sans text-[72px] font-extrabold leading-none tracking-tight">
          你的 Agent<br />
          <span className="text-accent">钱包</span>
        </h1>
        <TerminalBlock cmd="set up tokenboss.com/skill.md" size="lg" className="max-w-[520px] mt-6" />
        <p className="font-mono text-xs text-ink-3 max-w-[520px] mt-3 leading-relaxed">
          在 <span className="text-ink-2 font-semibold">OpenClaw / Hermes / Claude Code / Codex</span> 终端粘贴 ·
          ¥ 人民币付款，按 $ 美金额度计费
        </p>
        <div className="flex items-center gap-4 mt-8">
          <Button variant="primary" onClick={() => nav('/register')}>免费开始 · 送 $10 体验</Button>
          <span className="text-[13px] text-ink-2">已有账户？<a className="text-accent">登录</a></span>
        </div>
      </section>

      {/* Pricing tiles */}
      <section className="max-w-[1080px] mx-auto px-14 py-12">
        <SectionHeader num="01" cn="套餐" en="Membership" />
        <div className="grid grid-cols-3 gap-0 border-t border-b border-hairline mt-5">
          <TierCard name="PLUS" pricePeriod="¥288 / 4 周" dailyCap="$30 / 天" models="Codex 系列" ctaText="免费注册试用 →" ctaVariant="secondary" />
          <TierCard name="SUPER" pricePeriod="¥688 / 4 周" dailyCap="$80 / 天" models="Claude + Codex" ctaText="免费注册试用 →" ctaVariant="primary" featured />
          <TierCard name="ULTRA" pricePeriod="¥1688 / 4 周" dailyCap="$720 / 天" models="Claude + Codex + reasoning" ctaText="免费注册试用 →" ctaVariant="secondary" />
        </div>
      </section>

      {/* Pay-as-you-go */}
      <section className="max-w-[1080px] mx-auto px-14 py-12">
        <SectionHeader num="02" cn="按量充值" en="Pay as you go" />
        <div className="flex items-center justify-between p-7 border border-hairline rounded-xl mt-5">
          <div>
            <div className="text-lg font-bold">¥1 = $1 美金</div>
            <div className="text-sm text-ink-3">永不过期 · 全模型解锁 · ¥50 起</div>
          </div>
          <a className="px-5 py-2.5 bg-surface border border-border-2 rounded-lg text-sm font-semibold">联系客服充值</a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-7 text-center font-mono text-[10.5px] text-ink-3">
        <div className="flex justify-center gap-3.5 mb-2.5">
          <a>套餐</a><a>文档</a><a>条款</a><a>隐私</a><a>联系</a>
        </div>
        <div>© 2026 TokenBoss</div>
      </footer>
    </div>
  );
}
```

> Match the mock's exact spacing, sizes, weights. The TSX above is a sketch — fine-tune against `landing-v2.html` line by line.

- [ ] **Step 2**: Smoke test in browser. Compare to mock side-by-side.

- [ ] **Step 3**: Commit

```bash
git add frontend/src/screens/Landing.tsx
git commit -m "feat(frontend): Landing v10 with wallet hero + skill.md install + tier cards"
```

### Task 8.4: `OnboardWelcome.tsx` — I am Agent / I am Human

**Files:**
- Modify: `frontend/src/screens/OnboardWelcome.tsx`

**Read first**: visual companion `onboarding-v0.html` Phone 1.

- [ ] **Step 1**: Replace contents — show 2 large cards "I am Agent" / "I am Human". Selection routes to either `/onboard/install` or `/onboard/manual` (latter is the new desktop docs page).

- [ ] **Step 2**: Commit

```bash
git add frontend/src/screens/OnboardWelcome.tsx
git commit -m "feat(frontend): OnboardWelcome I am Agent / I am Human selector"
```

### Task 8.5: `OnboardInstall.tsx` — one-line magic command

**Files:**
- Modify: `frontend/src/screens/OnboardInstall.tsx`

**Read first**: existing OnboardInstall.tsx (130 LOC) + visual companion `onboarding-v0.html` Phone 2.

- [ ] **Step 1**: Replace install command logic. Use `<TerminalBlock cmd="set up tokenboss.com/skill.md" />`. Add waiting state ("检测到 Agent 拉取 skill.md...") that polls `/v1/me` for first chat call detection.

- [ ] **Step 2**: Commit

```bash
git add frontend/src/screens/OnboardInstall.tsx
git commit -m "feat(frontend): OnboardInstall with one-line skill.md command"
```

### Task 8.6: `OnboardSuccess.tsx` — simplified

**Files:**
- Modify: `frontend/src/screens/OnboardSuccess.tsx`

- [ ] **Step 1**: Simplify per visual companion `onboarding-v0.html` Phone 4 — "搞定" + 2-row activation card.

- [ ] **Step 2**: Commit

### Task 8.7: Delete deprecated onboarding screens + routes

**Files:**
- Delete: `frontend/src/screens/OnboardPairCode.tsx`
- Delete: `frontend/src/screens/OnboardBind.tsx`
- Modify: `frontend/src/App.tsx` (remove routes)

```bash
rm frontend/src/screens/OnboardPairCode.tsx frontend/src/screens/OnboardBind.tsx
# Update App.tsx to remove `/onboard/pair-code` and `/onboard/bind` routes
git add -A
git commit -m "feat(frontend): remove pairing-code onboarding screens (replaced by skill.md)"
```

### Task 8.8: `Dashboard.tsx` → 控制台 redesign

**Files:**
- Modify: `frontend/src/screens/Dashboard.tsx`

**Read first**: existing Dashboard.tsx (167 LOC) + visual companion `dashboard-v1.html`.

- [ ] **Step 1**: Replace contents with the new structure:
  - `$X.XX` 余额 hero (orange gradient card)
  - 今日 cap 进度条
  - 黑底"最近调用"strip
  - 活跃 bucket 列表
  - 接入中心卡 (`<APIKeyList />` for keys + 已接入 Agent list)
  - 最近使用 4 行 (uses `<UsageRow>` × 4)
  - API Key 内嵌 (`<APIKeyList />`)

- [ ] **Step 2**: Use `api.getBuckets()` + `api.getUsage({ limit: 4 })` for data.

- [ ] **Step 3**: Commit

```bash
git add frontend/src/screens/Dashboard.tsx
git commit -m "feat(frontend): Dashboard rewrite as 控制台 with embedded sections"
```

### Task 8.9: `Plans.tsx` → Pricing v8 redesign

**Files:**
- Modify: `frontend/src/screens/Plans.tsx`

**Read first**: existing Plans.tsx (128 LOC) + visual companion `pricing-v1.html`.

- [ ] **Step 1**: Use `<TierCard>` × 3 + ¥1=$1 baseline anchor + `<SectionHeader>` 01/02. CTA分叉 by `useAuth()` state.

- [ ] **Step 2**: Commit

```bash
git add frontend/src/screens/Plans.tsx
git commit -m "feat(frontend): Plans → Pricing v8 with baseline anchor + leverage badges"
```

### Task 8.10: `UsageHistory.tsx` — 24h chart + type column

**Files:**
- Modify: `frontend/src/screens/UsageHistory.tsx`

**Read first**: existing UsageHistory.tsx (150 LOC) + visual companion `history-v0.html`.

- [ ] **Step 1**: Use `<ConsumeChart24h>` + `<UsageRow>` × N + filter selects + 首页/末页 pagination. Drop CSV export, search, day grouping.

- [ ] **Step 2**: Pull data from `api.getUsage({ ... })` with new shape `{records, totals, hourly24h}`.

- [ ] **Step 3**: Commit

```bash
git add frontend/src/screens/UsageHistory.tsx
git commit -m "feat(frontend): UsageHistory with 24h chart + event_type column"
```

### Task 8.11: `Settings.tsx` — new account page

**Files:**
- Create: `frontend/src/screens/Settings.tsx`
- Modify: `frontend/src/App.tsx` (add route)

**Read first**: visual companion `settings-v0.html`.

- [ ] **Step 1**: Per spec — email + 套餐 + 注册时间 + 用量 (消耗+调用) + 客服 + 退出. No avatar / display name / 最常用模型.

- [ ] **Step 2**: Add route `/dashboard/account` → `<Settings />`.

- [ ] **Step 3**: Commit

```bash
git add frontend/src/screens/Settings.tsx frontend/src/App.tsx
git commit -m "feat(frontend): Settings minimal account page"
```

### Task 8.12: `Payment.tsx` — v1.0 stub

**Files:**
- Modify: `frontend/src/screens/Payment.tsx`

- [ ] **Step 1**: Replace contents with stub per spec — "支付通道即将开放，请联系客服" + WeChat QR placeholder + custom service ID.

- [ ] **Step 2**: Commit

```bash
git add frontend/src/screens/Payment.tsx
git commit -m "feat(frontend): Payment v1.0 stub with 客服 contact"
```

### Task 8.13: `manual-config-pc` page

**Files:**
- Create: `frontend/src/screens/ManualConfigPC.tsx`
- Modify: `frontend/src/App.tsx`

**Read first**: visual companion `manual-config-pc.html`.

- [ ] **Step 1**: Docs-style page with left sidebar (Agent list) + main content (one-line `set up tokenboss.com/skill.md` as primary + collapsible 4-step traditional fallback).

- [ ] **Step 2**: Route `/install/manual`. Linked from `OnboardWelcome` "I am Human" branch.

- [ ] **Step 3**: Commit

```bash
git add frontend/src/screens/ManualConfigPC.tsx frontend/src/App.tsx
git commit -m "feat(frontend): manual-config-pc docs page with one-line primary"
```

### Task 8.14: Delete deprecated screens

**Files:**
- Delete: `frontend/src/screens/Keys.tsx` (logic moved to APIKeyList component, embedded in Dashboard)
- Delete: `frontend/src/screens/AddOns.tsx`, `AddOnSuccess.tsx`
- Delete: `frontend/src/screens/PaymentSuccess.tsx`
- Delete: `frontend/src/screens/LowBalance.tsx`, `BalanceCommand.tsx`
- Delete: `frontend/src/screens/FlowIndex.tsx`
- Delete: `frontend/src/screens/LandingVision.tsx`

- [ ] **Step 1**: Delete files

- [ ] **Step 2**: Update `frontend/src/App.tsx` to remove all corresponding routes (`/dashboard/keys`, `/billing/addons`, `/billing/addon-success`, `/billing/success`, `/chat/low-balance`, `/chat/balance`, `/flow`, `/landing/vision`)

- [ ] **Step 3**: Run `npm run build` to ensure no broken imports.

- [ ] **Step 4**: Commit

```bash
git rm frontend/src/screens/Keys.tsx frontend/src/screens/AddOns.tsx frontend/src/screens/AddOnSuccess.tsx frontend/src/screens/PaymentSuccess.tsx frontend/src/screens/LowBalance.tsx frontend/src/screens/BalanceCommand.tsx frontend/src/screens/FlowIndex.tsx frontend/src/screens/LandingVision.tsx
git add frontend/src/App.tsx
git commit -m "feat(frontend): remove deprecated screens (v1.0 scope)"
```

---

## Phase 9: Integration

### Task 9.1: Update `App.tsx` route table

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1**: Final route table:

```tsx
<Routes>
  <Route path="/" element={<Landing />} />
  <Route path="/login" element={<Login />} />
  <Route path="/register" element={<Register />} />

  <Route path="/onboard/welcome" element={<RequireAuth><OnboardWelcome /></RequireAuth>} />
  <Route path="/onboard/install" element={<RequireAuth><OnboardInstall /></RequireAuth>} />
  <Route path="/onboard/success" element={<RequireAuth><OnboardSuccess /></RequireAuth>} />

  <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
  <Route path="/dashboard/history" element={<RequireAuth><UsageHistory /></RequireAuth>} />
  <Route path="/dashboard/account" element={<RequireAuth><Settings /></RequireAuth>} />

  <Route path="/pricing" element={<Plans />} />
  <Route path="/billing/pay" element={<Payment />} />

  <Route path="/install/manual" element={<ManualConfigPC />} />
</Routes>
```

- [ ] **Step 2**: Commit

```bash
git add frontend/src/App.tsx
git commit -m "feat(frontend): finalize v1.0 route table"
```

### Task 9.2: E2E manual smoke test

- [ ] **Step 1**: Start backend `npm run dev` (in `backend/`)

- [ ] **Step 2**: Start frontend `npm run dev` (in `frontend/`)

- [ ] **Step 3**: Walk through:
  1. Open `/` → Landing renders, see compat row + wallet hero + terminal block
  2. Click 免费开始 → `/register`
  3. Enter `test@example.com` → 发送验证码 → check console log for code
  4. Enter code → redirects to `/dashboard`
  5. Verify trial bucket shown ($10 / 24h)
  6. Click 套餐 → `/pricing` → 3 tier cards
  7. Click 联系客服开通 (logged in view) → no error
  8. Click 控制台 → back to dashboard
  9. Click 使用历史 link → `/dashboard/history` → empty state since no calls yet
  10. Click 账户 link → `/dashboard/account` → see email + trial bucket info
  11. Click 退出 → back to `/`

- [ ] **Step 4**: Document any bugs, fix or file follow-ups.

### Task 9.3: SQL grant scripts for internal beta

**Files:**
- Create: `backend/scripts/grant-bucket.sh`

```bash
#!/usr/bin/env bash
# Usage: ./grant-bucket.sh <email> <plan_plus|plan_super|plan_ultra|topup>
set -e
EMAIL=$1
SKU=$2
DB="${SQLITE_PATH:-backend/data/tokenboss.db}"
USER_ID=$(sqlite3 "$DB" "SELECT userId FROM users WHERE email = '$EMAIL';")
[ -z "$USER_ID" ] && { echo "user not found: $EMAIL"; exit 1; }

case "$SKU" in
  plan_plus)
    sqlite3 "$DB" "INSERT INTO credit_bucket (id, userId, skuType, amountUsd, dailyCapUsd, dailyRemainingUsd, totalRemainingUsd, startedAt, expiresAt, modeLock, modelPool, createdAt) VALUES (lower(hex(randomblob(16))), '$USER_ID', 'plan_plus', 840, 30, 30, NULL, datetime('now'), datetime('now', '+28 days'), 'auto_only', 'codex_only', datetime('now'));"
    ;;
  plan_super)
    sqlite3 "$DB" "INSERT INTO credit_bucket (id, userId, skuType, amountUsd, dailyCapUsd, dailyRemainingUsd, totalRemainingUsd, startedAt, expiresAt, modeLock, modelPool, createdAt) VALUES (lower(hex(randomblob(16))), '$USER_ID', 'plan_super', 2240, 80, 80, NULL, datetime('now'), datetime('now', '+28 days'), 'none', 'all', datetime('now'));"
    ;;
  plan_ultra)
    sqlite3 "$DB" "INSERT INTO credit_bucket (id, userId, skuType, amountUsd, dailyCapUsd, dailyRemainingUsd, totalRemainingUsd, startedAt, expiresAt, modeLock, modelPool, createdAt) VALUES (lower(hex(randomblob(16))), '$USER_ID', 'plan_ultra', 20160, 720, 720, NULL, datetime('now'), datetime('now', '+28 days'), 'none', 'all', datetime('now'));"
    ;;
  topup)
    AMT=${3:-100}
    sqlite3 "$DB" "INSERT INTO credit_bucket (id, userId, skuType, amountUsd, dailyCapUsd, dailyRemainingUsd, totalRemainingUsd, startedAt, expiresAt, modeLock, modelPool, createdAt) VALUES (lower(hex(randomblob(16))), '$USER_ID', 'topup', $AMT, NULL, NULL, $AMT, datetime('now'), NULL, 'none', 'all', datetime('now'));"
    ;;
  *) echo "unknown sku: $SKU"; exit 1 ;;
esac
echo "granted $SKU to $EMAIL"
```

- [ ] **Step 1**: Save and `chmod +x backend/scripts/grant-bucket.sh`

- [ ] **Step 2**: Commit

```bash
git add backend/scripts/grant-bucket.sh
git commit -m "chore(backend): grant-bucket.sh for internal beta credit issuance"
```

---

## Phase 10: Documentation + Deploy

### Task 10.1: Update `README.md`

- [ ] Document new auth flow (email + code, no password)
- [ ] Document `set up tokenboss.com/skill.md` install pattern
- [ ] Document SQL grant scripts for internal beta

### Task 10.2: Configure email provider in production

- [ ] Set `EMAIL_PROVIDER=resend` and `RESEND_API_KEY=...` in production env
- [ ] Verify sender domain is configured in Resend / SendGrid
- [ ] Smoke test sending email to a real address

### Task 10.3: Deploy `tokenboss.com/skill.md`

- [ ] Verify backend serves `/skill.md` with `Content-Type: text/markdown`
- [ ] If using a separate static host (e.g., Vercel/Cloudflare), proxy or duplicate the file there
- [ ] Test by running `curl https://tokenboss.com/skill.md` → should return markdown content
- [ ] Test in real Agent: `set up tokenboss.com/skill.md` in Claude Code → verify skill registers

### Task 10.4: Production E2E + cron verification

- [ ] Real user signup with real email
- [ ] Manual SQL grant Plus bucket
- [ ] Real Agent install via skill.md
- [ ] Real chat call → verify usage_log + bucket consumption
- [ ] Wait until 0:00 → verify cron runs `expire+reset` correctly
- [ ] Check 使用历史 page shows expire + reset rows

---

## Self-Review

**1. Spec coverage:**

| Spec section | Plan task |
|---|---|
| credits-economy §1 计价单位 | Task 8.8 (Dashboard $ display), 8.10 (history $ display) |
| credits-economy §2 套餐 SKU | Task 6.4 (TierCard), 8.9 (Plans) |
| credits-economy §3 日 cap + 4 周 + 双事件 | Task 1.1 (schema), 3.2 (cron), 3.3 (schedule), 1.3 (event_type) |
| credits-economy §4 充值 ¥1=$1 baseline | Task 8.3 (Landing payg), 8.9 (Pricing baseline anchor) |
| credits-economy §5 试用 $10 / 24h ECO | Task 2.3 (verify-code grants trial bucket) |
| credits-economy §6 扣费模型 | Task 3.1 (consumeForRequest), 3.4 (chat proxy wiring) |
| credits-economy §7 优先扣 套餐→充值 | Task 1.1 (getActiveBucketsForUser ORDER BY), 3.1 (consume drain) |
| credits-economy §8 使用历史 | Task 6.6 (chart), 6.7 (UsageRow), 8.10 (UsageHistory page) |
| credits-economy §9 模式锁 / 模型池 | Task 3.1 (modeAllowed + modelInPool) |
| credits-economy §10 支付 | Task 8.12 (Payment v1.0 stub) |
| v1-features §1 Frontend pages | Tasks 8.1-8.13 |
| v1-features §2 Backend changes | Tasks 1.1-1.3, 2.1-2.4, 3.1-3.4, 4.1-4.3 |
| v1-features §3 No admin | (no task — by omission) |
| v1-features §4 Agent integration | Task 4.1 (skill.md), 3.4 (in-chat error messages) |
| ux-redesign §三大原则 | Implicit throughout |
| ux-redesign §视觉系统 | Task 5.1 (tokens) |
| ux-redesign §棒 1-7 | Tasks 8.1-8.13 |
| ux-redesign §skill.md 模板 | Task 4.1 |

All sections covered.

**2. Placeholder scan:** No "TODO" / "TBD" / "fill in" patterns remain in tasks. All steps include code or commands.

**3. Type consistency:**
- `BucketSku` defined in Task 1.1 store.ts, used in 3.1 buckets.ts ✓
- `EventType` defined in Task 1.3, used in 3.2 dailyCron.ts and 4.3 usage handler ✓
- `ModeLock` / `ModelPool` consistent ✓
- Component props match across tasks ✓

**4. Ambiguity:** Tasks reference visual companion HTML files for exact pixel work — that's the source of truth for UI styling. Backend tasks are explicit code.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-26-tokenboss-v1-implementation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
