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

// ---------- Database init ----------

const DB_PATH = process.env.DATABASE_PATH ?? "data/tokenboss.db";

function ensureDir(filePath: string) {
  const dir = dirname(filePath);
  if (dir && dir !== "." && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

ensureDir(DB_PATH);

const db = new Database(DB_PATH);

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

// ---------- Prepared statements ----------

const stmts = {
  getUser: db.prepare(`SELECT * FROM users WHERE userId = ?`),
  putUser: db.prepare(`
    INSERT OR REPLACE INTO users
      (userId, displayName, email, phone, passwordHash, createdAt, newapiUserId, newapiPassword)
    VALUES
      (@userId, @displayName, @email, @phone, @passwordHash, @createdAt, @newapiUserId, @newapiPassword)
  `),
  getUserByEmail: db.prepare(`SELECT userId FROM users WHERE email = ?`),
};

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

// ---------- Public API ----------

export async function getUser(userId: string): Promise<UserRecord | null> {
  const row = stmts.getUser.get(userId) as Record<string, unknown> | undefined;
  return row ? rowToUser(row) : null;
}

export async function putUser(rec: UserRecord): Promise<void> {
  stmts.putUser.run({
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

export async function getUserIdByEmail(email: string): Promise<string | null> {
  const norm = email.trim().toLowerCase();
  if (!norm) return null;
  const row = stmts.getUserByEmail.get(norm) as { userId: string } | undefined;
  return row?.userId ?? null;
}

export async function putEmailIndex(_email: string, _userId: string): Promise<void> {
  // Email uniqueness is enforced by the UNIQUE index on users.email.
  // This function is kept for API compatibility but is now a no-op —
  // the email is written as part of putUser().
}
