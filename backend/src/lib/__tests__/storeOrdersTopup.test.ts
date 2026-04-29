import { describe, it, expect, beforeAll } from 'vitest';

process.env.SESSION_SECRET = 'test-secret-32bytes-min-aaaaaaaaaaa';
process.env.SQLITE_PATH = ':memory:';

import { init, db, createOrder, getOrder, type OrderRecord } from '../store.js';

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
});
