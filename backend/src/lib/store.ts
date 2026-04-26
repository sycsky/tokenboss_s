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
  /** newapi user ID (if provisioned). */
  newapiUserId?: number;
  /**
   * Random password we generated for this user in newapi. Used only
   * server-to-server to log in as the user when managing tokens via
   * `/v1/keys`. Never shown to the client.
   */
  newapiPassword?: string;
}

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
export function init(): void {
  const dbPath =
    process.env.SQLITE_PATH ?? process.env.DATABASE_PATH ?? "data/tokenboss.db";

  if (db) {
    db.close();
  }

  if (dbPath !== ":memory:") {
    ensureDir(dbPath);
  }

  db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      userId         TEXT PRIMARY KEY,
      displayName    TEXT,
      email          TEXT,
      phone          TEXT,
      passwordHash   TEXT,
      createdAt      TEXT NOT NULL,
      newapiUserId   INTEGER,
      newapiPassword TEXT
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
  }

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
}

// Initialise on module load (production default path).
// Tests call init() again after setting process.env.SQLITE_PATH = ':memory:'.
init();

// ---------- Row → Record mappers ----------

function rowToUser(row: Record<string, unknown>): UserRecord {
  return {
    userId: row.userId as string,
    displayName: (row.displayName as string) ?? undefined,
    email: (row.email as string) ?? undefined,
    phone: (row.phone as string) ?? undefined,
    passwordHash: (row.passwordHash as string) ?? undefined,
    createdAt: row.createdAt as string,
    newapiUserId: (row.newapiUserId as number) ?? undefined,
    newapiPassword: (row.newapiPassword as string) ?? undefined,
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
      (userId, displayName, email, phone, passwordHash, createdAt, newapiUserId, newapiPassword)
    VALUES
      (@userId, @displayName, @email, @phone, @passwordHash, @createdAt, @newapiUserId, @newapiPassword)
  `).run({
    userId: rec.userId,
    displayName: rec.displayName ?? null,
    email: rec.email ?? null,
    phone: rec.phone ?? null,
    passwordHash: rec.passwordHash ?? null,
    createdAt: rec.createdAt,
    newapiUserId: rec.newapiUserId ?? null,
    newapiPassword: rec.newapiPassword ?? null,
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

// ---------- Bucket types ----------

export type BucketSku =
  | "trial"
  | "topup"
  | "plan_plus"
  | "plan_super"
  | "plan_ultra";
export type ModeLock = "none" | "auto_only" | "auto_eco_only";
export type ModelPool = "all" | "codex_only" | "eco_only";

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

// ---------- Public API — Buckets ----------

export function createBucket(b: Omit<Bucket, "id" | "createdAt">): Bucket {
  const id = randomBytes(16).toString("hex");
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO credit_bucket (id, userId, skuType, amountUsd, dailyCapUsd, dailyRemainingUsd,
      totalRemainingUsd, startedAt, expiresAt, modeLock, modelPool, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    b.userId,
    b.skuType,
    b.amountUsd,
    b.dailyCapUsd,
    b.dailyRemainingUsd,
    b.totalRemainingUsd,
    b.startedAt,
    b.expiresAt,
    b.modeLock,
    b.modelPool,
    createdAt
  );
  return { id, createdAt, ...b };
}

export function getActiveBucketsForUser(userId: string): Bucket[] {
  return db
    .prepare(
      `
    SELECT * FROM credit_bucket
    WHERE userId = ?
      AND (expiresAt IS NULL OR datetime(expiresAt) > datetime('now'))
      AND (
        (skuType IN ('plan_plus','plan_super','plan_ultra') AND COALESCE(dailyRemainingUsd, 0) > 0)
        OR (skuType IN ('trial','topup') AND COALESCE(totalRemainingUsd, 0) > 0)
      )
    ORDER BY
      CASE WHEN skuType = 'topup' THEN 1 ELSE 0 END,
      expiresAt ASC,
      createdAt ASC
  `
    )
    .all(userId) as Bucket[];
}

export function getActiveSubscriptionBuckets(): Bucket[] {
  return db
    .prepare(
      `
    SELECT * FROM credit_bucket
    WHERE skuType != 'topup'
      AND (expiresAt IS NULL OR datetime(expiresAt) > datetime('now'))
  `
    )
    .all() as Bucket[];
}

export function consumeBucket(bucketId: string, amountUsd: number): void {
  db.prepare(`
    UPDATE credit_bucket
    SET dailyRemainingUsd = COALESCE(dailyRemainingUsd, 0) - ?,
        totalRemainingUsd = CASE WHEN totalRemainingUsd IS NOT NULL THEN totalRemainingUsd - ? ELSE NULL END
    WHERE id = ?
  `).run(amountUsd, amountUsd, bucketId);
}

export function resetBucketDaily(bucketId: string, dailyCapUsd: number): void {
  db.prepare(`UPDATE credit_bucket SET dailyRemainingUsd = ? WHERE id = ?`).run(
    dailyCapUsd,
    bucketId
  );
}

export function expireBucketDaily(bucketId: string): number {
  const row = db
    .prepare(`SELECT dailyRemainingUsd FROM credit_bucket WHERE id = ?`)
    .get(bucketId) as { dailyRemainingUsd: number | null } | undefined;
  const remaining = row?.dailyRemainingUsd ?? 0;
  db.prepare(
    `UPDATE credit_bucket SET dailyRemainingUsd = 0 WHERE id = ?`
  ).run(bucketId);
  return remaining;
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

// ---------- Public API — Usage Log ----------

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

export interface HourlyUsage {
  hour: string;   // "HH:00"
  consumed: number;
}

export function getHourlyUsage24h(userId: string): HourlyUsage[] {
  const now = new Date();
  const buckets: HourlyUsage[] = [];
  for (let i = 23; i >= 0; i--) {
    const hourStart = new Date(now.getTime() - i * 3600e3);
    hourStart.setMinutes(0, 0, 0);
    const hourEnd = new Date(hourStart.getTime() + 3600e3);
    const row = db.prepare(`
      SELECT COALESCE(SUM(amountUsd), 0) AS total
      FROM usage_log
      WHERE userId = ?
        AND eventType = 'consume'
        AND createdAt >= ? AND createdAt < ?
    `).get(userId, hourStart.toISOString(), hourEnd.toISOString()) as { total: number };
    buckets.push({
      hour: `${hourStart.getUTCHours().toString().padStart(2, '0')}:00`,
      consumed: row.total ?? 0,
    });
  }
  return buckets;
}

export function getUsageForUser(userId: string, opts: { limit?: number; offset?: number; eventTypes?: EventType[]; from?: string; to?: string } = {}): UsageRecord[] {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  let where = `userId = ?`;
  const params: unknown[] = [userId];
  if (opts.eventTypes?.length) {
    where += ` AND eventType IN (${opts.eventTypes.map(() => '?').join(',')})`;
    params.push(...opts.eventTypes);
  }
  if (opts.from) { where += ` AND createdAt >= ?`; params.push(opts.from); }
  if (opts.to) { where += ` AND createdAt <= ?`; params.push(opts.to); }
  return db.prepare(`SELECT * FROM usage_log WHERE ${where} ORDER BY createdAt DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as UsageRecord[];
}
