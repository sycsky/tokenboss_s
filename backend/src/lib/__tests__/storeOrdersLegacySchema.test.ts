/**
 * Regression test for production schema where `orders.planId` is still
 * `TEXT NOT NULL` (legacy V2 era). The codebase shipped a CREATE TABLE
 * change to make planId nullable, but `CREATE TABLE IF NOT EXISTS` is a
 * no-op against existing tables and there is no ALTER migration that
 * relaxes the constraint — so the production DB still rejects null.
 *
 * The fix in createOrder() writes a non-null planId placeholder for topup
 * orders ('topup'), so plan and topup INSERTs go through the same path
 * regardless of whether the DB schema has been re-created.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SESSION_SECRET = 'test-secret-32bytes-min-aaaaaaaaaaa';

const tmpDir = mkdtempSync(join(tmpdir(), 'tb-legacy-schema-'));
const dbPath = join(tmpDir, 'orders.db');
process.env.SQLITE_PATH = dbPath;

// Pre-create the legacy production schema BEFORE store.ts loads.
// Mirrors the V2 orders table: planId is TEXT NOT NULL, no skuType /
// topupAmountUsd / settleStatus / currency columns yet.
{
  const seed = new Database(dbPath);
  seed.exec(`
    CREATE TABLE orders (
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
  `);
  seed.close();
}

// Dynamic import AFTER the env + seed above. Static `import` declarations
// are hoisted by the JS spec, which would load store.ts (and run its
// module-level init()) before SQLITE_PATH is set, opening the wrong DB.
const { createOrder, getOrder, db } = await import('../store.js');
import type { OrderRecord } from '../store.js';

afterAll(() => {
  try { db.close(); } catch {}
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('orders table — legacy production schema (planId NOT NULL)', () => {
  it('preserves the legacy NOT NULL constraint on planId', () => {
    const cols = db
      .prepare(`PRAGMA table_info(orders)`)
      .all() as { name: string; notnull: number }[];
    const planIdCol = cols.find((c) => c.name === 'planId');
    expect(planIdCol).toBeDefined();
    expect(planIdCol!.notnull).toBe(1);
  });

  it('createOrder() succeeds for a topup order despite the legacy NOT NULL planId', async () => {
    const rec: OrderRecord = {
      orderId: 'tb_legacy_topup',
      userId: 'u_legacy',
      skuType: 'topup',
      channel: 'xunhupay',
      amount: 50,
      currency: 'CNY',
      topupAmountUsd: 50,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    await expect(createOrder(rec)).resolves.toBeUndefined();

    const back = await getOrder('tb_legacy_topup');
    expect(back?.skuType).toBe('topup');
    expect(back?.topupAmountUsd).toBe(50);

    // Raw column assertion — verify the literal placeholder value, not just
    // "non-null garbage". This is the contract createOrder() commits to:
    // topup orders write `planId='topup'` to satisfy the legacy NOT NULL.
    const rawTopup = db
      .prepare(`SELECT planId FROM orders WHERE orderId = ?`)
      .get('tb_legacy_topup') as { planId: string };
    expect(rawTopup.planId).toBe('topup');
  });

  it('createOrder() still works for plan orders on the legacy schema', async () => {
    const rec: OrderRecord = {
      orderId: 'tb_legacy_plan',
      userId: 'u_legacy',
      skuType: 'plan_super',
      channel: 'xunhupay',
      amount: 688,
      currency: 'CNY',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    await createOrder(rec);

    const back = await getOrder('tb_legacy_plan');
    expect(back?.skuType).toBe('plan_super');

    // Raw column assertion — plan orders write the short plan tag so the
    // legacy column still matches the historical 'plus'|'super'|'ultra' shape.
    const rawPlan = db
      .prepare(`SELECT planId FROM orders WHERE orderId = ?`)
      .get('tb_legacy_plan') as { planId: string };
    expect(rawPlan.planId).toBe('super');
  });
});
