/**
 * Storage layer — SQLite via better-sqlite3.
 *
 * TokenBoss stores identity (email/password for session login) and the
 * newapi linkage needed to act on the user's behalf: newapi user ID plus
 * the random password we generated at provisioning time (used to log in
 * as the user when managing their newapi tokens from `/v1/keys`).
 *
 * API keys (`sk-xxx`) are NOT stored here — they live exclusively in
 * newapi, which is the source of truth for both auth and billing.
 *
 * All public functions are async (returning Promises) even though
 * better-sqlite3 is synchronous, so call-site signatures stay identical
 * to the old DynamoDB version.
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

// ---------- Record types ----------

export interface UserRecord {
  userId: string;
  displayName?: string;
  email?: string;
  phone?: string;
  passwordHash?: string;
  createdAt: string;
  /** True after the user clicks the verification link sent on register. */
  emailVerified?: boolean;
  /** newapi user ID (if provisioned). */
  newapiUserId?: number;
  /**
   * Random password we generated for this user in newapi. Used only
   * server-to-server to log in as the user when managing tokens via
   * `/v1/keys`. Never shown to the client.
   */
  newapiPassword?: string;
  /** Active subscription tier: 'trial' for new accounts (1 day), or
   *  'plus'/'super'/'ultra' for paid (28 day). NULL when the user has
   *  no active subscription (cron-expired or never bound). 'default' is
   *  NOT a TokenBoss plan label — it's the newapi-side fallback group. */
  plan?: UserPlan;
  /** ISO timestamp the current subscription started; null for free. */
  subscriptionStartedAt?: string;
  /** ISO timestamp the current subscription expires; null for free. */
  subscriptionExpiresAt?: string;
  /** Daily $ allowance reset every 24h; null for free (one-shot $10 grant). */
  dailyQuotaUsd?: number;
  /**
   * ISO timestamp of the next per-user 24h quota reset. Cron iterates
   * paid users with this <= now and bumps it +24h after pushing fresh
   * quota into newapi. Null for free users (no reset cycle).
   */
  quotaNextResetAt?: string;
}

export type UserPlan = "trial" | "plus" | "super" | "ultra";

// ---------- Order types (re-export from payment/types) ----------

export type {
  OrderRecord,
  OrderStatus,
  PaymentChannel,
  OrderCurrency,
  OrderSkuType,
  OrderSettleStatus,
  PlanId,
} from "./payment/types.js";

// Type-only imports kept locally so `as PaymentChannel` casts in
// rowToOrder still compile.
import type {
  OrderCurrency,
  OrderRecord,
  OrderStatus,
  PaymentChannel,
} from "./payment/types.js";

// ---------- Database singleton ----------

// Assigned by init() which is called immediately at module load below.
// eslint-disable-next-line prefer-const
export let db: Database.Database = null!;

