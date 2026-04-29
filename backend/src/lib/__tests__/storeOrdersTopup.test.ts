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
