import { describe, it, expect, beforeAll } from 'vitest';

process.env.SESSION_SECRET = 'test-secret-32bytes-min-aaaaaaaaaaa';
process.env.SQLITE_PATH = ':memory:';

import { init, db, createOrder, getOrder, markOrderSettleStatus, type OrderRecord } from '../store.js';

beforeAll(() => {
  init();
});

describe('orders table — topup schema', () => {
  it('has skuType / topupAmountUsd / settleStatus columns', () => {
    const cols = db.prepare(`PRAGMA table_info(orders)`).all() as { name: string }[];
    const names = new Set(cols.map((c) => c.name));
    expect(names.has('skuType')).toBe(true);
    expect(names.has('topupAmountUsd')).toBe(true);
    expect(names.has('settleStatus')).toBe(true);
  });

  it('round-trips a topup order', async () => {
    const rec: OrderRecord = {
      orderId: 'tb_ord_topup_a',
      userId: 'u_test',
      skuType: 'topup',
      channel: 'xunhupay',
      amount: 100,
      currency: 'CNY',
      topupAmountUsd: 100,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    await createOrder(rec);
    const back = await getOrder('tb_ord_topup_a');
    expect(back?.skuType).toBe('topup');
    expect(back?.topupAmountUsd).toBe(100);
    expect(back?.settleStatus).toBeUndefined();
  });

  it('round-trips a plan order without topup fields', async () => {
    const rec: OrderRecord = {
      orderId: 'tb_ord_plan_a',
      userId: 'u_test',
      skuType: 'plan_plus',
      channel: 'xunhupay',
      amount: 288,
      currency: 'CNY',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    await createOrder(rec);
    const back = await getOrder('tb_ord_plan_a');
    expect(back?.skuType).toBe('plan_plus');
    expect(back?.topupAmountUsd).toBeUndefined();
  });
});

describe('orders table — backfill migration', () => {
  it('backfills skuType from legacy planId on re-init', async () => {
    // Insert as if from old schema (skuType column exists but is NULL)
    db.prepare(
      `INSERT INTO orders (orderId, userId, planId, channel, amountCNY, currency, status, createdAt) VALUES (?,?,?,?,?,?,?,?)`,
    ).run('legacy_super', 'u_test_bf', 'super', 'xunhupay', 688, 'CNY', 'paid', new Date().toISOString());

    init();

    const back = await getOrder('legacy_super');
    expect(back?.skuType).toBe('plan_super');
  });

  it('does not overwrite an already-populated skuType on re-init', async () => {
    db.prepare(
      `INSERT INTO orders (orderId, userId, planId, skuType, topupAmountUsd, channel, amountCNY, currency, status, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run('explicit_topup', 'u_test_bf', null, 'topup', 50, 'xunhupay', 50, 'CNY', 'paid', new Date().toISOString());

    init();

    const back = await getOrder('explicit_topup');
    expect(back?.skuType).toBe('topup');
    expect(back?.topupAmountUsd).toBe(50);
  });

  it("deriveSkuType maps legacy planId='topup' back to skuType='topup' when skuType is NULL", async () => {
    // Defense in depth: createOrder always writes both columns, but if a row
    // ever ends up with skuType=NULL and planId='topup' (manual SQL, partial
    // migration), the rowToOrder fallback should recognize the placeholder
    // instead of defaulting to 'plan_plus'.
    db.prepare(
      `INSERT INTO orders (orderId, userId, planId, skuType, topupAmountUsd, channel, amountCNY, currency, status, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run('orphan_topup', 'u_test_bf', 'topup', null, 75, 'xunhupay', 75, 'CNY', 'paid', new Date().toISOString());

    const back = await getOrder('orphan_topup');
    expect(back?.skuType).toBe('topup');
  });
});

describe('markOrderSettleStatus', () => {
  it('flips settleStatus only on topup orders', async () => {
    const now = new Date().toISOString();
    await createOrder({
      orderId: 'tb_ord_settle_a',
      userId: 'u_test',
      skuType: 'topup',
      channel: 'xunhupay',
      amount: 50,
      currency: 'CNY',
      topupAmountUsd: 50,
      status: 'paid',
      createdAt: now,
      paidAt: now,
    });

    const ok = await markOrderSettleStatus({
      orderId: 'tb_ord_settle_a',
      settleStatus: 'settled',
    });
    expect(ok).toBe(true);
    const back = await getOrder('tb_ord_settle_a');
    expect(back?.settleStatus).toBe('settled');
  });

  it('returns false when the order does not exist', async () => {
    const ok = await markOrderSettleStatus({
      orderId: 'tb_ord_does_not_exist',
      settleStatus: 'failed',
    });
    expect(ok).toBe(false);
  });
});