function ensureDir(filePath: string) {
  const dir = dirname(filePath);
  if (dir && dir !== "." && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * (Re-)initialise the database. Must be called before any CRUD functions.
 * Reads SQLITE_PATH (test override) or DATABASE_PATH (production) from env.
 * Safe to call multiple times — closes any existing connection first.
 */
// Track the path of the currently open connection so re-init on the same
// path (common in tests that call init() to trigger migrations) skips
// close+reopen and instead runs migrations on the existing connection.
let _currentDbPath: string | null = null;

export function init(): void {
  const dbPath =
    process.env.SQLITE_PATH ?? process.env.DATABASE_PATH ?? "data/tokenboss.db";

  if (db && _currentDbPath === dbPath) {
    // Same path already open — just re-run schema/migrations below.
  } else {
    if (db) {
      db.close();
    }

    if (dbPath !== ":memory:") {
      ensureDir(dbPath);
    }

    db = new Database(dbPath);
    _currentDbPath = dbPath;
  }

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      userId                 TEXT PRIMARY KEY,
      displayName            TEXT,
      email                  TEXT,
      phone                  TEXT,
      passwordHash           TEXT,
      createdAt              TEXT NOT NULL,
      emailVerified          INTEGER NOT NULL DEFAULT 0,
      newapiUserId           INTEGER,
      newapiPassword         TEXT,
      plan                   TEXT,
      subscriptionStartedAt  TEXT,
      subscriptionExpiresAt  TEXT,
      dailyQuotaUsd          REAL,
      quotaNextResetAt       TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email
      ON users(email) WHERE email IS NOT NULL;
  `);

  // Lightweight migrations — add missing columns on pre-existing dev DBs.
  {
    const cols = db
      .prepare(`PRAGMA table_info(users)`)
      .all() as { name: string }[];
    const have = new Set(cols.map((c) => c.name));
    if (!have.has("newapiPassword")) {
      db.exec(`ALTER TABLE users ADD COLUMN newapiPassword TEXT`);
    }
    if (!have.has("emailVerified")) {
      db.exec(`ALTER TABLE users ADD COLUMN emailVerified INTEGER NOT NULL DEFAULT 0`);
    }
    if (!have.has("plan")) {
      db.exec(`ALTER TABLE users ADD COLUMN plan TEXT`);
    }
    if (!have.has("subscriptionStartedAt")) {
      db.exec(`ALTER TABLE users ADD COLUMN subscriptionStartedAt TEXT`);
    }
    if (!have.has("subscriptionExpiresAt")) {
      db.exec(`ALTER TABLE users ADD COLUMN subscriptionExpiresAt TEXT`);
    }
    if (!have.has("dailyQuotaUsd")) {
      db.exec(`ALTER TABLE users ADD COLUMN dailyQuotaUsd REAL`);
    }
    if (!have.has("quotaNextResetAt")) {
      db.exec(`ALTER TABLE users ADD COLUMN quotaNextResetAt TEXT`);
    }
    // V3 cleanup: any pre-V3 row with plan='free' is migrated to NULL
    // (= no active subscription). 'free' is removed from the UserPlan
    // type so leaving these around would let stale data leak past
    // type-checked code paths.
    db.exec(`UPDATE users SET plan = NULL WHERE plan = 'free'`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS api_key_index (
      userId        TEXT NOT NULL,
      newapiTokenId INTEGER NOT NULL,
      keyHash       TEXT NOT NULL,
      createdAt     TEXT NOT NULL,
      PRIMARY KEY (userId, newapiTokenId)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_api_key_index_hash
      ON api_key_index(keyHash);
    CREATE INDEX IF NOT EXISTS idx_api_key_index_user
      ON api_key_index(userId);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS email_verify_tokens (
      token       TEXT PRIMARY KEY,
      userId      TEXT NOT NULL,
      email       TEXT NOT NULL,
      createdAt   TEXT NOT NULL,
      expiresAt   TEXT NOT NULL,
      consumedAt  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_evt_user ON email_verify_tokens(userId, createdAt DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS verification_codes (
      email          TEXT NOT NULL,
      code           TEXT NOT NULL,
      expiresAt      TEXT NOT NULL,
      consumed       INTEGER NOT NULL DEFAULT 0,
      createdAt      TEXT NOT NULL,
      failedAttempts INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_codes_email ON verification_codes(email, code);
  `);

  // Idempotent migration: add failedAttempts column to pre-existing DBs.
  try {
    db.exec(`ALTER TABLE verification_codes ADD COLUMN failedAttempts INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — ignore.
  }

  // Drop legacy bucket / usage tables behind an env flag so prod admins
  // opt in explicitly. Locally / in tests, set MIGRATE_DROP_LEGACY=1 (or
  // when SQLITE_PATH=':memory:', this is auto-enabled since it's a fresh
  // DB anyway).
  const dropLegacy =
    process.env.MIGRATE_DROP_LEGACY === "1" ||
    process.env.SQLITE_PATH === ":memory:";
  if (dropLegacy) {
    db.exec(`DROP TABLE IF EXISTS credit_bucket`);
    db.exec(`DROP TABLE IF EXISTS usage_log`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      orderId            TEXT PRIMARY KEY,
      userId             TEXT NOT NULL,
      -- Legacy column. Originally short name for the newapi subscription plan
      -- ('plus'|'super'|'ultra') used at settle time to bind the user. Topup
      -- orders have no newapi plan, but pre-2026-04-29 production tables were
      -- created with NOT NULL and ALTER COLUMN isn't supported in SQLite — so
      -- createOrder() writes the literal 'topup' as a placeholder. The real
      -- discriminator is the skuType column below; nothing reads planId to decide flow.
      planId             TEXT,
      skuType            TEXT,                      -- 'plan_plus'|'plan_super'|'plan_ultra'|'topup'
      topupAmountUsd     REAL,                      -- only set for skuType='topup'
      settleStatus       TEXT,                      -- 'settled'|'failed' for topup; null otherwise
      channel            TEXT NOT NULL,
      amountCNY          REAL NOT NULL,
      amountActual       REAL,
      status             TEXT NOT NULL,
      upstreamTradeId    TEXT,
      upstreamPaymentUrl TEXT,
      blockTxId          TEXT,
      receiveAddress     TEXT,
      createdAt          TEXT NOT NULL,
      paidAt             TEXT,
      currency           TEXT NOT NULL DEFAULT 'CNY'
    );
    CREATE INDEX IF NOT EXISTS idx_orders_user
      ON orders(userId, createdAt DESC);
  `);

  // Idempotent migration for pre-V3 dev DBs that don't have the column.
  try { db.exec(`ALTER TABLE orders ADD COLUMN currency TEXT NOT NULL DEFAULT 'CNY'`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN skuType TEXT`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN topupAmountUsd REAL`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN settleStatus TEXT`); } catch {}

  // Rename legacy plan ids → new tier names FIRST, so the backfill below
  // only ever sees canonical planId values ('plus'|'super'|'ultra').
  db.exec(`
    UPDATE orders SET planId = CASE planId
      WHEN 'basic'    THEN 'plus'
      WHEN 'standard' THEN 'super'
      WHEN 'pro'      THEN 'ultra'
      ELSE planId
    END
  `);

  // Backfill skuType from legacy planId for any existing rows.
  // Idempotent: only overwrites NULL skuType, leaves explicit values alone.
  db.exec(`
    UPDATE orders
       SET skuType = CASE planId
         WHEN 'plus'  THEN 'plan_plus'
         WHEN 'super' THEN 'plan_super'
         WHEN 'ultra' THEN 'plan_ultra'
         ELSE skuType
       END
     WHERE skuType IS NULL AND planId IS NOT NULL
  `);

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
}

// Initialise on module load (production default path).
// Tests call init() again after setting process.env.SQLITE_PATH = ':memory:'.
init();

// ---------- Row → Record mappers ----------

const VALID_SKU_TYPES = ['plan_plus', 'plan_super', 'plan_ultra', 'topup'] as const;
type ValidSkuType = (typeof VALID_SKU_TYPES)[number];

function deriveSkuType(skuType: string | undefined, planId: string | undefined): ValidSkuType {
  if (skuType && (VALID_SKU_TYPES as readonly string[]).includes(skuType)) {
    return skuType as ValidSkuType;
  }
  if (planId === 'plus') return 'plan_plus';
  if (planId === 'super') return 'plan_super';
  if (planId === 'ultra') return 'plan_ultra';
  // 'topup' is the placeholder createOrder() writes for topup orders (see
  // schema comment on `planId`). Never produced by real plan binding —
  // keeping this branch makes the fallback honest about what values the
  // legacy column can hold.
  if (planId === 'topup') return 'topup';
  // Last-resort default: any other state means migration didn't fully run.
  // 'plan_plus' is the safest fallback (lowest privilege paid tier).
  return 'plan_plus';
}

function rowToUser(row: Record<string, unknown>): UserRecord {
  return {
    userId: row.userId as string,
    displayName: (row.displayName as string) ?? undefined,
    email: (row.email as string) ?? undefined,
    phone: (row.phone as string) ?? undefined,
    passwordHash: (row.passwordHash as string) ?? undefined,
    createdAt: row.createdAt as string,
    emailVerified: ((row.emailVerified as number) ?? 0) === 1,
    newapiUserId: (row.newapiUserId as number) ?? undefined,
    newapiPassword: (row.newapiPassword as string) ?? undefined,
    plan: (row.plan as UserPlan) ?? undefined,
    subscriptionStartedAt: (row.subscriptionStartedAt as string) ?? undefined,
    subscriptionExpiresAt: (row.subscriptionExpiresAt as string) ?? undefined,
    dailyQuotaUsd: (row.dailyQuotaUsd as number) ?? undefined,
    quotaNextResetAt: (row.quotaNextResetAt as string) ?? undefined,
  };
}

function rowToOrder(row: Record<string, unknown>): OrderRecord {
  return {
    orderId: row.orderId as string,
    userId: row.userId as string,
    skuType: deriveSkuType(row.skuType as string | undefined, row.planId as string | undefined),
    channel: row.channel as PaymentChannel,
    // DB column historically named `amountCNY` for legacy reasons.
    amount: row.amountCNY as number,
    currency: ((row.currency as string) ?? "CNY") as OrderCurrency,
    amountActual: (row.amountActual as number) ?? undefined,
    topupAmountUsd: (row.topupAmountUsd as number) ?? undefined,
    settleStatus:
      (row.settleStatus as OrderRecord['settleStatus']) ?? undefined,
    status: row.status as OrderStatus,
    upstreamTradeId: (row.upstreamTradeId as string) ?? undefined,
    upstreamPaymentUrl: (row.upstreamPaymentUrl as string) ?? undefined,
    blockTxId: (row.blockTxId as string) ?? undefined,
    receiveAddress: (row.receiveAddress as string) ?? undefined,
    createdAt: row.createdAt as string,
    paidAt: (row.paidAt as string) ?? undefined,
  };
}

// ---------- Public API — Users ----------

export async function getUser(userId: string): Promise<UserRecord | null> {
  const row = db
    .prepare(`SELECT * FROM users WHERE userId = ?`)
    .get(userId) as Record<string, unknown> | undefined;
  return row ? rowToUser(row) : null;
}

export function putUser(rec: UserRecord): void {
  db.prepare(`
    INSERT OR REPLACE INTO users
      (userId, displayName, email, phone, passwordHash, createdAt, emailVerified,
       newapiUserId, newapiPassword, plan, subscriptionStartedAt, subscriptionExpiresAt,
       dailyQuotaUsd, quotaNextResetAt)
    VALUES
      (@userId, @displayName, @email, @phone, @passwordHash, @createdAt, @emailVerified,
       @newapiUserId, @newapiPassword, @plan, @subscriptionStartedAt, @subscriptionExpiresAt,
       @dailyQuotaUsd, @quotaNextResetAt)
  `).run({
    userId: rec.userId,
    displayName: rec.displayName ?? null,
    email: rec.email ?? null,
    phone: rec.phone ?? null,
    passwordHash: rec.passwordHash ?? null,
    createdAt: rec.createdAt,
    emailVerified: rec.emailVerified ? 1 : 0,
    newapiUserId: rec.newapiUserId ?? null,
    newapiPassword: rec.newapiPassword ?? null,
    plan: rec.plan ?? null,
    subscriptionStartedAt: rec.subscriptionStartedAt ?? null,
    subscriptionExpiresAt: rec.subscriptionExpiresAt ?? null,
    dailyQuotaUsd: rec.dailyQuotaUsd ?? null,
    quotaNextResetAt: rec.quotaNextResetAt ?? null,
  });
}

export function getUserIdByEmail(email: string): string | null {
  const norm = email.trim().toLowerCase();
  if (!norm) return null;
  const row = db
    .prepare(`SELECT userId FROM users WHERE email = ?`)
    .get(norm) as { userId: string } | undefined;
  return row?.userId ?? null;
}

export async function putEmailIndex(
  _email: string,
  _userId: string
): Promise<void> {
  // Email uniqueness is enforced by the UNIQUE index on users.email.
  // This function is kept for API compatibility but is now a no-op —
  // the email is written as part of putUser().
}

// ---------- Public API — Subscription / Plan ----------

/** Patch the plan-related columns on a user row. All 4 fields are
 *  overwritten — pass explicit nulls to clear. Pass `plan: null` to mark
 *  the user as having no active subscription (the cron does this on
 *  expiry; `default` is just a newapi group, not a TokenBoss plan). */
export function setUserPlan(
  userId: string,
  patch: {
    plan: UserPlan | null;
    subscriptionStartedAt?: string | null;
    subscriptionExpiresAt?: string | null;
    dailyQuotaUsd?: number | null;
    quotaNextResetAt?: string | null;
  },
): void {
  db.prepare(`
    UPDATE users
       SET plan                  = @plan,
           subscriptionStartedAt = @subscriptionStartedAt,
           subscriptionExpiresAt = @subscriptionExpiresAt,
           dailyQuotaUsd         = @dailyQuotaUsd,
           quotaNextResetAt      = @quotaNextResetAt
     WHERE userId = @userId
  `).run({
    userId,
    plan: patch.plan,
    subscriptionStartedAt: patch.subscriptionStartedAt ?? null,
    subscriptionExpiresAt: patch.subscriptionExpiresAt ?? null,
    dailyQuotaUsd: patch.dailyQuotaUsd ?? null,
    quotaNextResetAt: patch.quotaNextResetAt ?? null,
  });
}

// ---------- Public API — API Key Index ----------

/**
 * Map a newapi-issued `sk-xxx` key to its owning user. The raw key is
 * NEVER stored — we keep `sha256(rawKey)` so chatProxyCore can reverse-
 * lookup `userId` on incoming requests without hitting newapi.
 */
export function putApiKeyIndex(args: {
  userId: string;
  newapiTokenId: number;
  keyHash: string;
}): void {
  db.prepare(`
    INSERT OR REPLACE INTO api_key_index
      (userId, newapiTokenId, keyHash, createdAt)
    VALUES
      (@userId, @newapiTokenId, @keyHash, @createdAt)
  `).run({
    userId: args.userId,
    newapiTokenId: args.newapiTokenId,
    keyHash: args.keyHash,
    createdAt: new Date().toISOString(),
  });
}

/**
 * Look up the userId that owns the given raw-key hash. Returns null when
 * unknown — chatProxyCore should treat this as "anonymous direct caller"
 * and pass-through without rewriting models.
 */
export function getUserIdByKeyHash(keyHash: string): string | null {
  const row = db
    .prepare(`SELECT userId FROM api_key_index WHERE keyHash = ?`)
    .get(keyHash) as { userId: string } | undefined;
  return row?.userId ?? null;
}

/** Drop the index row for a deleted token. Tolerant of missing rows. */
export function deleteApiKeyIndex(userId: string, newapiTokenId: number): void {
  db.prepare(
    `DELETE FROM api_key_index WHERE userId = ? AND newapiTokenId = ?`,
  ).run(userId, newapiTokenId);
}

// ---------- Public API — Verification Codes ----------

export function saveVerificationCode(email: string, code: string, ttlSeconds: number): void {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  db.prepare(`
    INSERT INTO verification_codes (email, code, expiresAt, consumed, createdAt)
    VALUES (?, ?, ?, 0, ?)
  `).run(email.toLowerCase(), code, expiresAt, new Date().toISOString());
}

export function consumeVerificationCode(email: string, code: string): boolean {
  // Find the latest unconsumed code for this email (regardless of code value).
  const latest = db.prepare(`
    SELECT rowid AS id, code AS storedCode, expiresAt, failedAttempts FROM verification_codes
    WHERE email = ? AND consumed = 0
    ORDER BY createdAt DESC LIMIT 1
  `).get(email.toLowerCase()) as { id: number; storedCode: string; expiresAt: string; failedAttempts: number } | undefined;

  if (!latest) return false;
  if (new Date(latest.expiresAt) < new Date()) return false;

  if (latest.storedCode === code) {
    // Correct code — consume it.
    db.prepare(`UPDATE verification_codes SET consumed = 1 WHERE rowid = ?`).run(latest.id);
    return true;
  }

  // Wrong code — increment failedAttempts and lock out after 5 failures.
  const newCount = latest.failedAttempts + 1;
  if (newCount >= 5) {
    db.prepare(`UPDATE verification_codes SET consumed = 1 WHERE rowid = ?`).run(latest.id);
  } else {
    db.prepare(`UPDATE verification_codes SET failedAttempts = ? WHERE rowid = ?`).run(newCount, latest.id);
  }
  return false;
}

export function recentCodeCount(email: string, sinceSeconds: number): number {
  const since = new Date(Date.now() - sinceSeconds * 1000).toISOString();
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM verification_codes
    WHERE email = ? AND createdAt > ? AND consumed = 0
  `).get(email.toLowerCase(), since) as { n: number };
  return row.n;
}

// ---------- Public API — Email Verification (link-based) ----------

const EMAIL_VERIFY_TTL_HOURS = 24;

/**
 * Mint a one-shot URL-safe token tied to (userId, email). Caller embeds
 * the token in a verification link delivered by email.
 */
export function createEmailVerifyToken(userId: string, email: string): {
  token: string;
  expiresAt: string;
} {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + EMAIL_VERIFY_TTL_HOURS * 3600e3).toISOString();
  db.prepare(`
    INSERT INTO email_verify_tokens (token, userId, email, createdAt, expiresAt, consumedAt)
    VALUES (?, ?, ?, ?, ?, NULL)
  `).run(token, userId, email.toLowerCase(), now.toISOString(), expiresAt);
  return { token, expiresAt };
}

/**
 * Atomically consume a token. Returns the (userId, email) pair on success,
 * or null when the token is unknown, expired, or already consumed.
 */
export function consumeEmailVerifyToken(token: string): {
  userId: string;
  email: string;
} | null {
  const row = db.prepare(`
    SELECT userId, email, expiresAt, consumedAt
    FROM email_verify_tokens
    WHERE token = ?
  `).get(token) as
    | { userId: string; email: string; expiresAt: string; consumedAt: string | null }
    | undefined;
  if (!row) return null;
  if (row.consumedAt) return null;
  if (new Date(row.expiresAt) < new Date()) return null;

  db.prepare(`
    UPDATE email_verify_tokens SET consumedAt = ? WHERE token = ?
  `).run(new Date().toISOString(), token);
  return { userId: row.userId, email: row.email };
}

/** Mark a user's email verified after a successful token consume. */
export function markEmailVerified(userId: string): void {
  db.prepare(`UPDATE users SET emailVerified = 1 WHERE userId = ?`).run(userId);
}

/**
 * How many verify-token rows have been minted for this user in the past N
 * seconds. Used to rate-limit the resend endpoint (1 / 60s, 5 / hour).
 */
export function recentEmailVerifyTokenCount(userId: string, sinceSeconds: number): number {
  const since = new Date(Date.now() - sinceSeconds * 1000).toISOString();
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM email_verify_tokens
    WHERE userId = ? AND createdAt > ?
  `).get(userId, since) as { n: number };
  return row.n;
}

// ---------- Public API — Orders ----------

export async function createOrder(rec: OrderRecord): Promise<void> {
  // Legacy planId column — see schema comment above. Always non-null:
  // plan_plus → 'plus' / plan_super → 'super' / plan_ultra → 'ultra' / topup → 'topup'.
  const legacyPlanId = rec.skuType.replace(/^plan_/, '');
  db.prepare(`
    INSERT INTO orders
      (orderId, userId, planId, skuType, topupAmountUsd, settleStatus,
       channel, amountCNY, currency, amountActual, status,
       upstreamTradeId, upstreamPaymentUrl, blockTxId, receiveAddress,
       createdAt, paidAt)
    VALUES
      (@orderId, @userId, @planId, @skuType, @topupAmountUsd, @settleStatus,
       @channel, @amount, @currency, @amountActual, @status,
       @upstreamTradeId, @upstreamPaymentUrl, @blockTxId, @receiveAddress,
       @createdAt, @paidAt)
  `).run({
    orderId: rec.orderId,
    userId: rec.userId,
    planId: legacyPlanId,
    skuType: rec.skuType,
    topupAmountUsd: rec.topupAmountUsd ?? null,
    settleStatus: rec.settleStatus ?? null,
    channel: rec.channel,
    amount: rec.amount,
    currency: rec.currency,
    amountActual: rec.amountActual ?? null,
    status: rec.status,
    upstreamTradeId: rec.upstreamTradeId ?? null,
    upstreamPaymentUrl: rec.upstreamPaymentUrl ?? null,
    blockTxId: rec.blockTxId ?? null,
    receiveAddress: rec.receiveAddress ?? null,
    createdAt: rec.createdAt,
    paidAt: rec.paidAt ?? null,
  });
}

export async function getOrder(orderId: string): Promise<OrderRecord | null> {
  const row = db
    .prepare(`SELECT * FROM orders WHERE orderId = ?`)
    .get(orderId) as Record<string, unknown> | undefined;
  return row ? rowToOrder(row) : null;
}

export async function listOrdersByUser(
  userId: string,
  limit = 50,
): Promise<OrderRecord[]> {
  const rows = db
    .prepare(`SELECT * FROM orders WHERE userId = ? ORDER BY createdAt DESC LIMIT ?`)
    .all(userId, limit) as Record<string, unknown>[];
  return rows.map(rowToOrder);
}

export async function attachUpstreamFields(args: {
  orderId: string;
  upstreamTradeId: string;
  upstreamPaymentUrl: string;
  amountActual: number;
}): Promise<void> {
  db.prepare(`
    UPDATE orders
       SET upstreamTradeId = @upstreamTradeId,
           upstreamPaymentUrl = @upstreamPaymentUrl,
           amountActual = @amountActual
     WHERE orderId = @orderId
  `).run(args);
}

// Conditional update: only flip pending→paid. RowsChanged=0 means the
// row was already paid (or expired/failed) — duplicate webhooks become
// no-ops, giving us idempotent settlement.
export async function markOrderPaidIfPending(args: {
  orderId: string;
  paidAt: string;
  amountActual?: number;
  blockTxId?: string;
  receiveAddress?: string;
}): Promise<boolean> {
  const result = db.prepare(`
    UPDATE orders
       SET status = 'paid',
           paidAt = @paidAt,
           amountActual = COALESCE(@amountActual, amountActual),
           blockTxId = COALESCE(@blockTxId, blockTxId),
           receiveAddress = COALESCE(@receiveAddress, receiveAddress)
     WHERE orderId = @orderId AND status = 'pending'
  `).run({
    orderId: args.orderId,
    paidAt: args.paidAt,
    amountActual: args.amountActual ?? null,
    blockTxId: args.blockTxId ?? null,
    receiveAddress: args.receiveAddress ?? null,
  });
  return result.changes > 0;
}

export async function markOrderStatus(args: {
  orderId: string;
  status: Exclude<OrderStatus, "paid">;
}): Promise<boolean> {
  const result = db.prepare(`
    UPDATE orders
       SET status = @status
     WHERE orderId = @orderId AND status = 'pending'
  `).run(args);
  return result.changes > 0;
}

/** Patch the settleStatus column. Used by paymentWebhook after attempting
 *  to credit a topup order's $ to newapi. Returns false if no row matched
 *  (orderId unknown). Idempotent — re-marking the same status is a no-op. */
export async function markOrderSettleStatus(args: {
  orderId: string;
  settleStatus: 'settled' | 'failed';
}): Promise<boolean> {
  const result = db.prepare(`
    UPDATE orders SET settleStatus = @settleStatus WHERE orderId = @orderId
  `).run({ orderId: args.orderId, settleStatus: args.settleStatus });
  return result.changes > 0;
}

// ---------- Public API — Usage Attribution ----------

export const SOURCE_METHODS = ['header', 'ua', 'fallback'] as const;
export type SourceMethod = (typeof SOURCE_METHODS)[number];

export interface AttributionRecord {
  requestId: string;
  userId: string;
  source: string;
  sourceMethod: SourceMethod;
  model: string | null;
  capturedAt: string;
}

type AttributionRow = {
  requestId: string;
  userId: string;
  source: string;
  sourceMethod: SourceMethod;
  model: string | null;
  capturedAt: string;
};

const ATTR_COLS = 'requestId, userId, source, sourceMethod, model, capturedAt';

function rowToAttribution(r: AttributionRow): AttributionRecord {
  return {
    requestId: r.requestId,
    userId: r.userId,
    source: r.source,
    sourceMethod: r.sourceMethod,
    model: r.model,
    capturedAt: r.capturedAt,
  };
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
      `SELECT ${ATTR_COLS}
         FROM usage_attribution
        WHERE requestId IN (${placeholders})`,
    )
    .all(...requestIds) as AttributionRow[];
  for (const r of rows) {
    out.set(r.requestId, rowToAttribution(r));
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
      `SELECT ${ATTR_COLS}
         FROM usage_attribution
        WHERE userId = ?
          AND capturedAt BETWEEN ? AND ?
          AND model IN (${placeholders})`,
    )
    .all(userId, minCapturedAt, maxCapturedAt, ...models) as AttributionRow[];
  return rows.map(rowToAttribution);
}
