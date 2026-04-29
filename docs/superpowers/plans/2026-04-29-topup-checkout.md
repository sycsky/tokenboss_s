# 充值 self-checkout (topup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户通过现有的支付宝（xunhupay）+ USDT-TRC20（epusdt）两条支付渠道完成自助充值，金额按 ¥1=$1 整数计费，最低 ¥1/$1，落账到 newapi 用户 quota，永不过期、解锁全模型。

**Architecture:**
- 复用现有 `POST /v1/billing/orders` endpoint，新增 `type` 字段做 plan vs topup 显式分支；OrderRecord 加 `skuType / topupAmountUsd / settleStatus` 三列
- 充值落账走 "admin 铸 redemption code → 后端代用户兑换" 两步原子流程，复用 `redeemHandler` 已跑通的 newapi `/api/user/topup` 路径
- 前端新建 `Topup.tsx`，从 `Payment.tsx` 抽出 `ChannelOption` + `checkoutFlow` 共享给两个页面

**Tech Stack:** TypeScript + better-sqlite3 + AWS Lambda 风格 handler；frontend 是 React + Vite + react-router；测试是 vitest

**Spec:** `docs/superpowers/specs/2026-04-29-topup-checkout-design.md`

---

## File Structure

**Backend (新增 / 修改):**
- Modify: `backend/src/lib/store.ts` — orders 表加 3 列 + migration + mappers + 新 `markOrderSettleStatus` helper
- Modify: `backend/src/lib/payment/types.ts` — `OrderSkuType` 类型 + OrderRecord 字段
- Modify: `backend/src/lib/newapi.ts` — 新增 `createRedemption` admin wrapper
- Modify: `backend/src/handlers/paymentHandlers.ts` — `createOrderHandler` 按 body.type 分支，topup 走金额校验 + 派生 currency
- Modify: `backend/src/handlers/paymentWebhook.ts` — settle 后按 `order.skuType` 分发到 `applyTopupToUser`
- Modify: `backend/src/handlers/__tests__/paymentHandlers.test.ts` — 加 topup 校验 case
- Create: `backend/src/handlers/__tests__/paymentWebhookTopup.test.ts` — webhook → mint → redeem → settle 流

**Frontend (新增 / 修改):**
- Create: `frontend/src/components/ChannelOption.tsx` — 从 Payment.tsx 抽出来的共享渠道选择卡
- Create: `frontend/src/lib/checkoutFlow.ts` — 下单后跳转/弹 QR 的共享 util
- Create: `frontend/src/screens/Topup.tsx` — 充值页（金额档位 + 自定义 + 渠道 + 兑换码链接）
- Modify: `frontend/src/App.tsx` — 加 `/billing/topup` 路由
- Modify: `frontend/src/lib/api.ts` — `BillingSkuType` 类型 + `createOrder` 接受 type=topup body
- Modify: `frontend/src/screens/Payment.tsx` — 消费抽出的 ChannelOption + checkoutFlow；已订阅 lockout 加 "+ 加买充值额度"
- Modify: `frontend/src/screens/Topup.tsx` 内嵌 RedeemCodeModal 触发链接（已存在的 component 不动）
- Modify: `frontend/src/screens/Plans.tsx` — `standardCta` 改成跳 /billing/topup
- Modify: `frontend/src/screens/Dashboard.tsx` — paid 用户的 "充值额度" 改跳 /billing/topup；no-sub 用户加 "+ 充值额度" 副链接
- Modify: `frontend/src/screens/OrderStatus.tsx` — topup 订单的 hero 文案 + Row label 适配

**Docs:**
- Modify: `docs/订阅测试指南.md` — 追加充值 e2e 测试章节

---

## Task 1: OrderRecord 类型与 SQLite 迁移

**Files:**
- Modify: `backend/src/lib/payment/types.ts`
- Modify: `backend/src/lib/store.ts:62-92` (types) + `:243-280` (DDL + migration)
- Test: `backend/src/lib/__tests__/storeOrdersTopup.test.ts` (new)

- [ ] **Step 1: 写迁移 + schema 失败测试**

Create `backend/src/lib/__tests__/storeOrdersTopup.test.ts`:

```typescript
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx vitest run src/lib/__tests__/storeOrdersTopup.test.ts`
Expected: FAIL — `skuType` column missing AND TypeScript errors on `OrderRecord.skuType / topupAmountUsd`.

- [ ] **Step 3: 修改 `backend/src/lib/payment/types.ts`**

Replace `OrderRecord` interface (and re-export the new sku type):

```typescript
/**
 * Payment domain types — shared across channels (epusdt + xunhupay) and
 * across order kinds (套餐 plans + 一次性充值 topup).
 *
 * Channels are pluggable: each one implements `PaymentChannelClient` so the
 * handlers can dispatch by channel without knowing the wire format.
 *
 * Order kinds are discriminated by `skuType`. plan_* orders activate a
 * subscription via newapi.bindSubscription on settle; topup orders mint a
 * one-shot redemption code on newapi admin and apply it to the user's quota.
 */

export type PaymentChannel = "epusdt" | "xunhupay";

export type OrderStatus = "pending" | "paid" | "expired" | "failed";

export type OrderCurrency = "CNY" | "USD";

/** Discriminator for what kind of thing the order is buying. Mirrors the
 *  bucket sku_type vocabulary in credits-economy spec § Implementation. */
export type OrderSkuType =
  | "plan_plus"
  | "plan_super"
  | "plan_ultra"
  | "topup";

/** "我方落账到 newapi 的结果"。Plan orders use bindSubscription which is
 *  near-atomic on newapi side, so settleStatus is left undefined for them.
 *  Topup orders go through the mint+redeem flow — we mark `settled` on
 *  success so `failed` rows can be filtered for ops follow-up. */
export type OrderSettleStatus = "settled" | "failed";

// PlanId is still the source of truth in lib/plans.ts for the plan-only
// surface (pricing, bindSubscription mapping). OrderRecord no longer
// references PlanId directly — it uses OrderSkuType.
export type { PlanId } from "../plans.js";
import type { PlanId as _PlanId } from "../plans.js";

export interface OrderRecord {
  orderId: string;
  userId: string;
  /** What the order is buying. */
  skuType: OrderSkuType;
  channel: PaymentChannel;
  /** Quoted amount in `currency` (CNY for xunhupay, USD for epusdt). */
  amount: number;
  /** Currency the `amount` is denominated in. */
  currency: OrderCurrency;
  /** Channel-side actual settled amount (USDT for epusdt, same as
   *  amount for xunhupay). */
  amountActual?: number;
  /** USD value to credit on topup orders. ¥1 = $1, so equals `amount`
   *  when currency=CNY, and equals `amount` when currency=USD. Stored
   *  separately so settle can be 100% certain about $ delta even if
   *  `amount`/`currency` ever drift. Undefined for plan orders. */
  topupAmountUsd?: number;
  status: OrderStatus;
  /** Set on topup orders after the webhook has attempted to apply credits.
   *  Undefined while the order is still pending or for plan orders. */
  settleStatus?: OrderSettleStatus;
  /** Channel-side trade id (epusdt: trade_id; xunhupay: open_order_id). */
  upstreamTradeId?: string;
  /** URL to redirect the user to (checkout counter for epusdt). */
  upstreamPaymentUrl?: string;
  /** TRON / chain transaction id, only set for crypto channels on success. */
  blockTxId?: string;
  /** Wallet address the user paid into (epusdt only). */
  receiveAddress?: string;
  createdAt: string;
  paidAt?: string;
}

export interface CreateOrderInput {
  orderId: string;
  /** Quoted amount in `currency`. epusdt: USD; xunhupay: CNY. */
  amount: number;
  currency: OrderCurrency;
  /** SKU label mostly for upstream subject / order title. Plan orders pass
   *  the plan id; topup orders pass the literal "topup". */
  skuLabel: string;
  notifyUrl: string;
  redirectUrl?: string;
}

export interface CreateOrderResult {
  upstreamTradeId: string;
  paymentUrl: string;
  /** Direct QR-code image URL when the channel exposes one (xunhupay).
   *  Lets the frontend render the QR inline on PC instead of routing the
   *  user to the gateway's hosted checkout page. */
  qrCodeUrl?: string;
  amountActual: number;
  expiresAt: number;
}

/** Minimal channel-agnostic interface — handlers code against this. */
export interface PaymentChannelClient {
  createOrder(input: CreateOrderInput): Promise<CreateOrderResult>;
  /**
   * Verify and parse a webhook payload. Returns null when verification
   * fails — handlers must reject with 403 in that case.
   */
  verifyCallback(payload: Record<string, unknown>): WebhookEvent | null;
}

export interface WebhookEvent {
  orderId: string;
  upstreamTradeId: string;
  amountActual: number;
  status: OrderStatus;
  blockTxId?: string;
  receiveAddress?: string;
}

// Note: we keep the old `_PlanId` import alive only as a re-export above.
// Internally, OrderRecord no longer carries planId. Code that needs to talk
// to bindSubscription should derive the planId from skuType via
// `skuTypeToPlanId(skuType)` in plans.ts (added in Task 4).
void (null as _PlanId | null);
```

- [ ] **Step 4: 修改 `backend/src/lib/store.ts` — orders DDL + migration + mappers**

In `init()` replace the orders DDL block (currently lines 242-279) with:

```typescript
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      orderId            TEXT PRIMARY KEY,
      userId             TEXT NOT NULL,
      planId             TEXT,                      -- legacy; nullable now (back-compat for rollback)
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

  // Rename legacy plan ids → new tier names (kept for safety).
  db.exec(`
    UPDATE orders SET planId = CASE planId
      WHEN 'basic'    THEN 'plus'
      WHEN 'standard' THEN 'super'
      WHEN 'pro'      THEN 'ultra'
      ELSE planId
    END
  `);
```

Replace `rowToOrder` (currently lines 307-327) with:

```typescript
function rowToOrder(row: Record<string, unknown>): OrderRecord {
  return {
    orderId: row.orderId as string,
    userId: row.userId as string,
    // Backfill rule: if the row predates the skuType column AND somehow
    // also has no planId, treat as plan_plus (safest historical default).
    skuType: ((row.skuType as string) ??
      (row.planId ? `plan_${row.planId}` : 'plan_plus')) as OrderRecord['skuType'],
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
```

