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

export type OrderStatus = "pending" | "paid" | "expired" | "failed";
export type PaymentChannel = "epusdt" | "xunhupay";
export type PlanId = "basic" | "standard" | "pro";

export interface OrderRecord {
  orderId: string;
  userId: string;
  planId: PlanId;
  channel: PaymentChannel;
  amountCNY: number;
  amountActual?: number;
  status: OrderStatus;
  upstreamTradeId?: string;
  upstreamPaymentUrl?: string;
  blockTxId?: string;
  receiveAddress?: string;
  createdAt: string;
  paidAt?: string;
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

  CREATE TABLE IF NOT EXISTS orders (
    orderId            TEXT PRIMARY KEY,
    userId             TEXT NOT NULL,
    planId             TEXT NOT NULL,
    channel            TEXT NOT NULL,
    amountCNY          REAL NOT NULL,
    amountActual       REAL,
    status             TEXT NOT NULL,
    upstreamTradeId    TEXT,
    upstreamPaymentUrl TEXT,
    blockTxId          TEXT,
    receiveAddress     TEXT,
    createdAt          TEXT NOT NULL,
    paidAt             TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_orders_user
    ON orders(userId, createdAt DESC);
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

  insertOrder: db.prepare(`
    INSERT INTO orders
      (orderId, userId, planId, channel, amountCNY, amountActual, status,
       upstreamTradeId, upstreamPaymentUrl, blockTxId, receiveAddress,
       createdAt, paidAt)
    VALUES
      (@orderId, @userId, @planId, @channel, @amountCNY, @amountActual, @status,
       @upstreamTradeId, @upstreamPaymentUrl, @blockTxId, @receiveAddress,
       @createdAt, @paidAt)
  `),
  getOrder: db.prepare(`SELECT * FROM orders WHERE orderId = ?`),
  listOrdersByUser: db.prepare(
    `SELECT * FROM orders WHERE userId = ? ORDER BY createdAt DESC LIMIT ?`,
  ),
  attachUpstream: db.prepare(`
    UPDATE orders
       SET upstreamTradeId = @upstreamTradeId,
           upstreamPaymentUrl = @upstreamPaymentUrl,
           amountActual = @amountActual
     WHERE orderId = @orderId
  `),
  // Conditional update: only flip pending→paid. RowsChanged=0 means the
  // row was already paid (or expired/failed) — duplicate webhooks become
  // no-ops, giving us idempotent settlement.
  markPaidIfPending: db.prepare(`
    UPDATE orders
       SET status = 'paid',
           paidAt = @paidAt,
           amountActual = COALESCE(@amountActual, amountActual),
           blockTxId = COALESCE(@blockTxId, blockTxId),
           receiveAddress = COALESCE(@receiveAddress, receiveAddress)
     WHERE orderId = @orderId AND status = 'pending'
  `),
  markStatus: db.prepare(`
    UPDATE orders
       SET status = @status
     WHERE orderId = @orderId AND status = 'pending'
  `),
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

function rowToOrder(row: Record<string, unknown>): OrderRecord {
  return {
    orderId: row.orderId as string,
    userId: row.userId as string,
    planId: row.planId as PlanId,
    channel: row.channel as PaymentChannel,
    amountCNY: row.amountCNY as number,
    amountActual: (row.amountActual as number) ?? undefined,
    status: row.status as OrderStatus,
    upstreamTradeId: (row.upstreamTradeId as string) ?? undefined,
    upstreamPaymentUrl: (row.upstreamPaymentUrl as string) ?? undefined,
    blockTxId: (row.blockTxId as string) ?? undefined,
    receiveAddress: (row.receiveAddress as string) ?? undefined,
    createdAt: row.createdAt as string,
    paidAt: (row.paidAt as string) ?? undefined,
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

// ---------- Orders ----------

export async function createOrder(rec: OrderRecord): Promise<void> {
  stmts.insertOrder.run({
    orderId: rec.orderId,
    userId: rec.userId,
    planId: rec.planId,
    channel: rec.channel,
    amountCNY: rec.amountCNY,
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
  const row = stmts.getOrder.get(orderId) as Record<string, unknown> | undefined;
  return row ? rowToOrder(row) : null;
}

export async function listOrdersByUser(
  userId: string,
  limit = 50,
): Promise<OrderRecord[]> {
  const rows = stmts.listOrdersByUser.all(userId, limit) as Record<string, unknown>[];
  return rows.map(rowToOrder);
}

export async function attachUpstreamFields(args: {
  orderId: string;
  upstreamTradeId: string;
  upstreamPaymentUrl: string;
  amountActual: number;
}): Promise<void> {
  stmts.attachUpstream.run(args);
}

/**
 * Settle a payment. Returns true on the first successful pending→paid
 * transition; subsequent calls (duplicate webhooks) return false without
 * mutating the row. Callers use this to decide whether to credit balance.
 */
export async function markOrderPaidIfPending(args: {
  orderId: string;
  paidAt: string;
  amountActual?: number;
  blockTxId?: string;
  receiveAddress?: string;
}): Promise<boolean> {
  const result = stmts.markPaidIfPending.run({
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
  const result = stmts.markStatus.run(args);
  return result.changes > 0;
}