Add the import line near the existing imports if not present:

```typescript
// At the top of store.ts, add:
import type { OrderSkuType, OrderSettleStatus, OrderRecord as _OR } from "./payment/types.js";
```

(Keep `OrderRecord` exported from store.ts via `export type { OrderRecord } from "./payment/types.js";` if not already — see Step 5.)

Replace `createOrder` (currently lines 575-601) with:

```typescript
export async function createOrder(rec: OrderRecord): Promise<void> {
  // planId column is kept for back-compat / rollback. Derive from skuType
  // when the order is a plan_* SKU; null for topup.
  const legacyPlanId = rec.skuType.startsWith('plan_')
    ? rec.skuType.replace(/^plan_/, '')
    : null;
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
```

- [ ] **Step 5: 同步 store.ts 顶部的 OrderRecord 类型出口**

Replace the legacy `OrderRecord` interface in store.ts (currently lines 68-92) with a re-export:

```typescript
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

// We still need the *value-position* type aliases below so that local
// `as PaymentChannel` casts in rowToOrder compile. Pure type imports.
import type {
  OrderCurrency,
  OrderRecord,
  OrderStatus,
  PaymentChannel,
} from "./payment/types.js";
```

(Confirm the rest of `store.ts` no longer references the old `import type { PlanId } from "./plans.js"` directly at module top — it's fine to keep it for `setUserPlan` which still uses `UserPlan`.)

- [ ] **Step 6: 跑测试确认通过**

Run: `cd backend && npx vitest run src/lib/__tests__/storeOrdersTopup.test.ts`
Expected: PASS (all 3 tests).

Run the wider test suite:
`cd backend && npx vitest run`
Expected: green; the existing `paymentHandlers.test.ts` may now have a TypeScript error because `planId` is no longer on OrderRecord. We fix that in Task 4 — for now, if it compiles, it should still pass at runtime (sold-out gate goes through `body.planId`, not `OrderRecord.planId`).

- [ ] **Step 7: Commit**

```bash
git add backend/src/lib/payment/types.ts backend/src/lib/store.ts backend/src/lib/__tests__/storeOrdersTopup.test.ts
git commit -m "feat(orders): add skuType/topupAmountUsd/settleStatus columns

OrderRecord now carries skuType (plan_plus|plan_super|plan_ultra|topup) +
topup-specific fields. planId column kept (nullable) for rollback safety;
backfill UPDATE migrates existing rows."
```

---

## Task 2: store helper for marking topup settle status

**Files:**
- Modify: `backend/src/lib/store.ts` (add new helper)
- Test: `backend/src/lib/__tests__/storeOrdersTopup.test.ts` (extend)

- [ ] **Step 1: 写失败测试**

Append to `backend/src/lib/__tests__/storeOrdersTopup.test.ts`:

```typescript
import { markOrderSettleStatus } from '../store.js';

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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx vitest run src/lib/__tests__/storeOrdersTopup.test.ts`
Expected: FAIL — `markOrderSettleStatus` is not exported.

- [ ] **Step 3: 实现 helper**

Append to `backend/src/lib/store.ts` (right after `markOrderStatus`):

```typescript
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npx vitest run src/lib/__tests__/storeOrdersTopup.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/store.ts backend/src/lib/__tests__/storeOrdersTopup.test.ts
git commit -m "feat(store): add markOrderSettleStatus for topup webhook"
```

---

## Task 3: newapi.createRedemption admin wrapper

**Files:**
- Modify: `backend/src/lib/newapi.ts`
- Test: `backend/src/lib/__tests__/newapiRedemption.test.ts` (new)

- [ ] **Step 1: 写失败测试**

Create `backend/src/lib/__tests__/newapiRedemption.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.NEWAPI_BASE_URL = 'http://newapi.test.local';
process.env.NEWAPI_ADMIN_TOKEN = 'admin-token-test';

import { newapi } from '../newapi.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
});

describe('newapi.createRedemption', () => {
  it('POSTs the right body and returns the freshly minted code', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () =>
        JSON.stringify({
          success: true,
          message: '',
          data: ['11111111-2222-3333-4444-555555555555'],
        }),
    } as unknown as Response);

    const code = await newapi.createRedemption({
      name: 'tb_topup_ord_abc',
      quotaUsd: 100,
    });

    expect(code).toBe('11111111-2222-3333-4444-555555555555');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://newapi.test.local/api/redemption');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.name).toBe('tb_topup_ord_abc');
    expect(body.count).toBe(1);
    expect(body.quota).toBe(100 * 500_000); // $1 = 500_000 quota units
    expect(body.expired_time).toBe(0); // never expire
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('admin-token-test');
  });

  it('throws NewapiError when newapi returns success=false', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () =>
        JSON.stringify({ success: false, message: 'redemption count too large', data: [] }),
    } as unknown as Response);

    await expect(
      newapi.createRedemption({ name: 'tb_t', quotaUsd: 1 }),
    ).rejects.toThrow(/redemption count too large/);
  });

  it('truncates name to 20 chars (newapi limit)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () =>
        JSON.stringify({ success: true, message: '', data: ['code-x'] }),
    } as unknown as Response);

    await newapi.createRedemption({
      name: 'a'.repeat(40),
      quotaUsd: 1,
    });
    const init = fetchMock.mock.calls[0][1];
    const body = JSON.parse(init.body);
    expect(body.name.length).toBe(20);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx vitest run src/lib/__tests__/newapiRedemption.test.ts`
Expected: FAIL — `newapi.createRedemption` is not defined.

- [ ] **Step 3: 实现 createRedemption**

Open `backend/src/lib/newapi.ts`. Find the `// --- User management (admin) ---` section (around line 289) and add a new public method to the `newapi` object. Insert this method right after `updateUser` (around line 360):

```typescript
  // --- Redemption codes (admin) ---

  /**
   * Mint a one-shot redemption code on newapi's admin side. We use this in
   * the topup webhook flow: each settled topup order mints a code worth
   * `quotaUsd × 500_000` quota units, then immediately calls
   * `redeemCode` on behalf of the user to apply it. Two atomic newapi
   * operations replace a single read-modify-write `updateUser` that would
   * race against the user's own API consumption.
   *
   * The redemption is permanent (`expired_time=0`). `count` is fixed at 1
   * since each order mints exactly one code; the upstream limit is 100.
   *
   * `name` is what shows up in the newapi admin's redemption list, so pass
   * something traceable like the orderId. newapi caps it at 20 runes —
   * we truncate here so callers don't have to.
   */
  async createRedemption(input: {
    name: string;
    quotaUsd: number;
  }): Promise<string> {
    const { baseUrl, adminToken, adminUserId } = getConfig();
    const name = input.name.slice(0, 20); // newapi cap, see redemption.go:68
    const quota = Math.round(input.quotaUsd * 500_000);
    const res = await nfetch(`${baseUrl}/api/redemption`, {
      method: "POST",
      headers: {
        authorization: adminToken,
        "new-api-user": String(adminUserId),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name,
        count: 1,
        quota,
        expired_time: 0,
      }),
    });
    const parsed = await readJsonResponse<{
      success?: boolean;
      message?: string;
      data?: string[];
    }>(res, "createRedemption");
    if (!res.ok || !parsed.success || !Array.isArray(parsed.data) || parsed.data.length === 0) {
      throw new NewapiError(
        res.status || 500,
        parsed.message ?? "createRedemption failed",
      );
    }
    return parsed.data[0]!;
  },
```

(`getConfig`, `nfetch`, `readJsonResponse`, and `NewapiError` are already in scope at the top of `newapi.ts`. If the test reveals a different config-fn name like `getNewapiConfig`, use whatever the file actually has — don't invent.)

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npx vitest run src/lib/__tests__/newapiRedemption.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/newapi.ts backend/src/lib/__tests__/newapiRedemption.test.ts
git commit -m "feat(newapi): add createRedemption admin wrapper

Mints a one-shot, never-expiring redemption code worth quotaUsd × 500_000.
Used by the upcoming topup webhook flow so we never read-modify-write the
user's quota directly."
```

---

## Task 4: createOrderHandler 加 type=topup 分支

**Files:**
- Modify: `backend/src/lib/plans.ts` (small helper)
- Modify: `backend/src/handlers/paymentHandlers.ts`
- Modify: `backend/src/handlers/__tests__/paymentHandlers.test.ts`

- [ ] **Step 1: 写失败测试 (plan back-compat + topup happy path + topup validation)**

Replace the contents of `backend/src/handlers/__tests__/paymentHandlers.test.ts`. Keep existing sold-out tests; add a new describe block underneath. The full file should look like:

```typescript
/**
 * paymentHandlers tests — covers the synchronous validation branches
 * (sold-out gate, type discriminator, topup amount checks). The full
 * upstream call paths (xunhupay/epusdt) require a live gateway and live
 * in scripts/probe-* end-to-end.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

process.env.SESSION_SECRET = 'test-secret-32bytes-min-aaaaaaaaaaa';

import { init, putUser } from '../../lib/store.js';
import { signSession } from '../../lib/authTokens.js';
import { createOrderHandler } from '../paymentHandlers.js';

const userId = 'u_test_paymenthandlers';
let token: string;

beforeAll(() => {
  process.env.SQLITE_PATH = ':memory:';
  init();
  putUser({
    userId,
    email: 'pay@test.local',
    createdAt: new Date().toISOString(),
  });
  token = signSession(userId);
});

beforeEach(() => {
  process.env.PUBLIC_BASE_URL = 'https://api.test.local';
});

function makePostEvent(body: Record<string, unknown>) {
  return {
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as unknown as Parameters<typeof createOrderHandler>[0];
}

async function run(body: Record<string, unknown>) {
  return (await createOrderHandler(makePostEvent(body))) as APIGatewayProxyStructuredResultV2;
}

describe('createOrderHandler — sold-out gate', () => {
  it('returns 410 plan_unavailable when the requested plan is sold out (Ultra)', async () => {
    const res = await run({ planId: 'ultra', channel: 'xunhupay' });
    expect(res.statusCode).toBe(410);
    const body = JSON.parse(res.body as string);
    expect(body.error.type).toBe('plan_unavailable');
    expect(body.error.code).toBe('plan_sold_out');
    expect(body.error.message).toContain('Ultra');
  });

  it('410 sold-out fires regardless of channel selection', async () => {
    const epusdt = await run({ planId: 'ultra', channel: 'epusdt' });
    expect(epusdt.statusCode).toBe(410);
    const xunhupay = await run({ planId: 'ultra', channel: 'xunhupay' });
    expect(xunhupay.statusCode).toBe(410);
  });

  it('does NOT 410 for non-sold-out plans (Plus, Super)', async () => {
    const plus = await run({ planId: 'plus', channel: 'xunhupay' });
    expect(plus.statusCode).not.toBe(410);
    const sup = await run({ planId: 'super', channel: 'epusdt' });
    expect(sup.statusCode).not.toBe(410);
  });

  it('still validates planId / channel before checking sold-out', async () => {
    const badPlan = await run({ planId: 'fake', channel: 'xunhupay' });
    expect(badPlan.statusCode).toBe(400);
    const badChannel = await run({ planId: 'ultra', channel: 'paypal' });
    expect(badChannel.statusCode).toBe(400);
  });
});

describe('createOrderHandler — type discriminator', () => {
  it('defaults to type="plan" when omitted (back-compat)', async () => {
    // Plus is not sold out → 410 ruled out. Without payment gateway env it
    // falls through to 503 on the channel client. The point: not 400.
    const res = await run({ planId: 'plus', channel: 'xunhupay' });
    expect(res.statusCode).not.toBe(400);
  });

  it('rejects unknown type value', async () => {
    const res = await run({ type: 'subscription', planId: 'plus', channel: 'xunhupay' });
    expect(res.statusCode).toBe(400);
  });
});

describe('createOrderHandler — type=topup validation', () => {
  it('400 invalid_amount when amount missing', async () => {
    const res = await run({ type: 'topup', channel: 'xunhupay' });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('invalid_amount');
  });

  it('400 invalid_amount when amount is not an integer', async () => {
    for (const amount of [1.5, 0, -10, 100000, NaN, '10']) {
      const res = await run({ type: 'topup', amount, channel: 'xunhupay' });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body as string);
      expect(body.error.code).toBe('invalid_amount');
    }
  });

  it('accepts integer amount in valid range and proceeds past validation', async () => {
    // No payment gateway configured in test env → expect 503 on the
    // channel client step, NOT 400/410. This proves validation passed.
    const res = await run({ type: 'topup', amount: 100, channel: 'xunhupay' });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(410);
  });

  it('ignores client-supplied currency (server derives from channel)', async () => {
    const res = await run({
      type: 'topup',
      amount: 100,
      channel: 'xunhupay',
      currency: 'USD', // adversarial — should be silently ignored
    });
    expect(res.statusCode).not.toBe(400);
  });

  it('ignores planId on topup orders', async () => {
    const res = await run({
      type: 'topup',
      amount: 100,
      channel: 'xunhupay',
      planId: 'ultra', // adversarial — should not trigger sold-out gate
    });
    expect(res.statusCode).not.toBe(410);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx vitest run src/handlers/__tests__/paymentHandlers.test.ts`
Expected: FAIL — most of the new `type=topup` tests will return wrong status codes / wrong error.code.

- [ ] **Step 3: 加 plans.ts 的辅助函数**

Append to `backend/src/lib/plans.ts`:

```typescript
/**
 * Map an OrderRecord skuType (e.g. "plan_plus") back to the PlanId used
 * by the rest of the plan-only surface (pricing, bindSubscription).
 * Returns null for non-plan skuTypes (e.g. "topup"), letting callers
 * distinguish in their dispatch.
 */
export function skuTypeToPlanId(skuType: string): PlanId | null {
  if (!skuType.startsWith('plan_')) return null;
  const tail = skuType.slice('plan_'.length);
  return isPlanId(tail) ? tail : null;
}
```

- [ ] **Step 4: 重写 createOrderHandler 支持 type 分支**

Replace the entire `createOrderHandler` function in `backend/src/handlers/paymentHandlers.ts` (currently lines 138-265) with:

```typescript
const MAX_TOPUP_AMOUNT = 99999;

function isOrderType(v: unknown): v is 'plan' | 'topup' {
  return v === 'plan' || v === 'topup';
}

export const createOrderHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const auth = await requireSession(event);
  if (isAuthFailure(auth)) {
    return jsonError(auth.status, "authentication_error", auth.message, auth.code);
  }

  const body = parseJsonBody(event);
  if (!body)
    return jsonError(400, "invalid_request_error", "Body must be valid JSON.");

  // type: 'plan' (default for back-compat) | 'topup'
  const rawType = body.type ?? 'plan';
  if (!isOrderType(rawType))
    return jsonError(400, "invalid_request_error", "type must be plan|topup.");
  const type = rawType;

  if (!isChannel(body.channel))
    return jsonError(400, "invalid_request_error", "channel must be epusdt|xunhupay.");
  const channel = body.channel;

  // Channel determines pricing currency:
  //   epusdt   → USD (USDT-TRC20)
  //   xunhupay → CNY (Alipay/WeChat fiat gateway, CNY only)
  // Server-derived; client-supplied currency is ignored.
  const currency: "CNY" | "USD" = channel === "epusdt" ? "USD" : "CNY";

  let skuType: import('../lib/payment/types.js').OrderSkuType;
  let amount: number;
  let topupAmountUsd: number | undefined;
  let skuLabel: string;

  if (type === 'plan') {
    if (!isPlanId(body.planId))
      return jsonError(400, "invalid_request_error", "planId must be plus|super|ultra.");
    const planId = body.planId;
    if (PLANS[planId].soldOut) {
      return jsonError(
        410,
        "plan_unavailable",
        `${PLANS[planId].displayName} 当前售罄，暂时无法下单。`,
        "plan_sold_out",
      );
    }
    skuType = `plan_${planId}` as const;
    amount = currency === "USD"
      ? getPlanPriceUSD(planId)
      : getPlanPriceCNY(planId);
    skuLabel = planId;
  } else {
    // type === 'topup'
    const rawAmount = body.amount;
    if (
      typeof rawAmount !== 'number' ||
      !Number.isFinite(rawAmount) ||
      !Number.isInteger(rawAmount) ||
      rawAmount < 1 ||
      rawAmount > MAX_TOPUP_AMOUNT
    ) {
      return jsonError(
        400,
        "invalid_request_error",
        `amount must be an integer between 1 and ${MAX_TOPUP_AMOUNT}.`,
        "invalid_amount",
      );
    }
    skuType = 'topup';
    amount = rawAmount;
    // ¥1 = $1 baseline (spec credits-economy § 4). Stored independently of
    // amount/currency so settle is decoupled from FX drift.
    topupAmountUsd = rawAmount;
    skuLabel = 'topup';
  }

  const baseUrl = resolvePublicBaseUrl(event);
  if (!baseUrl) {
    return jsonError(
      500,
      "server_error",
      "Cannot determine public base URL for callbacks. Set PUBLIC_BASE_URL.",
    );
  }

  let client;
  if (channel === "epusdt") {
    client = epusdtFromEnv();
    if (!client) {
      return jsonError(
        503,
        "service_unavailable",
        "epusdt is not configured (set EPUSDT_BASE_URL / EPUSDT_PID / EPUSDT_SECRET).",
        "epusdt_not_configured",
      );
    }
  } else {
    client = xunhupayFromEnv();
    if (!client) {
      return jsonError(
        503,
        "service_unavailable",
        "xunhupay is not configured (set XUNHUPAY_APPID / XUNHUPAY_APPSECRET).",
        "xunhupay_not_configured",
      );
    }
  }

  const orderId = newOrderId();
  const now = new Date().toISOString();

  let result;
  try {
    result = await client.createOrder({
      orderId,
      amount,
      currency,
      skuLabel,
      notifyUrl: `${baseUrl}/v1/billing/webhook/${channel}`,
      redirectUrl: typeof body.redirectUrl === "string"
        ? body.redirectUrl
        : `${baseUrl}/billing/success?orderId=${orderId}`,
    });
  } catch (err) {
    const status =
      err instanceof EpusdtError || err instanceof XunhupayError ? 502 : 500;
    return jsonError(
      status,
      "upstream_error",
      `payment channel error: ${(err as Error).message}`,
    );
  }

  const order: import('../lib/payment/types.js').OrderRecord = {
    orderId,
    userId: auth.userId,
    skuType,
    channel,
    amount,
    currency,
    amountActual: result.amountActual,
    topupAmountUsd,
    status: "pending",
    upstreamTradeId: result.upstreamTradeId,
    upstreamPaymentUrl: result.paymentUrl,
    createdAt: now,
  };
  await createOrder(order);

  return jsonResponse(201, {
    orderId,
    type,
    skuType,
    planId: type === 'plan' ? body.planId : undefined,
    channel,
    amount,
    currency,
    amountActual: result.amountActual,
    topupAmountUsd,
    paymentUrl: result.paymentUrl,
    qrCodeUrl: result.qrCodeUrl,
    expiresAt: result.expiresAt,
    status: "pending",
  });
};
```

Also update `shapeOrder` (currently around lines 120-134) to surface the new fields:

```typescript
function shapeOrder(rec: OrderRecord) {
  return {
    orderId: rec.orderId,
    skuType: rec.skuType,
    // Convenience: derive planId for plan_* orders so the existing
    // OrderStatus UI keeps working without a code change.
    planId: skuTypeToPlanId(rec.skuType) ?? undefined,
    channel: rec.channel,
    amount: rec.amount,
    currency: rec.currency,
    amountActual: rec.amountActual,
    topupAmountUsd: rec.topupAmountUsd,
    status: rec.status,
    settleStatus: rec.settleStatus,
    paymentUrl: rec.upstreamPaymentUrl,
    blockTxId: rec.blockTxId,
    createdAt: rec.createdAt,
    paidAt: rec.paidAt,
  };
}
```

Add `skuTypeToPlanId` to the imports at the top of `paymentHandlers.ts`:

```typescript
import { PLANS, isPlanId, getPlanPriceCNY, getPlanPriceUSD, skuTypeToPlanId } from "../lib/plans.js";
```

- [ ] **Step 5: 同步 channel client 接口（CreateOrderInput 字段名）**

Both channel clients (`xunhupay.ts`, `epusdt.ts`) currently destructure `planId` from `CreateOrderInput`. Now the input carries `skuLabel` instead. Update both to consume `skuLabel`.

`backend/src/lib/payment/xunhupay.ts` — find every `input.planId` reference (likely 1-2 places where it's used to fill the `title` / `subject` field for the gateway) and replace with `input.skuLabel`. The label is what shows up in the user's bank statement.

`backend/src/lib/payment/epusdt.ts` — same swap. Make sure the resulting code still compiles.

- [ ] **Step 6: 跑测试确认通过**

Run: `cd backend && npx vitest run src/handlers/__tests__/paymentHandlers.test.ts`
Expected: PASS for sold-out gate (4 tests) + type discriminator (2 tests) + topup validation (5 tests). 11 total.

Run the wider suite:
`cd backend && npx vitest run`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/lib/plans.ts backend/src/lib/payment/types.ts backend/src/lib/payment/xunhupay.ts backend/src/lib/payment/epusdt.ts backend/src/handlers/paymentHandlers.ts backend/src/handlers/__tests__/paymentHandlers.test.ts
git commit -m "feat(billing): accept type=topup orders

POST /v1/billing/orders now accepts {type:'topup', amount, channel}
alongside the legacy {planId, channel} body. Validates integer amount
1-99999, derives currency from channel, ignores adversarial planId
overrides on topup orders."
```

---

## Task 5: paymentWebhook → applyTopupToUser dispatch

**Files:**
- Modify: `backend/src/handlers/paymentWebhook.ts`
- Test: `backend/src/handlers/__tests__/paymentWebhookTopup.test.ts` (new)

- [ ] **Step 1: 写失败测试 (mocked newapi mint+redeem 流)**

Create `backend/src/handlers/__tests__/paymentWebhookTopup.test.ts`:

```typescript
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

process.env.SESSION_SECRET = 'test-secret-32bytes-min-aaaaaaaaaaa';
process.env.SQLITE_PATH = ':memory:';
process.env.NEWAPI_BASE_URL = 'http://newapi.test.local';
process.env.NEWAPI_ADMIN_TOKEN = 'admin-token-test';
process.env.XUNHUPAY_APPID = 'test-appid';
process.env.XUNHUPAY_APPSECRET = 'test-secret';

import { init, putUser, createOrder, getOrder } from '../../lib/store.js';
import { newapi } from '../../lib/newapi.js';
import * as xun from '../../lib/payment/xunhupay.js';
import { xunhupayWebhookHandler } from '../paymentWebhook.js';

const userId = 'u_test_topup_webhook';

beforeAll(async () => {
  init();
  putUser({
    userId,
    email: 'topup@test.local',
    createdAt: new Date().toISOString(),
    newapiUserId: 42,
    newapiPassword: 'test-pwd',
  });
});

beforeEach(() => {
  vi.restoreAllMocks();
});

function makeWebhookEvent(body: Record<string, unknown>) {
  return {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body as Record<string, string>).toString(),
    isBase64Encoded: false,
  } as unknown as Parameters<typeof xunhupayWebhookHandler>[0];
}

describe('xunhupayWebhookHandler — topup orders', () => {
  it('mints a redemption code and applies it to the user', async () => {
    const orderId = 'tb_ord_webhook_topup_a';
    await createOrder({
      orderId,
      userId,
      skuType: 'topup',
      channel: 'xunhupay',
      amount: 50,
      currency: 'CNY',
      topupAmountUsd: 50,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    // Mock the channel's signature verification.
    const client = xun.xunhupayFromEnv();
    vi.spyOn(client!, 'verifyCallback').mockReturnValue({
      orderId,
      upstreamTradeId: 'upstream-id',
      amountActual: 50,
      status: 'paid',
    });
    vi.spyOn(xun, 'xunhupayFromEnv').mockReturnValue(client);

    const mintSpy = vi
      .spyOn(newapi, 'createRedemption')
      .mockResolvedValue('CODE-MINTED-XYZ');
    const loginSpy = vi
      .spyOn(newapi, 'loginUser')
      .mockResolvedValue({ cookie: 'sess=abc', userId: 42 });
    const redeemSpy = vi
      .spyOn(newapi, 'redeemCode')
      .mockResolvedValue({ quotaAdded: 50 * 500_000 });

    const res = (await xunhupayWebhookHandler(makeWebhookEvent({}))) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('success');

    expect(mintSpy).toHaveBeenCalledWith({ name: orderId, quotaUsd: 50 });
    expect(loginSpy).toHaveBeenCalled();
    expect(redeemSpy).toHaveBeenCalledWith(
      expect.objectContaining({ cookie: 'sess=abc', userId: 42 }),
      'CODE-MINTED-XYZ',
    );

    const back = await getOrder(orderId);
    expect(back?.status).toBe('paid');
    expect(back?.settleStatus).toBe('settled');
  });

  it('marks settleStatus=failed when newapi redeem throws', async () => {
    const orderId = 'tb_ord_webhook_topup_failed';
    await createOrder({
      orderId,
      userId,
      skuType: 'topup',
      channel: 'xunhupay',
      amount: 25,
      currency: 'CNY',
      topupAmountUsd: 25,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    const client = xun.xunhupayFromEnv();
    vi.spyOn(client!, 'verifyCallback').mockReturnValue({
      orderId,
      upstreamTradeId: 'u-2',
      amountActual: 25,
      status: 'paid',
    });
    vi.spyOn(xun, 'xunhupayFromEnv').mockReturnValue(client);
    vi.spyOn(newapi, 'createRedemption').mockResolvedValue('CODE-X');
    vi.spyOn(newapi, 'loginUser').mockResolvedValue({ cookie: 'c', userId: 42 });
    vi.spyOn(newapi, 'redeemCode').mockRejectedValue(
      new Error('newapi rejected'),
    );

    const res = (await xunhupayWebhookHandler(makeWebhookEvent({}))) as APIGatewayProxyStructuredResultV2;
    // We STILL ack 200 to stop gateway retries — order is paid.
    expect(res.statusCode).toBe(200);

    const back = await getOrder(orderId);
    expect(back?.status).toBe('paid');
    expect(back?.settleStatus).toBe('failed');
  });

  it('does not mint twice on duplicate webhook delivery', async () => {
    const orderId = 'tb_ord_webhook_topup_dup';
    await createOrder({
      orderId,
      userId,
      skuType: 'topup',
      channel: 'xunhupay',
      amount: 10,
      currency: 'CNY',
      topupAmountUsd: 10,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    const client = xun.xunhupayFromEnv();
    vi.spyOn(client!, 'verifyCallback').mockReturnValue({
      orderId,
      upstreamTradeId: 'u-3',
      amountActual: 10,
      status: 'paid',
    });
    vi.spyOn(xun, 'xunhupayFromEnv').mockReturnValue(client);
    const mintSpy = vi.spyOn(newapi, 'createRedemption').mockResolvedValue('CODE-Y');
    vi.spyOn(newapi, 'loginUser').mockResolvedValue({ cookie: 'c', userId: 42 });
    vi.spyOn(newapi, 'redeemCode').mockResolvedValue({ quotaAdded: 10 * 500_000 });

    await xunhupayWebhookHandler(makeWebhookEvent({}));
    await xunhupayWebhookHandler(makeWebhookEvent({}));
    await xunhupayWebhookHandler(makeWebhookEvent({}));

    expect(mintSpy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx vitest run src/handlers/__tests__/paymentWebhookTopup.test.ts`
Expected: FAIL — `applyTopupToUser` does not exist; topup orders settle with no side effect on newapi.

- [ ] **Step 3: 加 applyTopupToUser + 分支到 processWebhook**

Open `backend/src/handlers/paymentWebhook.ts`. In the `processWebhook` function, locate the `if (settled) { ... await applyPlanToUser(...) }` block (around line 128-136). Replace it with:

```typescript
    if (settled) {
      console.info(`${tag} order settled`, {
        orderId: order.orderId,
        userId: order.userId,
        skuType: order.skuType,
        amountActual: verified.amountActual,
      });
      if (order.skuType === 'topup') {
        await applyTopupToUser(order, channel);
      } else {
        const planId = skuTypeToPlanId(order.skuType);
        if (planId) {
          await applyPlanToUser(order.userId, planId, channel);
        } else {
          console.error(`${tag} unknown skuType on settled order: ${order.skuType}`);
        }
      }
    }
```

Update the existing `applyPlanToUser` signature to accept the planId already-typed (small refactor — it currently takes a `string` and validates). Replace its second parameter type to `import('../lib/plans.js').PlanId` so callers can't pass garbage.

Now add the new function `applyTopupToUser` at the bottom of the file (after `applyPlanToUser`):

```typescript
/**
 * Credit a settled topup order's $ to the user via newapi.
 *
 * Path: admin-mint a one-shot redemption code worth `topupAmountUsd` →
 * log in as the user → apply the code via newapi's /api/user/topup. Two
 * atomic newapi operations replace a single read-modify-write
 * updateUser, which would race against the user's own consumption.
 *
 * Idempotency: caller (markOrderPaidIfPending) already guarantees one
 * call per order. We additionally short-circuit if `settleStatus` is
 * already 'settled' — defensive against future code paths.
 *
 * Failure mode: webhook still acks 200 (the order IS paid), but
 * settleStatus is set to 'failed' and a structured error log lets ops
 * grep by orderId. v1 is manual-recovery; v1.1 may add an auto-retry
 * cron.
 */
async function applyTopupToUser(
  order: OrderRecord,
  channel: string,
): Promise<void> {
  const tag = `[webhook/${channel}]`;

  if (order.settleStatus === 'settled') {
    console.info(`${tag} topup already settled, skipping`, { orderId: order.orderId });
    return;
  }

  const usd = order.topupAmountUsd;
  if (!usd || usd <= 0) {
    console.error(`${tag} topup order has no topupAmountUsd`, {
      orderId: order.orderId,
      userId: order.userId,
    });
    await markOrderSettleStatus({ orderId: order.orderId, settleStatus: 'failed' });
    return;
  }

  const user = await getUser(order.userId);
  if (!user || user.newapiUserId == null || !user.newapiPassword) {
    console.error(`${tag} topup user has no newapi link`, {
      orderId: order.orderId,
      userId: order.userId,
    });
    await markOrderSettleStatus({ orderId: order.orderId, settleStatus: 'failed' });
    return;
  }

  let code: string;
  try {
    code = await newapi.createRedemption({
      name: order.orderId,
      quotaUsd: usd,
    });
  } catch (err) {
    const msg = err instanceof NewapiError ? err.message : (err as Error).message;
    console.error(`${tag} createRedemption failed`, {
      orderId: order.orderId,
      userId: order.userId,
      topupAmountUsd: usd,
      errorMessage: msg,
      channel,
    });
    await markOrderSettleStatus({ orderId: order.orderId, settleStatus: 'failed' });
    return;
  }

  try {
    const session = await newapi.loginUser({
      username: newapiUsername(order.userId),
      password: user.newapiPassword,
    });
    await newapi.redeemCode(session, code);
    await markOrderSettleStatus({ orderId: order.orderId, settleStatus: 'settled' });
    console.info(`${tag} topup credited`, {
      orderId: order.orderId,
      userId: order.userId,
      topupAmountUsd: usd,
    });
  } catch (err) {
    const msg = err instanceof NewapiError ? err.message : (err as Error).message;
    console.error(`${tag} topup redeemCode failed`, {
      orderId: order.orderId,
      userId: order.userId,
      topupAmountUsd: usd,
      errorMessage: msg,
      channel,
      mintedCode: code, // include so ops can manually re-redeem if needed
    });
    await markOrderSettleStatus({ orderId: order.orderId, settleStatus: 'failed' });
  }
}

/** Mirrors authHandlers#register — newapi username = userId without u_ prefix. */
function newapiUsername(userId: string): string {
  return userId.startsWith("u_") ? userId.slice(2) : userId.slice(0, 20);
}
```

Update the imports at the top of `paymentWebhook.ts`:

```typescript
import {
  getOrder,
  getUser,
  markOrderPaidIfPending,
  markOrderStatus,
  markOrderSettleStatus,
} from "../lib/store.js";
import { isPlanId, getNewapiPlanId, skuTypeToPlanId } from "../lib/plans.js";
import { newapi, NewapiError } from "../lib/newapi.js";
import type { OrderRecord } from "../lib/payment/types.js";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npx vitest run src/handlers/__tests__/paymentWebhookTopup.test.ts`
Expected: PASS (3 tests).

Run the full backend suite to catch regressions:
`cd backend && npx vitest run`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/handlers/paymentWebhook.ts backend/src/handlers/__tests__/paymentWebhookTopup.test.ts
git commit -m "feat(webhook): credit topup orders via mint+redeem

processWebhook now dispatches by order.skuType: plan_* keeps the existing
bindSubscription path; topup mints a one-shot redemption code on newapi
admin and applies it as the user. Failures stamp settleStatus='failed'
+ structured log for ops follow-up."
```

---

## Task 6: 前端 api.ts 类型与 client

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: 改 types + createOrder client**

In `frontend/src/lib/api.ts`, replace the `BillingPlanId` block (around lines 256-275) with:

```typescript
// ---------- billing types ----------

export type BillingPlanId = "plus" | "super" | "ultra";
export type BillingChannel = "epusdt" | "xunhupay";
export type BillingStatus = "pending" | "paid" | "expired" | "failed";
export type BillingCurrency = "CNY" | "USD";
export type BillingSkuType = "plan_plus" | "plan_super" | "plan_ultra" | "topup";
export type BillingSettleStatus = "settled" | "failed";

export interface BillingOrder {
  orderId: string;
  /** New canonical SKU label. Use this in switch statements. */
  skuType: BillingSkuType;
  /** Convenience: derived from skuType for plan_* orders; undefined on
   *  topup orders. Kept for back-compat with components that read planId. */
  planId?: BillingPlanId;
  channel: BillingChannel;
  /** Quoted amount in `currency` (CNY for xunhupay, USD for epusdt). */
  amount: number;
  currency: BillingCurrency;
  amountActual?: number;
  /** USD equivalent credited on settle. Only set for skuType='topup'. */
  topupAmountUsd?: number;
  status: BillingStatus;
  /** Set after the webhook attempts to apply credits (topup only). */
  settleStatus?: BillingSettleStatus;
  paymentUrl?: string;
  blockTxId?: string;
  createdAt: string;
  paidAt?: string;
}

export interface CreateOrderResponse {
  orderId: string;
  /** Echoes the request type. */
  type: 'plan' | 'topup';
  skuType: BillingSkuType;
  planId?: BillingPlanId;
  channel: BillingChannel;
  amount: number;
  currency: BillingCurrency;
  amountActual?: number;
  topupAmountUsd?: number;
  paymentUrl: string;
  qrCodeUrl?: string;
  expiresAt?: number;
  status: BillingStatus;
}

/** Body for POST /v1/billing/orders. Plan and topup are discriminated
 *  via the `type` field; backend defaults to 'plan' if omitted, but
 *  client should always send it explicitly. */
export type CreateOrderInput =
  | {
      type: 'plan';
      planId: BillingPlanId;
      channel: BillingChannel;
      redirectUrl?: string;
    }
  | {
      type: 'topup';
      amount: number; // integer 1-99999
      channel: BillingChannel;
      redirectUrl?: string;
    };
```

Then replace the `createOrder` method on the `api` object (around lines 397-408) with:

```typescript
  // billing
  createOrder(input: CreateOrderInput): Promise<CreateOrderResponse> {
    return request<CreateOrderResponse>("/v1/billing/orders", {
      method: "POST",
      body: input,
    });
  },
```

- [ ] **Step 2: typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: errors in `Payment.tsx` and `OrderStatus.tsx` because they pass the old `{planId, channel}` body shape and read `order.planId`. We fix those in Tasks 7-10.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(api): types and client for type=topup orders

createOrder now takes a discriminated union; BillingOrder gains skuType /
topupAmountUsd / settleStatus."
```

(Note: this commit deliberately leaves Payment.tsx + OrderStatus.tsx broken; Tasks 7-10 land them in sequence. If you're running tests at this point, frontend tests are tsc-blocked — that's expected and intentional. Don't fix it ad-hoc, the next tasks land the fix in the right place.)

---

## Task 7: 抽 ChannelOption + checkoutFlow 共享件

**Files:**
- Create: `frontend/src/components/ChannelOption.tsx`
- Create: `frontend/src/lib/checkoutFlow.ts`
- Modify: `frontend/src/screens/Payment.tsx`

- [ ] **Step 1: 创建 ChannelOption 组件**

Create `frontend/src/components/ChannelOption.tsx`:

```tsx
/**
 * Shared payment-channel selector card. Used by both the plan checkout
 * (Payment.tsx) and the topup checkout (Topup.tsx). Visual identical to
 * the original inline component in Payment.tsx pre-extraction; behaviour
 * is just (active, onClick, title, subtitle, tag).
 */

interface Props {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
  tag: string;
}

export function ChannelOption({ active, onClick, title, subtitle, tag }: Props) {
  const base =
    'block w-full text-left p-5 border-2 border-ink rounded-md transition-all';
  const onState = active
    ? 'bg-ink text-bg shadow-[3px_3px_0_0_#1C1917]'
    : 'bg-white text-ink shadow-[3px_3px_0_0_#1C1917] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_0_#1C1917]';

  return (
    <button onClick={onClick} className={`${base} ${onState}`} type="button">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <span className="text-[16px] font-bold">{title}</span>
        <span
          className={
            'font-mono text-[10px] tracking-[0.08em] px-1.5 py-0.5 rounded border-2 ' +
            (active
              ? 'border-bg text-bg'
              : 'border-ink text-ink-2')
          }
        >
          {tag}
        </span>
      </div>
      <div
        className={
          'text-[12.5px] ' + (active ? 'text-bg/80' : 'text-text-secondary')
        }
      >
        {subtitle}
      </div>
    </button>
  );
}
```

- [ ] **Step 2: 创建 checkoutFlow util**

Create `frontend/src/lib/checkoutFlow.ts`:

```typescript
import type { NavigateFunction } from 'react-router-dom';
import type { BillingChannel, CreateOrderResponse } from './api';

/**
 * Distinguish "phone" from "PC". `pointer: coarse` matches touch-primary
 * devices, the most reliable signal on real Android/iOS phones. Width
 * fallback covers DevTools "device toolbar" testing.
 */
export function isMobileLike(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const narrow = window.innerWidth < 768;
  const ua = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  return coarse || narrow || ua;
}

/**
 * Drive the post-create-order navigation. Branches on channel + form factor:
 *   xunhupay + mobile : same-window deeplink to Alipay H5
 *   xunhupay + PC     : navigate to OrderStatus with QR in nav state
 *   epusdt   + mobile : same-window to gateway hosted page
 *   epusdt   + PC     : open gateway in new tab + navigate to OrderStatus
 *
 * The same routine works for both plan and topup orders — the only
 * difference upstream is order shape, not navigation behaviour.
 */
export function dispatchCheckout(
  res: CreateOrderResponse,
  channel: BillingChannel,
  navigate: NavigateFunction,
) {
  const mobile = isMobileLike();

  if (channel === 'xunhupay' && mobile) {
    // Mobile + 支付宝: same-window navigation, popups blocked / deeplinks
    // must run in the user's primary browser context. The gateway redirects
    // back to /billing/success?orderId=... after payment.
    window.location.href = res.paymentUrl;
    return;
  }

  if (channel === 'xunhupay' && !mobile && res.qrCodeUrl) {
    // PC + 支付宝: render QR inline on OrderStatus so the user never
    // leaves our app. qrCodeUrl is not stored server-side; pass via nav
    // state. Hard refresh on OrderStatus falls back to a "重新打开支付页"
    // link built from order.paymentUrl.
    navigate(`/billing/orders/${encodeURIComponent(res.orderId)}`, {
      state: { qrCodeUrl: res.qrCodeUrl, paymentUrl: res.paymentUrl },
    });
    return;
  }

  // epusdt: gateway-hosted checkout. Open in new tab on PC, same-window
  // on mobile. Mobile + xunhupay without qrCodeUrl falls through here too.
  if (res.paymentUrl) {
    if (mobile) window.location.href = res.paymentUrl;
    else window.open(res.paymentUrl, '_blank', 'noopener,noreferrer');
  }
  navigate(`/billing/orders/${encodeURIComponent(res.orderId)}`);
}
```

- [ ] **Step 3: 重构 Payment.tsx 消费抽出的件**

In `frontend/src/screens/Payment.tsx`:

1. Add imports near the top:

```tsx
import { ChannelOption } from '../components/ChannelOption';
import { dispatchCheckout } from '../lib/checkoutFlow';
```

2. Remove the local `isMobileLike` function (was around line 31-37).

3. Replace the `submit` function body with:

```tsx
  async function submit() {
    if (!planId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.createOrder({ type: 'plan', planId, channel });
      dispatchCheckout(res, channel, navigate);
    } catch (err) {
      setError((err as Error).message || '下单失败，稍后再试');
      setSubmitting(false);
    }
  }
```

4. Delete the inline `function ChannelOption(...)` definition at the bottom of the file (was around lines 333-376).

5. The two `<ChannelOption ...>` usages in the JSX stay as-is — the props match.

- [ ] **Step 4: typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: errors only in `OrderStatus.tsx` (still reads `order.planId` directly, fixed in Task 10). `Payment.tsx` should now compile.

- [ ] **Step 5: 跑前端单元测试 (如果有 ChannelOption / Payment 测试)**

Run: `cd frontend && npx vitest run`
Expected: green or only OrderStatus-related failures (handled in Task 10).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ChannelOption.tsx frontend/src/lib/checkoutFlow.ts frontend/src/screens/Payment.tsx
git commit -m "refactor(billing): extract ChannelOption + checkoutFlow

Pulled from Payment.tsx so Topup.tsx can reuse them. Behaviour identical."
```

---

## Task 8: 新建 Topup.tsx + 路由

**Files:**
- Create: `frontend/src/screens/Topup.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: 创建 Topup.tsx**

Create `frontend/src/screens/Topup.tsx`:

```tsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppNav } from '../components/AppNav';
import { ChannelOption } from '../components/ChannelOption';
import { RedeemCodeModal } from '../components/RedeemCodeModal';
import { dispatchCheckout } from '../lib/checkoutFlow';
import { api, type BillingChannel } from '../lib/api';

const card = 'bg-white border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917]';

const PRESETS = [50, 100, 500] as const;
const MIN_AMOUNT = 1;
const MAX_AMOUNT = 99999;

type Preset = (typeof PRESETS)[number] | 'custom';

export default function Topup() {
  const navigate = useNavigate();

  const [channel, setChannel] = useState<BillingChannel>('xunhupay');
  const [preset, setPreset] = useState<Preset>(PRESETS[0]);
  const [customAmountStr, setCustomAmountStr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [redeemOpen, setRedeemOpen] = useState(false);

  // Channel drives currency: xunhupay → ¥, epusdt → $.
  const symbol = channel === 'epusdt' ? '$' : '¥';

  // Resolve the integer amount. Returns null when invalid.
  function resolveAmount(): number | null {
    if (preset !== 'custom') return preset;
    const trimmed = customAmountStr.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
    if (n < MIN_AMOUNT || n > MAX_AMOUNT) return null;
    return n;
  }
  const amount = resolveAmount();

  async function submit() {
    if (amount == null) {
      setError(`金额必须是 ${MIN_AMOUNT}-${MAX_AMOUNT} 之间的整数`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.createOrder({ type: 'topup', amount, channel });
      dispatchCheckout(res, channel, navigate);
    } catch (err) {
      setError((err as Error).message || '下单失败，稍后再试');
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg pb-12">
      <AppNav current="console" />

      <main className="max-w-[680px] mx-auto px-5 sm:px-9 pt-6">
        {/* Crumbs */}
        <div className="font-mono text-[11px] tracking-[0.06em] text-[#A89A8D] mb-4">
          <Link to="/console" className="hover:text-ink transition-colors">控制台</Link>
          <span className="mx-2 text-[#D9CEC2]">/</span>
          <span className="text-ink-2">充值</span>
        </div>

        {/* Eyebrow */}
        <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[#A89A8D] font-bold mb-3">
          BILLING · 充值
        </div>
        <h1 className="text-[36px] md:text-[44px] font-bold tracking-tight leading-[1.05] mb-3">
          充值额度
        </h1>
        <p className="text-[14px] text-text-secondary mb-8 max-w-[520px] leading-relaxed">
          永不过期 · 解锁全模型 · ¥1 = $1
        </p>

        {/* Channel picker */}
        <section className="mb-6">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-3">
            支付方式
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ChannelOption
              active={channel === 'xunhupay'}
              onClick={() => setChannel('xunhupay')}
              title="支付宝"
              subtitle="PC 扫码 / 手机直跳"
              tag="即时到账"
            />
            <ChannelOption
              active={channel === 'epusdt'}
              onClick={() => setChannel('epusdt')}
              title="USDT-TRC20"
              subtitle="区块链稳定币 · TRON"
              tag="海外友好"
            />
          </div>
        </section>

        {/* Amount picker */}
        <section className="mb-6">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-3">
            充值金额
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            {PRESETS.map((p) => (
              <PresetChip
                key={p}
                active={preset === p}
                onClick={() => setPreset(p)}
                label={`${symbol}${p}`}
              />
            ))}
            <PresetChip
              active={preset === 'custom'}
              onClick={() => setPreset('custom')}
              label="自定义"
            />
          </div>

          {preset === 'custom' && (
            <div className={`${card} p-4 mb-3`}>
              <label className="block font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-2">
                金额（{symbol}，{MIN_AMOUNT}-{MAX_AMOUNT} 的整数）
              </label>
              <input
                type="number"
                inputMode="numeric"
                step={1}
                min={MIN_AMOUNT}
                max={MAX_AMOUNT}
                value={customAmountStr}
                onChange={(e) => setCustomAmountStr(e.target.value)}
                className="w-full font-mono text-[18px] font-bold p-2 border-2 border-ink rounded bg-white"
                placeholder={`${MIN_AMOUNT}`}
              />
            </div>
          )}

          {amount != null && (
            <div className="font-mono text-[12px] text-text-secondary">
              → 到账 ${amount} 美金{channel === 'epusdt' ? '（按 USDT 等额结算）' : ''}
            </div>
          )}
        </section>

        {/* Error */}
        {error && (
          <div className="mb-5 p-3 border-2 border-red-600 rounded-md bg-red-50 font-mono text-[12px] text-red-700">
            {error}
          </div>
        )}

        {/* Action */}
        <div className="flex items-center justify-between flex-wrap gap-3 mt-8">
          <Link
            to="/console"
            className="font-mono text-[12.5px] text-ink-2 hover:text-ink underline underline-offset-4 decoration-2"
          >
            ← 返回控制台
          </Link>
          <button
            onClick={submit}
            disabled={submitting || amount == null}
            className={
              'px-6 py-3 bg-ink text-bg border-2 border-ink rounded-md text-[14px] font-bold ' +
              'shadow-[3px_3px_0_0_#1C1917] ' +
              (submitting || amount == null
                ? 'opacity-60 cursor-not-allowed'
                : 'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
                  'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
                  'transition-all')
            }
          >
            {submitting
              ? '生成订单中…'
              : amount == null
              ? '请输入金额'
              : `去付款 · ${symbol}${amount}`}
          </button>
        </div>

        <div className="mt-10 font-mono text-[11.5px] text-ink-3 leading-relaxed">
          · 充值后立即到账，永不过期，全模型可用<br />
          · 充值不支持退款<br />
          ·{' '}
          <button
            type="button"
            onClick={() => setRedeemOpen(true)}
            className="text-ink-2 hover:text-ink underline underline-offset-4 decoration-2"
          >
            已有兑换码？
          </button>
        </div>
      </main>

      <RedeemCodeModal open={redeemOpen} onClose={() => setRedeemOpen(false)} />
    </div>
  );
}

function PresetChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  const base =
    'block w-full text-center px-4 py-3 border-2 border-ink rounded-md font-mono text-[14px] font-bold transition-all';
  const onState = active
    ? 'bg-ink text-bg shadow-[3px_3px_0_0_#1C1917]'
    : 'bg-white text-ink shadow-[3px_3px_0_0_#1C1917] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_0_#1C1917]';
  return (
    <button onClick={onClick} className={`${base} ${onState}`} type="button">
      {label}
    </button>
  );
}
```

- [ ] **Step 2: 加路由 in App.tsx**

In `frontend/src/App.tsx`, add the import alongside the others:

```tsx
import Topup from './screens/Topup';
```

Add the route inside the `<Routes>` block, right after the existing `/billing/pay` line:

```tsx
      <Route path="/billing/topup" element={<RequireAuth><Topup /></RequireAuth>} />
```

- [ ] **Step 3: typecheck + 启动 dev server 手测**

Run: `cd frontend && npx tsc --noEmit`
Expected: `OrderStatus.tsx` errors remain (Task 10 fixes); everything else compiles.

Run: `cd frontend && npm run dev` (or `bun dev` if that's the convention).

Open `http://localhost:5173/billing/topup` (login first if needed).
Verify:
- 4 amount chips render, default `¥50` selected
- click 自定义 → input 出现，能输 1-99999 整数
- 渠道切到 USDT → 档位标签 `$50/$100/$500`，副标 "→ 到账 $X 美金（按 USDT 等额结算）"
- 兑换码链接 弹 RedeemCodeModal
- 按钮 disabled 当金额无效

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screens/Topup.tsx frontend/src/App.tsx
git commit -m "feat(billing): add Topup self-checkout page

/billing/topup with 3 presets (¥50/¥100/¥500) + custom integer input
+ channel picker + redeem-code link. Channel drives currency display."
```

---

## Task 9: Hook 入口 — Dashboard / Plans / Payment lockout

**Files:**
- Modify: `frontend/src/screens/Dashboard.tsx`
- Modify: `frontend/src/screens/Plans.tsx`
- Modify: `frontend/src/screens/Payment.tsx`

- [ ] **Step 1: Dashboard — paid 用户的 "充值额度" 改跳路由**

In `frontend/src/screens/Dashboard.tsx`, locate the paid-user CTA block (around lines 330-340). Replace the `<button onClick={() => setContactReason('topup')}>充值额度</button>` with a `<Link>`:

```tsx
                    <Link
                      to="/billing/topup"
                      className="font-mono text-[12px] py-2 px-1 -my-2 text-white/80 hover:text-white underline underline-offset-4 decoration-white/30 hover:decoration-white transition-colors flex-shrink-0"
                    >
                      充值额度
                    </Link>
```

(Make sure `Link` is imported from `react-router-dom` at the top — it almost certainly already is.)

- [ ] **Step 2: Dashboard — no-sub 用户加副链接**

Still in `Dashboard.tsx`, locate the no-sub branch (around lines 351-372 — the block that renders "Agent 余额" + "开通套餐 →" Link). Add a small inline secondary link to /billing/topup right under the "开通套餐" CTA. Replace the existing `<Link to="/pricing">开通套餐 →</Link>` block with:

```tsx
                <div className="w-full flex flex-col items-stretch sm:flex-row sm:items-center sm:w-auto sm:ml-auto gap-2 sm:gap-4">
                  <Link
                    to="/billing/topup"
                    className="font-mono text-[12px] py-2 px-1 -my-2 text-white/80 hover:text-white underline underline-offset-4 decoration-white/30 hover:decoration-white transition-colors flex-shrink-0 text-center sm:text-left"
                  >
                    充值额度
                  </Link>
                  <Link
                    to="/pricing"
                    className={
                      slockBtn('secondary') +
                      ' w-full text-center sm:w-auto'
                    }
                  >
                    开通套餐 →
                  </Link>
                </div>
```

- [ ] **Step 3: Plans.tsx — `standardCta` 改跳 /billing/topup**

In `frontend/src/screens/Plans.tsx`, find the `standardCta` definition (around lines 93-95). Replace with:

```tsx
  const standardCta = isLoggedIn
    ? { text: '立即充值 →', href: '/billing/topup' }
    : { text: '免费开始 →', onClick: goRegister };
```

The CTA rendering block (around lines 145+) currently expects `standardCta.onClick`. Update the JSX so it renders an `<a href>` / `<Link>` when `href` is present and a `<button>` otherwise. Find the conditional `standardCta.onClick ? <button ...> ...` block and replace with:

```tsx
          {standardCta.href ? (
            <Link
              to={standardCta.href}
              className={
                'px-5 py-2.5 bg-bg border-2 border-ink rounded-md text-[14px] font-bold text-ink ' +
                'shadow-[3px_3px_0_0_#1C1917] ' +
                'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
                'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
                'transition-all whitespace-nowrap'
              }
            >
              {standardCta.text}
            </Link>
          ) : standardCta.onClick ? (
            <button
              onClick={standardCta.onClick}
              className={
                /* ...keep the existing classes for the button branch... */
                'px-5 py-2.5 bg-bg border-2 border-ink rounded-md text-[14px] font-bold text-ink ' +
                'shadow-[3px_3px_0_0_#1C1917] ' +
                'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
                'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
                'transition-all whitespace-nowrap'
              }
            >
              {standardCta.text}
            </button>
          ) : null}
```

(If `Link` isn't imported in Plans.tsx, add `import { Link } from 'react-router-dom';` at the top.)

Adjust the type of `standardCta` if TS complains:

```tsx
  const standardCta:
    | { text: string; onClick: () => void; href?: undefined }
    | { text: string; href: string; onClick?: undefined } = isLoggedIn
    ? { text: '立即充值 →', href: '/billing/topup' }
    : { text: '免费开始 →', onClick: goRegister };
```

- [ ] **Step 4: Payment.tsx — 已订阅 lockout 加 "+ 加买充值额度"**

In `frontend/src/screens/Payment.tsx`, locate the paid-user lockout block (around lines 100-144 — the "你已经订阅了 X" page). Find the action buttons row. Add a third item: a Link to `/billing/topup`. The block currently looks like:

```tsx
          <div className="flex items-center gap-3 flex-wrap">
            <button type="button" onClick={() => setContactOpen(true)} ...>
              联系客服 →
            </button>
            <Link to="/console" ...>← 返回控制台</Link>
          </div>
```

Replace with:

```tsx
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => setContactOpen(true)}
              className={
                'px-5 py-2.5 bg-ink text-bg border-2 border-ink rounded-md text-[14px] font-bold ' +
                'shadow-[3px_3px_0_0_#1C1917] ' +
                'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
                'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
                'transition-all'
              }
            >
              联系客服 →
            </button>
            <Link
              to="/billing/topup"
              className="font-mono text-[12.5px] text-ink-2 hover:text-ink underline underline-offset-4 decoration-2"
            >
              + 加买充值额度
            </Link>
            <Link
              to="/console"
              className="font-mono text-[12.5px] text-ink-2 hover:text-ink underline underline-offset-4 decoration-2"
            >
              ← 返回控制台
            </Link>
          </div>
```

- [ ] **Step 5: typecheck + 手测**

Run: `cd frontend && npx tsc --noEmit`
Expected: only OrderStatus.tsx errors remain.

Start dev server, login, visit:
- `/console` (Dashboard) — verify 充值额度 link goes to `/billing/topup` for both paid and no-sub cases
- `/pricing` — verify "立即充值 →" CTA in 标准价 section navigates to `/billing/topup`
- `/billing/pay?plan=plus` after granting yourself a Plus sub via `scripts/grant-plan.ts` — verify the lockout page shows the new "+ 加买充值额度" link

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screens/Dashboard.tsx frontend/src/screens/Plans.tsx frontend/src/screens/Payment.tsx
git commit -m "feat(billing): wire topup entry points

Dashboard hero, Plans 标准价 CTA, and Payment paid-lockout all link to
/billing/topup. Removes the previous 'contact 客服' tunneling for topup."
```

---

## Task 10: OrderStatus topup 适配

**Files:**
- Modify: `frontend/src/screens/OrderStatus.tsx`

- [ ] **Step 1: 在 OrderStatus 里识别 topup 并切文案**

In `frontend/src/screens/OrderStatus.tsx`:

1. Update the `PLAN_LABEL` block (around lines 14-18) to also handle topup. Replace it with two helpers:

```tsx
const PLAN_LABEL: Record<string, string> = {
  plus: 'Plus',
  super: 'Super',
  ultra: 'Ultra',
};

function skuLabel(order: BillingOrder): string {
  if (order.skuType === 'topup') return '充值';
  if (order.planId) return PLAN_LABEL[order.planId] ?? order.planId;
  return order.skuType;
}

function isTopup(order: BillingOrder): boolean {
  return order.skuType === 'topup';
}
```

2. Replace the `Row label="套餐"` line (around line 159-161) with a generic 名称 label:

```tsx
          <Row label={isTopup(order) ? '名称' : '套餐'}>
            <span className="font-bold">{skuLabel(order)}</span>
          </Row>
```

3. Add a topup-specific row showing the USD that will be credited (right after the channel row):

```tsx
          {isTopup(order) && order.topupAmountUsd != null && (
            <Row label="到账">
              <span className="font-mono">${order.topupAmountUsd.toFixed(2)}</span>
            </Row>
          )}
```

4. Update `StatusHero` to show topup-aware copy on the paid state. Find the `if (status === 'paid')` block in `StatusHero` and change its signature to accept the order so it can branch:

Replace `<StatusHero status={order.status} hasQr={!!navState.qrCodeUrl} />` (around line 148) with:

```tsx
      <StatusHero status={order.status} hasQr={!!navState.qrCodeUrl} order={order} />
```

Update `StatusHero`'s signature and the paid branch:

```tsx
function StatusHero({
  status,
  hasQr,
  order,
}: {
  status: BillingStatus;
  hasQr: boolean;
  order: BillingOrder;
}) {
  if (status === 'pending') {
    return (
      <>
        <h1 className="text-[36px] md:text-[44px] font-bold tracking-tight leading-[1.05] mb-3 flex items-center gap-3">
          <Spinner />
          等待支付
        </h1>
        <p className="text-[14px] text-text-secondary mb-8 max-w-[520px] leading-relaxed">
          {hasQr
            ? '扫描下方二维码完成支付，付款完成后这里会在 1 分钟内自动跳回控制台。'
            : '已为你打开支付页面。完成付款后这里会在 1 分钟内自动跳转到控制台。如果支付页面被关闭了，下方点"重新打开"。'}
        </p>
      </>
    );
  }
  if (status === 'paid') {
    const copy =
      order.skuType === 'topup'
        ? `$${order.topupAmountUsd?.toFixed(2) ?? '?'} 已加到余额，${Math.round(AUTO_REDIRECT_AFTER_PAID_MS / 1000)} 秒后自动跳回控制台。`
        : `套餐已激活，${Math.round(AUTO_REDIRECT_AFTER_PAID_MS / 1000)} 秒后自动跳回控制台。`;
    return (
      <>
        <h1 className="text-[36px] md:text-[44px] font-bold tracking-tight leading-[1.05] mb-3 flex items-center gap-3">
          <span className="text-lime-stamp-ink bg-lime-stamp border-2 border-ink rounded px-2 py-0.5 text-[20px]">
            ✓
          </span>
          支付成功
        </h1>
        <p className="text-[14px] text-text-secondary mb-8 max-w-[520px] leading-relaxed">
          {copy}
        </p>
      </>
    );
  }
  // expired / failed
  return (
    <>
      <h1 className="text-[36px] md:text-[44px] font-bold tracking-tight leading-[1.05] mb-3 flex items-center gap-3">
        <span className="text-red-700 bg-red-100 border-2 border-ink rounded px-2 py-0.5 text-[20px]">
          ✕
        </span>
        {status === 'expired' ? '订单已过期' : '订单失败'}
      </h1>
      <p className="text-[14px] text-text-secondary mb-8 max-w-[520px] leading-relaxed">
        没扣到钱不要担心。下方"重新下单"再走一遍。
      </p>
    </>
  );
}
```

5. Update `FailedActions` to send topup users back to /billing/topup instead of /pricing. Pass an `isTopup` prop:

```tsx
{(order.status === 'expired' || order.status === 'failed') && (
  <FailedActions isTopup={isTopup(order)} />
)}
```

```tsx
function FailedActions({ isTopup }: { isTopup: boolean }) {
  const to = isTopup ? '/billing/topup' : '/pricing';
  const text = isTopup ? '重新充值 →' : '重新下单 →';
  return (
    <div className="flex items-center gap-3 mb-2">
      <Link
        to={to}
        className={
          'inline-block px-5 py-2.5 bg-ink text-bg border-2 border-ink rounded-md text-[14px] font-bold ' +
          'shadow-[3px_3px_0_0_#1C1917] ' +
          'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
          'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
          'transition-all'
        }
      >
        {text}
      </Link>
    </div>
  );
}
```

6. Update the bottom navigation row (around lines 200-214) to also direct topup users back to /billing/topup instead of /pricing:

```tsx
      <div className="mt-8 flex items-center justify-between flex-wrap gap-3">
        <Link
          to="/console"
          className="font-mono text-[12.5px] text-ink-2 hover:text-ink underline underline-offset-4 decoration-2"
        >
          ← 返回控制台
        </Link>
        <Link
          to={isTopup(order) ? '/billing/topup' : '/pricing'}
          className="font-mono text-[12.5px] text-ink-2 hover:text-ink underline underline-offset-4 decoration-2"
        >
          {isTopup(order) ? '再充一笔 →' : '重新选套餐 →'}
        </Link>
      </div>
```

- [ ] **Step 2: typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: GREEN (all errors should now be cleared).

- [ ] **Step 3: 手测 OrderStatus**

Start dev server. Manually create a topup order via `/billing/topup` (use a real ¥1 if you have a test gateway set up via `PLAN_PRICE_*` envs adjusted; otherwise just navigate to a synthetic URL). Verify:
- Pending state shows generic "等待支付" copy + QR if applicable
- Paid state (manually flip via DB or wait for webhook) shows "$X 已加到余额"
- Failed state shows "重新充值 →" Link

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screens/OrderStatus.tsx
git commit -m "feat(billing): topup-aware copy in OrderStatus

Paid state shows '$X 已加到余额'; failed state routes back to /billing/topup
instead of /pricing; row labels swap '套餐' → '名称' for topup orders."
```

---

## Task 11: 测试指南 + 全套回归

**Files:**
- Modify: `docs/订阅测试指南.md` (append topup section)

- [ ] **Step 1: 追加充值测试章节**

Append to `docs/订阅测试指南.md`:

```markdown

---

## 充值 (topup) 自助下单 e2e 测试

### 准备

- 后端环境已配 `XUNHUPAY_APPID` / `XUNHUPAY_APPSECRET` 或 `EPUSDT_BASE_URL` / `EPUSDT_PID` / `EPUSDT_SECRET` 任一
- 后端环境已配 `NEWAPI_BASE_URL` / `NEWAPI_ADMIN_TOKEN`
- 测试账户已 register + emailVerified
- 起一个 `npm run dev` (backend) + `npm run dev` (frontend)

### 场景 1 — 支付宝 ¥1 充值（PC 扫码）

1. 在 PC 浏览器登录 → /console → 点 hero 上的 "充值额度"
2. 选 支付宝 + 自定义 `1` → 去付款 ¥1
3. /billing/orders/<id> 应显示扫码二维码
4. 用支付宝 app 扫码完成 ¥1 支付
5. 等 ≤60s，OrderStatus 应翻成 "支付成功 · $1 已加到余额"，3s 后自动跳回 /console
6. /console 上 Agent 余额 应 +$1
7. newapi admin 后台 → 用户 → quota 应 +500_000

### 场景 2 — USDT-TRC20 $1 充值（PC 新窗口）

1. 同入口 → 选 USDT-TRC20 + 自定义 `1`
2. 去付款 $1 → 应在新窗口打开 epusdt 收银台
3. 用 TRON 钱包付 ≈$1 USDT
4. 收银台跳回我们的 /billing/success?orderId=...
5. 同场景 1 后续验证：余额 +$1 + newapi quota +500_000

### 场景 3 — 移动端支付宝 H5 直跳

1. 手机 Safari / Chrome 登录 → /billing/topup
2. 选 支付宝 + 默认 ¥50 → 去付款 ¥50
3. 应直接跳支付宝 app 完成支付
4. 支付宝跳回 /billing/success?orderId=... → OrderStatus → "支付成功 · $50 已加到余额"

### 场景 4 — 兑换码入口仍然可用

1. 登录 → /billing/topup → 底部 "已有兑换码？" 链接
2. RedeemCodeModal 弹出 → 输管理员铸的 redemption code → 应 +$X 到余额

### 场景 5 — 活跃订阅者可充值

1. 用 `scripts/grant-plan.ts <email> plus` 给账户绑 Plus 套餐
2. 登录 → /billing/pay?plan=plus → lockout 页应显示 "+ 加买充值额度" 链接
3. 点链接进 /billing/topup → 完整完成 ¥1 充值
4. 余额 = Plus 当日 cap + $1 充值

### 场景 6 — 重复 webhook 投递不重复加额度

1. 完成场景 1 一笔 ¥1 充值，记下 orderId
2. 手动用 curl 给 /v1/billing/webhook/xunhupay 重复投递相同的 webhook 体（带正确签名）
3. 余额应保持 +$1，不变成 +$2
4. backend log 应有 "topup already settled, skipping" 或类似 marker

### 场景 7 — newapi 失败时落 settleStatus=failed

1. 把 NEWAPI_ADMIN_TOKEN 临时改错 → 启动 backend
2. 走完整 ¥1 支付宝充值流程
3. 网关回调到 webhook → settle order paid → mint redemption fails
4. SQLite 查 `SELECT orderId, status, settleStatus FROM orders WHERE userId='...' ORDER BY createdAt DESC LIMIT 1;` 应是 `(...,'paid','failed')`
5. backend log 应有 `[webhook/xunhupay] createRedemption failed { orderId, userId, topupAmountUsd, errorMessage, channel }` 行
6. 修回 NEWAPI_ADMIN_TOKEN，跑 `scripts/grant-bucket.sh <email> topup 1` 兜底加额度（人工修复路径）
```

- [ ] **Step 2: 跑全套测试 + typecheck**

Backend:
```bash
cd backend && npx vitest run
```
Expected: all green.

Frontend:
```bash
cd frontend && npx tsc --noEmit && npx vitest run
```
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add docs/订阅测试指南.md
git commit -m "docs(billing): add topup self-checkout e2e test scenarios

Covers happy paths (Alipay PC + mobile, USDT), redeem-code coexistence,
active-subscriber topup, idempotent webhook, and newapi-failure recovery."
```

---

## Open issues to revisit during implementation

These appear in the spec's Open questions and can't be 100% nailed down without empirical work — surface them at execute time, don't ignore:

1. **xunhupay 网关 min 金额阈值**：在场景 1 用 ¥1 测试时如果网关拒，跑 `scripts/probe-xunhupay.mjs` 找出真实最小值。
   - 如果 min > ¥1：把 `MIN_AMOUNT` 在 backend `paymentHandlers.ts` (`MAX_TOPUP_AMOUNT` 上面) 和 frontend `Topup.tsx` 都调上去
   - 如果 backend 校验保留 ¥1 但 UI 调上：不一致，必须同步

2. **getConfig() 在 newapi.ts 的真实命名**：Task 3 假设它叫 `getConfig`。如果真名是 `getNewapiConfig` 之类，按文件实际导出来用。

3. **xunhupay.ts / epusdt.ts 内部 `planId` 引用**：Task 4 Step 5 说要把 `input.planId` 换成 `input.skuLabel`。具体行号取决于这两个 channel client 的实现（webhook 中没列出来）。读源码定位每一处。

4. **Plans.tsx standardCta JSX 块的实际行号**：Task 9 Step 3 给的 JSX 替换以"找到现有 `standardCta.onClick ?` 三元"为准。如果重构期间 Plans.tsx 已经迁移到别的形式，调整以匹配当时状态。

---

## Self-review

**Spec coverage:**
- § 1 范围: ✅ 整个 plan 全围绕 topup 通过现有 2 渠道 + 不动 redeemHandler / Payment 套餐
- § 2 API 契约: ✅ Task 4 实现 type 字段分支 + 兼容默认 'plan'
- § 3 数据模型 delta: ✅ Task 1 (schema + migration) + Task 2 (markOrderSettleStatus)
- § 4 Webhook 落账 (路径 1 mint+redeem): ✅ Task 5
- § 5 前端 Topup 页: ✅ Task 7-8
- § 6 入口: ✅ Task 9 (Dashboard + Plans + Payment lockout)
- § 7 校验与错误处理: ✅ Task 4 校验 + Task 5 失败兜底 + Task 8 client 校验
- § 8 测试策略: ✅ Task 1-5 单元测试 + Task 11 e2e 指南

**Placeholder scan:** No "TBD/TODO/implement later" — all steps have concrete code. The "Open issues to revisit" section is intentional flag, not a placeholder.

**Type consistency:**
- `OrderSkuType`, `BillingSkuType`, `skuType`, `topupAmountUsd`, `settleStatus` all spelled the same way across backend types, store, handlers, frontend api types.
- `MAX_TOPUP_AMOUNT = 99999` consistent in backend handler + frontend Topup constant.
- `applyTopupToUser` signature matches between paymentWebhook.ts and the test in paymentWebhookTopup.test.ts.

**Scope:** Single coherent implementation; no premature optimization (no auto-retry cron, no DLQ, no max-amount product cap). All YAGNI deferred items are explicit non-goals in the spec.
