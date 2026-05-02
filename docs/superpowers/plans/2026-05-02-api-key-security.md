# API Key 安全收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 砍掉 `GET /v1/keys/{keyId}/reveal` 端点，把 API Key 明文从「平台随时可 reveal」改成「平台只在创建瞬间展示一次，之后只活在用户自己的设备 localStorage 缓存里」。同时给创建接口加可选 `expiresInDays`，列表行去掉 Copy 按钮，logout 清缓存，default Key 自动创建从 `verifyCode` 挪到 `OnboardInstall`。

**Architecture:** 后端先把契约改完（删 reveal、加 expiresInDays/expiresAt、verifyCode 不再自动建 Key），前端再按 lib → modals → list → Dashboard → OnboardInstall 顺序改。明文写 `localStorage` 的唯一时机是「`RevealKeyModal` 的"我已保存好"按钮被显式按下」和「`OnboardInstall` 拿到 `createKey` 响应后立即写入」。logout（含 401 自动登出）把当前用户的所有 `tb_key_v1:${email}:*` 条目一并清掉。

**Tech Stack:** Backend TypeScript + better-sqlite3 + AWS-Lambda-style handlers + vitest；Frontend React + Vite + Tailwind + vitest + @testing-library/react。

**Spec:** `docs/superpowers/specs/2026-05-02-api-key-security-design.md`

---

## File Structure

**Backend (修改)：**
- Modify: `backend/src/handlers/keysHandlers.ts` — `createKeyHandler` 接受 `expiresInDays`；`listKeysHandler` 返回 `expiresAt`；删 `revealKeyHandler`
- Modify: `backend/src/local.ts` — 删 `/v1/keys/{keyId}/reveal` 路由
- Modify: `backend/src/handlers/authHandlers.ts:482-538` — 删 verifyCode 里的 default Key 自动创建块
- Modify: `backend/src/handlers/__tests__/verifyCode.test.ts` — 加测试：verifyCode 后用户没 Key
- Modify: `backend/src/handlers/__tests__/` — 加 `keys.test.ts`（新文件，覆盖 expiresInDays / expiresAt / reveal 路由 404）

**Frontend (新增 / 修改)：**
- Create: `frontend/src/lib/keyExpiry.ts` — `isExpired()` + `expiryLabel()`
- Create: `frontend/src/lib/__tests__/keyExpiry.test.ts`
- Modify: `frontend/src/lib/keyCache.ts` — 加 `clearAllCachedKeys(email)`
- Modify: `frontend/src/lib/__tests__/` — 加 `keyCache.test.ts`（新文件）
- Modify: `frontend/src/lib/auth.tsx:151` — `logout()` 调 `clearAllCachedKeys(user?.email)`
- Modify: `frontend/src/lib/api.ts:143-160` — `ProxyKeySummary` / `CreatedProxyKey` 加 `expiresAt`；`createKey` 入参加 `expiresInDays?`
- Modify: `frontend/src/components/KeyModals.tsx` — `RevealKeyModal` 强制确认 + 透明缓存说明 + 写缓存；`CreateKeyModal` 加有效期下拉
- Modify: `frontend/src/components/APIKeyList.tsx` — 删 Copy 按钮、`handleCopy` 状态；行内加有效期标签
- Modify: `frontend/src/screens/Dashboard.tsx:253-268` — `defaultKey` 排除 disabled / expired；缓存 miss 兜底 CTA；listKeys 加载完做一次 cache sweep
- Modify: `frontend/src/screens/OnboardInstall.tsx` — 改成 createKey 流程 + 边缘路径确认弹窗
- Modify: `frontend/src/lib/api.ts:401-405` — 最终清理：删 `api.revealKey` 方法
- Modify: `frontend/src/components/__tests__/` — 加 `KeyModals.test.tsx`、`APIKeyList.test.tsx`
- Modify: `frontend/src/screens/__tests__/` — 加 `Dashboard.test.tsx`、`OnboardInstall.test.tsx`

**Out of scope (followup)：**
- JWT 真注销（独立 scope，下一轮设计）
- 2FA / 二次验证
- Key 事件审计日志

---

## Task 1: 后端 — 加 `expiresInDays` 入参 + `expiresAt` 出参

**Files:**
- Create: `backend/src/handlers/__tests__/keys.test.ts`
- Modify: `backend/src/handlers/keysHandlers.ts`

- [ ] **Step 1: 写失败测试**

Create `backend/src/handlers/__tests__/keys.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { createKeyHandler, listKeysHandler } from '../keysHandlers.js';
import { init, putUser } from '../../lib/store.js';
import { signSession } from '../../lib/authTokens.js';
import * as newapi from '../../lib/newapi.js';

beforeEach(() => {
  process.env.SQLITE_PATH = ':memory:';
  process.env.JWT_SECRET = 'test-secret';
  process.env.NEWAPI_BASE_URL = 'http://newapi.test';
  process.env.NEWAPI_ADMIN_TOKEN = 'admin-token';
  init();
});

function makeAuthedEvent(userId: string, body?: unknown): any {
  return {
    headers: { authorization: `Bearer ${signSession(userId)}` },
    body: body ? JSON.stringify(body) : undefined,
    pathParameters: {},
  };
}

async function seedUser(userId: string) {
  putUser({
    userId,
    email: `${userId}@x.com`,
    createdAt: new Date().toISOString(),
    emailVerified: true,
    newapiUserId: 42,
    newapiPassword: 'np-password',
  });
}

describe('POST /v1/keys', () => {
  it('passes expiresInDays through to newapi as expired_time = now + days*86400', async () => {
    await seedUser('u_alice');
    vi.spyOn(newapi, 'loginUser').mockResolvedValue({ cookie: 'sid=x' } as any);
    const createSpy = vi
      .spyOn(newapi, 'createAndRevealToken')
      .mockResolvedValue({ tokenId: 7, apiKey: 'sk-plain' });

    const before = Math.floor(Date.now() / 1000);
    const res = await createKeyHandler(
      makeAuthedEvent('u_alice', { label: 'work', expiresInDays: 30 }),
    ) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(201);
    expect(createSpy).toHaveBeenCalledTimes(1);
    const callArg = createSpy.mock.calls[0][0];
    expect(callArg.name).toBe('work');
    expect(callArg.expired_time).toBeGreaterThanOrEqual(before + 30 * 86400);
    expect(callArg.expired_time).toBeLessThanOrEqual(before + 30 * 86400 + 5);

    const body = JSON.parse(res.body!);
    expect(body.expiresAt).toBeTruthy();
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('omitting expiresInDays sends expired_time = -1 and returns expiresAt: null', async () => {
    await seedUser('u_bob');
    vi.spyOn(newapi, 'loginUser').mockResolvedValue({ cookie: 'sid=x' } as any);
    const createSpy = vi
      .spyOn(newapi, 'createAndRevealToken')
      .mockResolvedValue({ tokenId: 8, apiKey: 'sk-plain' });

    const res = await createKeyHandler(
      makeAuthedEvent('u_bob', { label: 'forever' }),
    ) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(201);
    expect(createSpy.mock.calls[0][0].expired_time).toBe(-1);
    expect(JSON.parse(res.body!).expiresAt).toBeNull();
  });

  it('rejects expiresInDays = 0 with 400', async () => {
    await seedUser('u_carol');
    const res = await createKeyHandler(
      makeAuthedEvent('u_carol', { label: 'bad', expiresInDays: 0 }),
    ) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(400);
  });

  it('rejects negative expiresInDays with 400', async () => {
    await seedUser('u_dave');
    const res = await createKeyHandler(
      makeAuthedEvent('u_dave', { label: 'bad', expiresInDays: -3 }),
    ) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /v1/keys', () => {
  it('returns expiresAt: null for permanent tokens (expired_time = -1)', async () => {
    await seedUser('u_eve');
    vi.spyOn(newapi, 'loginUser').mockResolvedValue({ cookie: 'sid=x' } as any);
    vi.spyOn(newapi, 'listUserTokens').mockResolvedValue([
      {
        id: 1,
        name: 'default',
        key: 'sk-...abcd',
        status: 1,
        created_time: 1700000000,
        expired_time: -1,
      } as any,
    ]);

    const res = await listKeysHandler(makeAuthedEvent('u_eve')) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(res.body!);
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0].expiresAt).toBeNull();
  });

  it('returns expiresAt as ISO string for tokens with expired_time set', async () => {
    await seedUser('u_frank');
    vi.spyOn(newapi, 'loginUser').mockResolvedValue({ cookie: 'sid=x' } as any);
    vi.spyOn(newapi, 'listUserTokens').mockResolvedValue([
      {
        id: 2,
        name: 'temp',
        key: 'sk-...efgh',
        status: 1,
        created_time: 1700000000,
        expired_time: 1900000000,
      } as any,
    ]);

    const res = await listKeysHandler(makeAuthedEvent('u_frank')) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(res.body!);
    expect(body.keys[0].expiresAt).toBe(new Date(1900000000 * 1000).toISOString());
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `cd /Users/Sirius/Developer/tokenboss/backend && npx vitest run src/handlers/__tests__/keys.test.ts`

Expected: 6 failures (handlers don't accept `expiresInDays` yet, don't return `expiresAt`).

- [ ] **Step 3: 修改 `createKeyHandler` 接受 `expiresInDays`**

In `backend/src/handlers/keysHandlers.ts`, locate the `createKeyHandler` body parsing block (around line 170-184) and the create call (line 180-184). Replace:

```ts
  const body = parseJsonBody(event);
  if (!body) return jsonError(400, "invalid_request_error", "Body must be valid JSON.");
  const rawLabel = typeof body.label === "string" ? body.label.trim() : "";
  const label = rawLabel ? rawLabel.slice(0, 64) : "default";
```

with:

```ts
  const body = parseJsonBody(event);
  if (!body) return jsonError(400, "invalid_request_error", "Body must be valid JSON.");
  const rawLabel = typeof body.label === "string" ? body.label.trim() : "";
  const label = rawLabel ? rawLabel.slice(0, 64) : "default";

  // expiresInDays: integer >= 1, or omitted/null = permanent.
  let expiredTime = -1;
  let expiresAtISO: string | null = null;
  if (body.expiresInDays !== undefined && body.expiresInDays !== null) {
    if (
      typeof body.expiresInDays !== "number" ||
      !Number.isInteger(body.expiresInDays) ||
      body.expiresInDays < 1
    ) {
      return jsonError(
        400,
        "invalid_request_error",
        "expiresInDays must be a positive integer or null.",
      );
    }
    const seconds = Math.floor(Date.now() / 1000) + body.expiresInDays * 86400;
    expiredTime = seconds;
    expiresAtISO = new Date(seconds * 1000).toISOString();
  }
```

Then change the `createAndRevealToken` call to pass `expired_time`:

```ts
    const { tokenId, apiKey } = await newapi.createAndRevealToken({
      session,
      name: label,
      unlimited_quota: true,
      expired_time: expiredTime,
    });
```

And change the response body (around line 204-210) from:

```ts
    return jsonResponse(201, {
      keyId: tokenId,
      key: apiKey,
      label,
      createdAt: new Date().toISOString(),
      disabled: false,
    });
```

to:

```ts
    return jsonResponse(201, {
      keyId: tokenId,
      key: apiKey,
      label,
      createdAt: new Date().toISOString(),
      disabled: false,
      expiresAt: expiresAtISO,
    });
```

- [ ] **Step 4: 修改 `listKeysHandler` 返回 `expiresAt`**

In the same file, find `listKeysHandler` (around line 144-152). The current map block:

```ts
      keys: tokens.map((t) => ({
        keyId: t.id,
        key: maskKey(t.key),
        label: t.name,
        createdAt: new Date(t.created_time * 1000).toISOString(),
        disabled: t.status !== 1,
      })),
```

Replace with:

```ts
      keys: tokens.map((t) => ({
        keyId: t.id,
        key: maskKey(t.key),
        label: t.name,
        createdAt: new Date(t.created_time * 1000).toISOString(),
        disabled: t.status !== 1,
        expiresAt: t.expired_time === -1 ? null : new Date(t.expired_time * 1000).toISOString(),
      })),
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd /Users/Sirius/Developer/tokenboss/backend && npx vitest run src/handlers/__tests__/keys.test.ts`

Expected: 6 passes.

- [ ] **Step 6: 跑全量后端测试，确认无回归**

Run: `cd /Users/Sirius/Developer/tokenboss/backend && npx vitest run`

Expected: All pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/Sirius/Developer/tokenboss
git add backend/src/handlers/keysHandlers.ts backend/src/handlers/__tests__/keys.test.ts
git commit -m "feat(keys): /v1/keys 支持 expiresInDays 创建参数 + expiresAt 出参"
```

---

## Task 2: 后端 — `verifyCode` 不再自动创建 default Key

**Files:**
- Modify: `backend/src/handlers/authHandlers.ts:506-529`
- Modify: `backend/src/handlers/__tests__/verifyCode.test.ts`

- [ ] **Step 1: 写失败测试**

Append to `backend/src/handlers/__tests__/verifyCode.test.ts` (inside the existing `describe('POST /v1/auth/verify-code', ...)` block):

```typescript
  it('does NOT auto-create a default API key on first signup', async () => {
    // Spy on newapi.createAndRevealToken — must NOT be called.
    const newapi = await import('../../lib/newapi.js');
    const createSpy = vi.spyOn(newapi.newapi, 'createAndRevealToken');

    const code = await getCodeForEmail('nokey@example.com');
    const res = await verifyCodeHandler({
      body: JSON.stringify({ email: 'nokey@example.com', code }),
    } as any) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!).isNew).toBe(true);

    expect(createSpy).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/Sirius/Developer/tokenboss/backend && npx vitest run src/handlers/__tests__/verifyCode.test.ts -t "does NOT auto-create"`

Expected: FAIL — `createAndRevealToken` was called once.

- [ ] **Step 3: 删 verifyCode 里的 auto-provision Key 块**

In `backend/src/handlers/authHandlers.ts`, find the block at lines 506-529 starting with the comment `// Auto-create the user's default API key right after provisioning` and ending with the closing `}` of the inner `try { putApiKeyIndex(...) } catch { ... }` block. Delete those lines entirely.

The block to delete (lines 506-529 inclusive):

```ts
        // Auto-create the user's default API key right after provisioning
        // so /onboard/install can render the spell with the key inline,
        // SkillBoss-style. Plaintext is fetched on demand via reveal — we
        // don't store it on our side; newapi keeps it. We DO store the
        // sha256 of the raw key so chatProxyCore can resolve sk-xxx →
        // userId for free-tier model rewriting.
        const session = await newapi.loginUser({
          username: newapiUsername,
          password: newapiPassword,
        });
        const { tokenId, apiKey } = await newapi.createAndRevealToken({
          session,
          name: "default",
          unlimited_quota: true,
        });
        try {
          putApiKeyIndex({
            userId,
            newapiTokenId: tokenId,
            keyHash: createHash("sha256").update(apiKey).digest("hex"),
          });
        } catch (idxErr) {
          console.error(`[verifyCode] api_key_index write failed for ${userId}:`, (idxErr as Error).message);
        }
```

After deletion, the surrounding `try { ... } catch (err) { ... }` should still wrap `provisionAndBindTrial` — that part stays. Verify the brace structure looks like:

```ts
      try {
        const provisioned = await provisionAndBindTrial({ ... });
        newapiUserId = provisioned.newapiUserId;
      } catch (err) {
        // ... existing newapi_provision_failed handler ...
      }
```

If `createHash` import becomes unused, also remove it from the imports at the top of the file (search for `createHash` usage in the file first — if no other usages, drop the import).

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/Sirius/Developer/tokenboss/backend && npx vitest run src/handlers/__tests__/verifyCode.test.ts`

Expected: All pass (including the new test).

- [ ] **Step 5: 跑全量后端测试**

Run: `cd /Users/Sirius/Developer/tokenboss/backend && npx vitest run`

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/Sirius/Developer/tokenboss
git add backend/src/handlers/authHandlers.ts backend/src/handlers/__tests__/verifyCode.test.ts
git commit -m "refactor(auth): verifyCode 不再自动创建 default Key — 改由前端 OnboardInstall 显式创建"
```

---

## Task 3: 后端 — 删除 `GET /v1/keys/{keyId}/reveal` 路由

**Files:**
- Modify: `backend/src/handlers/keysHandlers.ts:216-251`
- Modify: `backend/src/local.ts:73,152`
- Modify: `backend/src/handlers/__tests__/keys.test.ts`

- [ ] **Step 1: 写失败测试 — reveal 路由应该 404**

Append to `backend/src/handlers/__tests__/keys.test.ts`:

```typescript
describe('GET /v1/keys/{keyId}/reveal', () => {
  it('handler is no longer exported', async () => {
    const mod = await import('../keysHandlers.js');
    expect((mod as any).revealKeyHandler).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/Sirius/Developer/tokenboss/backend && npx vitest run src/handlers/__tests__/keys.test.ts -t "no longer exported"`

Expected: FAIL — `revealKeyHandler` is still exported.

- [ ] **Step 3: 删除 `revealKeyHandler` 函数**

In `backend/src/handlers/keysHandlers.ts`, delete the entire block from line 216 (`// ---------- GET /v1/keys/{keyId}/reveal ----------`) through the closing `};` of `revealKeyHandler` (around line 251). Make sure the next block (`// ---------- DELETE /v1/keys/{keyId} ----------`) is preserved intact.

- [ ] **Step 4: 删除 `local.ts` 路由表里的 reveal 行**

In `backend/src/local.ts`, line 73 contains:

```ts
  revealKeyHandler,
```

Remove it from the import list. Then line 152:

```ts
  { method: "GET", path: "/v1/keys/{keyId}/reveal", handler: revealKeyHandler },
```

Remove that route entry as well.

- [ ] **Step 5: 跑后端 typecheck + 测试**

Run: `cd /Users/Sirius/Developer/tokenboss/backend && npx tsc --noEmit && npx vitest run`

Expected: Typecheck passes, all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/Sirius/Developer/tokenboss
git add backend/src/handlers/keysHandlers.ts backend/src/local.ts backend/src/handlers/__tests__/keys.test.ts
git commit -m "feat(keys)!: 删除 GET /v1/keys/{keyId}/reveal — 明文不再可重复获取"
```

---

## Task 4: 前端 — 共享类型加 `expiresAt` / `expiresInDays`

**Files:**
- Modify: `frontend/src/lib/api.ts:143-160, 393-394`

- [ ] **Step 1: 改 ProxyKeySummary 和 CreatedProxyKey**

In `frontend/src/lib/api.ts`, locate the type definitions (around line 143-160). Change:

```ts
export interface ProxyKeySummary {
  /** Masked form for display (e.g. `tb_live_...abcd`). */
  key: string;
  /** Stable identifier used with DELETE /v1/keys/{keyId}. */
  keyId: string;
  label?: string;
  createdAt: string;
  disabled?: boolean;
}

export interface CreatedProxyKey {
  /** Full unmasked key — returned ONLY once at create time. Copy now. */
  key: string;
  keyId: string;
  label?: string;
  createdAt: string;
  disabled?: boolean;
}
```

to:

```ts
export interface ProxyKeySummary {
  /** Masked form for display (e.g. `tb_live_...abcd`). */
  key: string;
  /** Stable identifier used with DELETE /v1/keys/{keyId}. */
  keyId: string;
  label?: string;
  createdAt: string;
  disabled?: boolean;
  /** ISO timestamp when the key auto-expires. null = never expires. */
  expiresAt: string | null;
}

export interface CreatedProxyKey {
  /** Full unmasked key — returned ONLY once at create time. Copy now. */
  key: string;
  keyId: string;
  label?: string;
  createdAt: string;
  disabled?: boolean;
  /** ISO timestamp when the key auto-expires. null = never expires. */
  expiresAt: string | null;
}
```

- [ ] **Step 2: 改 createKey 入参签名**

Locate around line 393:

```ts
  createKey(input: { label?: string }): Promise<CreatedProxyKey> {
    return request<CreatedProxyKey>("/v1/keys", { method: "POST", body: input });
  },
```

Change to:

```ts
  createKey(input: { label?: string; expiresInDays?: number | null }): Promise<CreatedProxyKey> {
    return request<CreatedProxyKey>("/v1/keys", { method: "POST", body: input });
  },
```

- [ ] **Step 3: 跑前端 typecheck**

Run: `cd /Users/Sirius/Developer/tokenboss/frontend && npx tsc --noEmit`

`expiresAt` is REQUIRED (not optional) on the type. Most existing consumers only READ `ProxyKeySummary` fields, so they'll pass. The places that CONSTRUCT one (test fixtures, mocks) need the field added.

If typecheck fails because a file outside the four UI files rewritten in subsequent tasks (`KeyModals.tsx`, `APIKeyList.tsx`, `Dashboard.tsx`, `OnboardInstall.tsx`) builds a `ProxyKeySummary` literal, fix it by adding `expiresAt: null`. For the four UI files just listed, errors are expected and will be resolved by their respective tasks below — proceed without fixing those.

Run: `cd /Users/Sirius/Developer/tokenboss/frontend && grep -rn "ProxyKeySummary" src/ --include="*.ts" --include="*.tsx" | head` to scan likely places. The contract change is small enough that the engineer can add `expiresAt: null` to any literal that fails typecheck.

- [ ] **Step 4: Commit**

```bash
cd /Users/Sirius/Developer/tokenboss
git add frontend/src/lib/api.ts
git commit -m "types(api): ProxyKeySummary / CreatedProxyKey 加 expiresAt + createKey 加 expiresInDays"
```

---

## Task 5: 前端 — `keyExpiry.ts` helper（isExpired + 显示标签）

**Files:**
- Create: `frontend/src/lib/keyExpiry.ts`
- Create: `frontend/src/lib/__tests__/keyExpiry.test.ts`

- [ ] **Step 1: 写失败测试**

Create `frontend/src/lib/__tests__/keyExpiry.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isExpired, expiryLabel } from '../keyExpiry';

afterEach(() => vi.useRealTimers());

describe('isExpired', () => {
  it('returns false when expiresAt is null', () => {
    expect(isExpired({ expiresAt: null })).toBe(false);
  });

  it('returns false when expiresAt is in the future', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(isExpired({ expiresAt: future })).toBe(false);
  });

  it('returns true when expiresAt is in the past', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(isExpired({ expiresAt: past })).toBe(true);
  });
});

describe('expiryLabel', () => {
  it('returns "永久" when expiresAt is null', () => {
    expect(expiryLabel({ expiresAt: null })).toBe('永久');
  });

  it('returns "X 天后过期" when in the future (>= 1 day)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-02T12:00:00Z'));
    const in23Days = new Date('2026-05-25T12:00:00Z').toISOString();
    expect(expiryLabel({ expiresAt: in23Days })).toBe('23 天后过期');
  });

  it('returns "今天到期" when expires today (within 24h, not yet expired)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-02T12:00:00Z'));
    const in6Hours = new Date('2026-05-02T18:00:00Z').toISOString();
    expect(expiryLabel({ expiresAt: in6Hours })).toBe('今天到期');
  });

  it('returns "已过期 N 天" when in the past', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-13T12:00:00Z'));
    const days12Ago = new Date('2026-05-01T12:00:00Z').toISOString();
    expect(expiryLabel({ expiresAt: days12Ago })).toBe('已过期 12 天');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/Sirius/Developer/tokenboss/frontend && npx vitest run src/lib/__tests__/keyExpiry.test.ts`

Expected: FAIL — module `../keyExpiry` doesn't exist.

- [ ] **Step 3: 实现 helper**

Create `frontend/src/lib/keyExpiry.ts`:

```typescript
/**
 * Helpers for the API key expiry display + filtering. Backend returns
 * `expiresAt` as an ISO timestamp or null (= never expires).
 */

export interface ExpirableKey {
  expiresAt: string | null;
}

export function isExpired(k: ExpirableKey): boolean {
  if (k.expiresAt == null) return false;
  return new Date(k.expiresAt).getTime() <= Date.now();
}

export function expiryLabel(k: ExpirableKey): string {
  if (k.expiresAt == null) return '永久';
  const expiresMs = new Date(k.expiresAt).getTime();
  const diffMs = expiresMs - Date.now();
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMs <= 0) {
    const expiredDays = Math.max(1, Math.floor(-diffMs / 86_400_000));
    return `已过期 ${expiredDays} 天`;
  }
  if (diffDays < 1) return '今天到期';
  return `${diffDays} 天后过期`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/Sirius/Developer/tokenboss/frontend && npx vitest run src/lib/__tests__/keyExpiry.test.ts`

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/Sirius/Developer/tokenboss
git add frontend/src/lib/keyExpiry.ts frontend/src/lib/__tests__/keyExpiry.test.ts
git commit -m "feat(keys): keyExpiry.ts helper — isExpired / expiryLabel"
```

---

## Task 6: 前端 — `clearAllCachedKeys` + logout 清缓存集成

**Files:**
- Modify: `frontend/src/lib/keyCache.ts`
- Create: `frontend/src/lib/__tests__/keyCache.test.ts`
- Modify: `frontend/src/lib/auth.tsx:151`

- [ ] **Step 1: 写失败测试**

Create `frontend/src/lib/__tests__/keyCache.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { setCachedKey, getCachedKey, clearAllCachedKeys } from '../keyCache';

beforeEach(() => {
  localStorage.clear();
});

describe('clearAllCachedKeys', () => {
  it('removes all entries for the given email', () => {
    setCachedKey('alice@x.com', 'k1', 'sk-A');
    setCachedKey('alice@x.com', 'k2', 'sk-B');
    setCachedKey('bob@x.com', 'k3', 'sk-C');

    clearAllCachedKeys('alice@x.com');

    expect(getCachedKey('alice@x.com', 'k1')).toBeNull();
    expect(getCachedKey('alice@x.com', 'k2')).toBeNull();
    expect(getCachedKey('bob@x.com', 'k3')).toBe('sk-C');
  });

  it('is a no-op when email is undefined', () => {
    setCachedKey('alice@x.com', 'k1', 'sk-A');
    clearAllCachedKeys(undefined);
    expect(getCachedKey('alice@x.com', 'k1')).toBe('sk-A');
  });

  it('is a no-op when email has no matching entries', () => {
    setCachedKey('alice@x.com', 'k1', 'sk-A');
    clearAllCachedKeys('nobody@x.com');
    expect(getCachedKey('alice@x.com', 'k1')).toBe('sk-A');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/Sirius/Developer/tokenboss/frontend && npx vitest run src/lib/__tests__/keyCache.test.ts`

Expected: FAIL — `clearAllCachedKeys` not exported.

- [ ] **Step 3: 实现 `clearAllCachedKeys`**

Append to `frontend/src/lib/keyCache.ts` (after the existing `clearCachedKey` function):

```typescript
/**
 * Clear ALL cached plaintext keys for one user. Used at logout to keep
 * the "缓存只在你这台设备" promise honest — sign out wipes the local copy.
 *
 * No-op when email is missing (e.g., logout fired before user hydrated).
 */
export function clearAllCachedKeys(email: string | undefined): void {
  if (!email) return;
  const prefix = `${NS}:${email}:`;
  try {
    const toDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) toDelete.push(k);
    }
    toDelete.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* private mode / disabled storage — nothing to clear */
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/Sirius/Developer/tokenboss/frontend && npx vitest run src/lib/__tests__/keyCache.test.ts`

Expected: All pass.

- [ ] **Step 5: 把 `clearAllCachedKeys` 接到 logout**

Open `frontend/src/lib/auth.tsx`. Add the import at the top (find the `keyCache` import or add a new line):

```ts
import { clearAllCachedKeys } from './keyCache';
```

Then locate the `logout` callback (line 151). Find the body, which currently looks like:

```ts
const logout = useCallback(() => {
  setStoredSession(null);
  setUser(null);
  setSession(null);
}, []);
```

(adjust the snippet match to whatever the current shape is). Change it to:

```ts
const logout = useCallback(() => {
  // Honor the "your key only lives on this device" promise: signing out
  // wipes any cached plaintext keys for this user.
  clearAllCachedKeys(user?.email);
  setStoredSession(null);
  setUser(null);
  setSession(null);
}, [user]);
```

Note: include `user` in the dep array because we read `user.email`.

- [ ] **Step 6: Typecheck + 测试**

Run: `cd /Users/Sirius/Developer/tokenboss/frontend && npx tsc --noEmit && npx vitest run src/lib/__tests__/`

Expected: All pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/Sirius/Developer/tokenboss
git add frontend/src/lib/keyCache.ts frontend/src/lib/__tests__/keyCache.test.ts frontend/src/lib/auth.tsx
git commit -m "feat(auth): logout 清空 tb_key_v1 缓存 — 退出登录后明文不留"
```

---

## Task 7: 前端 — 强化 `RevealKeyModal`（强制确认 + 透明缓存 + 写缓存）

**Files:**
- Modify: `frontend/src/components/KeyModals.tsx:173-239`
- Create: `frontend/src/components/__tests__/KeyModals.test.tsx`

- [ ] **Step 1: 写失败测试**

Create `frontend/src/components/__tests__/KeyModals.test.tsx`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RevealKeyModal } from '../KeyModals';
import * as keyCache from '../../lib/keyCache';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const sample = {
  keyId: 'kid-1',
  key: 'sk-PLAINTEXT-FOREVER',
  label: 'work',
  createdAt: '2026-05-02T00:00:00Z',
  expiresAt: null,
};

describe('RevealKeyModal — show-once + cache-on-confirm', () => {
  it('renders the plaintext and the transparency message', () => {
    render(
      <RevealKeyModal open={true} onClose={() => {}} created={sample} email="alice@x.com" />,
    );
    expect(screen.getByText('sk-PLAINTEXT-FOREVER')).toBeInTheDocument();
    expect(screen.getByText(/仅显示这一次/)).toBeInTheDocument();
    expect(screen.getByText(/缓存在这台设备/)).toBeInTheDocument();
    expect(screen.getByText(/退出登录/)).toBeInTheDocument();
  });

  it('does NOT close on backdrop click', () => {
    const onClose = vi.fn();
    const { container } = render(
      <RevealKeyModal open={true} onClose={onClose} created={sample} email="alice@x.com" />,
    );
    const backdrop = container.querySelector('[aria-hidden="true"]');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does NOT render the × close button', () => {
    render(
      <RevealKeyModal open={true} onClose={() => {}} created={sample} email="alice@x.com" />,
    );
    expect(screen.queryByLabelText('关闭')).toBeNull();
  });

  it('writes the plaintext to cache and closes when "我已保存好" is clicked', () => {
    const onClose = vi.fn();
    const setSpy = vi.spyOn(keyCache, 'setCachedKey');
    render(
      <RevealKeyModal open={true} onClose={onClose} created={sample} email="alice@x.com" />,
    );
    fireEvent.click(screen.getByText('我已保存好，关闭'));
    expect(setSpy).toHaveBeenCalledWith('alice@x.com', 'kid-1', 'sk-PLAINTEXT-FOREVER');
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/Sirius/Developer/tokenboss/frontend && npx vitest run src/components/__tests__/KeyModals.test.tsx`

Expected: FAIL — RevealKeyModal currently has × close, has overlay close, doesn't accept `email`, doesn't write cache.

- [ ] **Step 3: 修改 `RevealKeyModal` + 抽出一个不可关闭版本的 ModalShell**

In `frontend/src/components/KeyModals.tsx`, locate the existing `ModalShell` component (line 9-62). Right below it, add a second shell variant for the "must-acknowledge" case:

```typescript
/**
 * Variant of ModalShell for moments where dismissing without an explicit
 * action is unsafe (e.g., the "show once" plaintext reveal). No backdrop
 * click, no ×, no ESC — only the explicit acknowledge button can close it.
 */
function StickyModalShell({
  open,
  tag,
  title,
  children,
}: {
  open: boolean;
  tag: string;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-5" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/55" aria-hidden="true" />
      <div className="relative bg-white border-2 border-ink rounded-lg shadow-[6px_6px_0_0_#1C1917] max-w-[440px] w-full p-6">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[#A89A8D] font-bold mb-1">
              {tag}
            </div>
            <h2 className="text-[20px] font-bold tracking-tight text-ink leading-tight">{title}</h2>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
```

Now replace the entire `RevealKeyModal` component (lines 167-239 in the current file — the whole `export function RevealKeyModal(...) { ... }`) with:

```typescript
/**
 * Stage 2: one-shot reveal with a hard "I've saved it" gate. Dismissing
 * the modal commits the plaintext to localStorage cache (per-email,
 * per-keyId) — that's the ONLY moment we write the plaintext locally.
 * Once closed, the user can never see this value again from our UI.
 *
 * No × button, no backdrop close, no ESC — the ack button is the only
 * exit. Clipboard copy is a separate action; ack writes cache + closes.
 */
export function RevealKeyModal({
  open,
  onClose,
  created,
  email,
}: {
  open: boolean;
  onClose: () => void;
  created: CreatedProxyKey | null;
  email: string | undefined;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCopied(false);
  }, [open]);

  if (!created) return null;

  async function handleCopy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can long-press to select */
    }
  }

  function handleAcknowledge() {
    if (created && email) {
      // The single moment we commit plaintext to localStorage. Subsequent
      // reads (Dashboard install spell) come from this cache only.
      setCachedKey(email, String(created.keyId), created.key);
    }
    onClose();
  }

  return (
    <StickyModalShell open={open} tag="CREATED" title="API Key 已创建">
      <div className="bg-bg border-2 border-ink rounded-md p-3 mb-4">
        <div className="font-mono text-[12px] text-ink [word-break:break-all] leading-snug">
          {created.key}
        </div>
      </div>

      <button
        type="button"
        onClick={handleCopy}
        className={
          'w-full px-4 py-2.5 bg-ink text-white font-bold text-[13.5px] border-2 border-ink rounded ' +
          'shadow-[3px_3px_0_0_#E8692A] flex items-center justify-center gap-2 ' +
          'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#E8692A] ' +
          'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#E8692A] ' +
          'transition-all'
        }
      >
        {copied ? '已复制 ✓' : '复制 API Key'}
      </button>

      <div className="mt-4 border-2 border-ink rounded-md bg-amber-50 p-3 space-y-2">
        <div className="text-[12.5px] font-bold text-ink leading-snug">
          ⚠️ 立即保存这个 Key
        </div>
        <div className="text-[12px] text-[#6B5E52] leading-relaxed">
          此 Key 仅显示这一次。关闭后将永远无法再次查看。
        </div>
        <div className="text-[12.5px] font-bold text-ink leading-snug pt-1">
          💾 缓存在这台设备
        </div>
        <div className="text-[12px] text-[#6B5E52] leading-relaxed">
          我们会把这个 Key 缓存在浏览器 localStorage 里，让 Dashboard 的安装咒语继续可用。
          退出登录、清除浏览器数据或换设备时，缓存就消失 —— 届时唯一的办法是创建一个新 Key。
        </div>
      </div>

      <div className="mt-5">
        <button
          type="button"
          onClick={handleAcknowledge}
          className={
            'w-full px-4 py-2.5 bg-white text-ink font-bold text-[13.5px] border-2 border-ink rounded ' +
            'shadow-[2px_2px_0_0_#1C1917] ' +
            'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
            'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
            'transition-all'
          }
        >
          我已保存好，关闭
        </button>
      </div>
    </StickyModalShell>
  );
}
```

Then update the imports at the top of the file. The current first line:

```ts
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, type CreatedProxyKey, type ProxyKeySummary } from '../lib/api';
```

Add a second import line below for `setCachedKey`:

```ts
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, type CreatedProxyKey, type ProxyKeySummary } from '../lib/api';
import { setCachedKey } from '../lib/keyCache';
```

- [ ] **Step 4: 在 Dashboard 把 `email` prop 传进去**

`Dashboard.tsx` 已经在用 `RevealKeyModal`。Find every render of `<RevealKeyModal ... />` (likely just one) and add the `email={user?.email}` prop. Search:

```bash
cd /Users/Sirius/Developer/tokenboss/frontend && grep -n "RevealKeyModal" src/screens/Dashboard.tsx
```

For each match, edit so the prop is passed. Example transformation:

```tsx
<RevealKeyModal
  open={!!justCreated}
  onClose={closeReveal}
  created={justCreated}
/>
```

becomes:

```tsx
<RevealKeyModal
  open={!!justCreated}
  onClose={closeReveal}
  created={justCreated}
  email={user?.email}
/>
```

- [ ] **Step 5: 跑测试 + typecheck**

Run: `cd /Users/Sirius/Developer/tokenboss/frontend && npx vitest run src/components/__tests__/KeyModals.test.tsx && npx tsc --noEmit`

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/Sirius/Developer/tokenboss
git add frontend/src/components/KeyModals.tsx frontend/src/components/__tests__/KeyModals.test.tsx frontend/src/screens/Dashboard.tsx
git commit -m "feat(keys): RevealKeyModal 强制确认 + 写 localStorage 缓存 — 显示一次承诺生效"
```

---

## Task 8: 前端 — `CreateKeyModal` 加有效期下拉

**Files:**
- Modify: `frontend/src/components/KeyModals.tsx:70-165`
- Modify: `frontend/src/components/__tests__/KeyModals.test.tsx`

- [ ] **Step 1: 写失败测试**

Append to `frontend/src/components/__tests__/KeyModals.test.tsx`:

```typescript
import { CreateKeyModal } from '../KeyModals';
import * as apiModule from '../../lib/api';

describe('CreateKeyModal — expiresInDays select', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to "永久不过期" and submits without expiresInDays', async () => {
    const createSpy = vi.spyOn(apiModule.api, 'createKey').mockResolvedValue({
      keyId: 'k1',
      key: 'sk-x',
      label: 'default',
      createdAt: '2026-05-02T00:00:00Z',
      expiresAt: null,
    });

    render(<CreateKeyModal open={true} onClose={() => {}} onCreated={() => {}} />);
    fireEvent.click(screen.getByText('创建'));

    await vi.waitFor(() => expect(createSpy).toHaveBeenCalled());
    const arg = createSpy.mock.calls[0][0];
    expect(arg.expiresInDays).toBeUndefined();
  });

  it('selecting "30 天" submits expiresInDays: 30', async () => {
    const createSpy = vi.spyOn(apiModule.api, 'createKey').mockResolvedValue({
      keyId: 'k1',
      key: 'sk-x',
      label: 'temp',
      createdAt: '2026-05-02T00:00:00Z',
      expiresAt: '2026-06-01T00:00:00Z',
    });

    render(<CreateKeyModal open={true} onClose={() => {}} onCreated={() => {}} />);
    fireEvent.change(screen.getByLabelText('有效期'), { target: { value: '30' } });
    fireEvent.click(screen.getByText('创建'));

    await vi.waitFor(() => expect(createSpy).toHaveBeenCalled());
    expect(createSpy.mock.calls[0][0].expiresInDays).toBe(30);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/Sirius/Developer/tokenboss/frontend && npx vitest run src/components/__tests__/KeyModals.test.tsx -t "CreateKeyModal"`

Expected: FAIL — no expiry select exists.

- [ ] **Step 3: 加有效期下拉**

In `frontend/src/components/KeyModals.tsx`, locate the `CreateKeyModal` component (around line 70-165). Inside the function, add new state below the existing `useState` calls:

```ts
  // Expiry as days-from-now. '' = permanent (default), or a positive int.
  const [expiresInDays, setExpiresInDays] = useState<string>('');
```

Update the `useEffect` reset block (around line 86-91) so it also clears expiry on each open:

```ts
  useEffect(() => {
    if (!open) return;
    setLabel('');
    setError(null);
    setSubmitting(false);
    setExpiresInDays('');  // NEW
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);
```

Update `handleSubmit` to include `expiresInDays` when set:

```ts
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const days = expiresInDays.trim();
      const created = await api.createKey({
        label: label.trim() || undefined,
        ...(days ? { expiresInDays: Number(days) } : {}),
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `创建失败: ${(err as Error).message}`);
      setSubmitting(false);
    }
  }
```

Insert the expiry select right after the existing name input field (after the closing `<input ... />` for the label, before the `{error && (...)` block). The block to ADD:

```tsx
        <label
          htmlFor="key-expires"
          className="block font-mono text-[10.5px] tracking-[0.16em] uppercase text-[#A89A8D] font-bold mt-4 mb-2"
        >
          有效期
        </label>
        <select
          id="key-expires"
          value={expiresInDays}
          onChange={(e) => setExpiresInDays(e.target.value)}
          className={
            'w-full px-3.5 py-2.5 bg-white border-2 border-ink rounded text-[14px] text-ink ' +
            'shadow-[2px_2px_0_0_#1C1917] ' +
            'focus:outline-none focus:translate-x-[1px] focus:translate-y-[1px] focus:shadow-[1px_1px_0_0_#1C1917] ' +
            'transition-all'
          }
        >
          <option value="">永久不过期（默认）</option>
          <option value="30">30 天</option>
          <option value="7">7 天</option>
          <option value="1">24 小时</option>
        </select>
```

- [ ] **Step 4: 跑测试 + typecheck**

Run: `cd /Users/Sirius/Developer/tokenboss/frontend && npx vitest run src/components/__tests__/KeyModals.test.tsx && npx tsc --noEmit`

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/Sirius/Developer/tokenboss
git add frontend/src/components/KeyModals.tsx frontend/src/components/__tests__/KeyModals.test.tsx
git commit -m "feat(keys): CreateKeyModal 加有效期下拉 — 默认永久 / 30天 / 7天 / 24小时"
```

---

## Task 9: 前端 — `APIKeyList` 删 Copy + 加有效期标签

**Files:**
- Modify: `frontend/src/components/APIKeyList.tsx`
- Create: `frontend/src/components/__tests__/APIKeyList.test.tsx`

- [ ] **Step 1: 写失败测试**

Create `frontend/src/components/__tests__/APIKeyList.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { APIKeyList } from '../APIKeyList';

const baseKey = (over: Partial<any> = {}) => ({
  keyId: 'k1',
  key: 'sk-•••a4c2',
  label: 'default',
  createdAt: '2026-04-15T00:00:00Z',
  disabled: false,
  expiresAt: null,
  ...over,
});

describe('APIKeyList', () => {
  it('does NOT render any "复制" button', () => {
    render(
      <APIKeyList
        keys={[baseKey()]}
        loadError={null}
        keyStats={new Map()}
        onCreateClick={() => {}}
        onDeleteClick={() => {}}
      />,
    );
    expect(screen.queryByLabelText(/复制/)).toBeNull();
  });

  it('renders "永久" for keys with expiresAt = null', () => {
    render(
      <APIKeyList
        keys={[baseKey()]}
        loadError={null}
        keyStats={new Map()}
        onCreateClick={() => {}}
        onDeleteClick={() => {}}
      />,
    );
    expect(screen.getByText(/永久/)).toBeInTheDocument();
  });

  it('renders "X 天后过期" for future expiry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-02T12:00:00Z'));
    const future = new Date('2026-05-25T12:00:00Z').toISOString();
    render(
      <APIKeyList
        keys={[baseKey({ expiresAt: future })]}
        loadError={null}
        keyStats={new Map()}
        onCreateClick={() => {}}
        onDeleteClick={() => {}}
      />,
    );
    expect(screen.getByText(/23 天后过期/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('renders 已过期 badge for expired keys and hides the delete pending state', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-13T12:00:00Z'));
    const past = new Date('2026-05-01T12:00:00Z').toISOString();
    render(
      <APIKeyList
        keys={[baseKey({ expiresAt: past })]}
        loadError={null}
        keyStats={new Map()}
        onCreateClick={() => {}}
        onDeleteClick={() => {}}
      />,
    );
    expect(screen.getByText('已过期')).toBeInTheDocument();
    expect(screen.getByText(/已过期 12 天/)).toBeInTheDocument();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/Sirius/Developer/tokenboss/frontend && npx vitest run src/components/__tests__/APIKeyList.test.tsx`

Expected: 4 failures.

- [ ] **Step 3: 改 `APIKeyList.tsx`**

Replace the entire content of `frontend/src/components/APIKeyList.tsx` with:

```tsx
import type { ProxyKeySummary } from '../lib/api';
import { isExpired, expiryLabel } from '../lib/keyExpiry';

export interface KeyStats {
  callCount: number;
  totalSpent: number;
  lastUsedAt: string;  // ISO
}

export interface APIKeyListProps {
  /** Keys passed in from the parent (Dashboard owns the list now). */
  keys: ProxyKeySummary[];
  /** Error string from the parent's load attempt, if any. */
  loadError: string | null;
  /** Map of key label → derived stats, computed from /v1/usage. */
  keyStats: Map<string, KeyStats>;
  /** Click on `+ 创建` — parent opens CreateKeyModal. */
  onCreateClick: () => void;
  /** Click on the trash icon — parent opens DeleteKeyModal pre-loaded with `target`. */
  onDeleteClick: (target: ProxyKeySummary) => void;
}

/**
 * Inline list of the user's TokenBoss proxy keys. Each row shows label,
 * masked key, expiry label, usage stats, and a delete button.
 *
 * NOTE: there is no "copy" affordance here on purpose. The plaintext
 * is shown exactly once (at create time, in RevealKeyModal); after that
 * the only place it survives is the per-device localStorage cache, used
 * by Dashboard's install spell. If a user needs the plaintext on a new
 * device, they create a new key.
 */
export function APIKeyList({ keys, loadError, keyStats, onCreateClick, onDeleteClick }: APIKeyListProps) {
  return (
    <div>
      {loadError && (
        <div className="text-[12px] text-red-ink font-medium py-1 mb-2">{loadError}</div>
      )}

      <button
        type="button"
        onClick={onCreateClick}
        className={
          'block text-center w-full mb-3 px-4 py-2 bg-white border-2 border-dashed border-ink rounded ' +
          'text-[12.5px] font-bold tracking-tight text-ink ' +
          'shadow-[3px_3px_0_0_#1C1917] ' +
          'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
          'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
          'transition-all'
        }
      >
        + 创建 API Key
      </button>

      {keys.length === 0 && (
        <div className="font-mono text-[11px] text-[#A89A8D] py-2 text-center">
          还没有 Key · 点上面 + 创建 一个
        </div>
      )}

      {keys.map((k, i) => {
        const stats = keyStats.get(k.label || 'default');
        const expired = isExpired(k);
        const dotClass = k.disabled || expired ? 'bg-[#A89A8D]' : 'bg-lime-stamp';
        return (
          <div
            key={k.keyId}
            className={`py-2.5 ${i < keys.length - 1 ? 'border-b border-ink/10' : ''}`}
          >
            <div className="flex items-center justify-between mb-1.5 gap-2">
              <span className="text-[12.5px] font-bold text-ink flex items-center gap-1.5 min-w-0">
                <span
                  className={`w-2 h-2 border-2 border-ink rounded-full flex-shrink-0 ${dotClass}`}
                />
                <span className="truncate">{k.label || 'default'}</span>
              </span>
              <div className="flex items-center gap-2 flex-shrink-0">
                {expired && (
                  <span className="font-mono text-[10px] font-bold tracking-wider uppercase px-1.5 py-0.5 border-2 border-[#D9CEC2] rounded text-[#A89A8D]">
                    已过期
                  </span>
                )}
                {!expired && k.disabled && (
                  <span className="font-mono text-[10px] font-bold tracking-wider uppercase px-1.5 py-0.5 border-2 border-[#D9CEC2] rounded text-[#A89A8D]">
                    已吊销
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onDeleteClick(k)}
                  aria-label={`删除 ${k.label || 'default'}`}
                  className={
                    'flex-shrink-0 w-6 h-6 inline-flex items-center justify-center border-2 border-ink rounded ' +
                    'text-ink hover:bg-red-soft hover:text-red-ink transition-colors'
                  }
                >
                  <TrashIcon />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="flex-1 min-w-0 font-mono text-[11px] text-ink bg-bg border-2 border-ink px-2 py-1.5 rounded truncate">
                {k.key}
              </span>
            </div>

            <div className="font-mono text-[10px] text-[#A89A8D] mt-1 flex items-center justify-between gap-2">
              <span>
                创建于 {new Date(k.createdAt).toLocaleDateString('zh-CN')} · {expiryLabel(k)}
              </span>
              {stats ? (
                <span className="text-ink-2">
                  {timeAgo(stats.lastUsedAt)} · {stats.callCount} 次 · ${stats.totalSpent.toFixed(6)}
                </span>
              ) : (
                <span>未使用</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2.5 3.5H9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4.5 3.5V2.5C4.5 2.22 4.72 2 5 2H7C7.28 2 7.5 2.22 7.5 2.5V3.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3.5 3.5L4 9.5C4 9.78 4.22 10 4.5 10H7.5C7.78 10 8 9.78 8 9.5L8.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function timeAgo(iso: string): string {
  const diffSec = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s 前`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m 前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h 前`;
  return `${Math.floor(diffSec / 86400)}d 前`;
}
```

Note: this removes `useState`, `api`, `ApiError` imports (no longer used) and `CopyIcon`. The whole `handleCopy` flow is gone.

- [ ] **Step 4: 跑测试 + typecheck**

Run: `cd /Users/Sirius/Developer/tokenboss/frontend && npx vitest run src/components/__tests__/APIKeyList.test.tsx && npx tsc --noEmit`

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/Sirius/Developer/tokenboss
git add frontend/src/components/APIKeyList.tsx frontend/src/components/__tests__/APIKeyList.test.tsx
git commit -m "feat(keys): APIKeyList 删 Copy 按钮 + 加有效期标签 — 兑现"显示一次"承诺"
```

---

## Task 10: 前端 — Dashboard `defaultKey` 过滤 + 缓存 miss 兜底 + cache sweep

**Files:**
- Modify: `frontend/src/screens/Dashboard.tsx:253-268, listKeys 调用点`
- Create: `frontend/src/screens/__tests__/Dashboard.test.tsx`

- [ ] **Step 1: 读现有 Dashboard 结构定位关键点**

Run: `cd /Users/Sirius/Developer/tokenboss/frontend && grep -n "defaultKey\|cachedDefaultPlain\|spellResolver\|spellExtra\|reloadKeys\|listKeys" src/screens/Dashboard.tsx | head -30`

Note the line numbers. The plan that follows assumes:
- `defaultKey` selection is at ~line 253
- `spellExtra` / `spellResolver` are at ~lines 256-268
- `reloadKeys` (the function that calls `api.listKeys()`) is somewhere above

If line numbers shifted from earlier tasks (Task 7 added an `email` prop), use the grep output to find the actual current locations.

- [ ] **Step 2: 写失败测试**

Create `frontend/src/screens/__tests__/Dashboard.test.tsx`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as apiModule from '../../lib/api';
import * as keyCache from '../../lib/keyCache';
import * as authModule from '../../lib/auth';
import Dashboard from '../Dashboard';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();

  // Stub auth so Dashboard renders.
  vi.spyOn(authModule, 'useAuth').mockReturnValue({
    user: {
      userId: 'u_1',
      email: 'alice@x.com',
      emailVerified: true,
      balance: 0,
      createdAt: '2026-04-01T00:00:00Z',
    },
    session: { token: 't' } as any,
    loading: false,
    setSession: () => {},
    logout: () => {},
    refreshUser: async () => {},
  } as any);

  // Stub minimal API surface.
  vi.spyOn(apiModule.api, 'getBuckets').mockResolvedValue({ buckets: [] });
  vi.spyOn(apiModule.api, 'getUsage').mockResolvedValue({ records: [], totals: { consumed: 0, calls: 0 }, hourly24h: [] } as any);
});

const renderDashboard = () =>
  render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );

describe('Dashboard install spell — cache hit / miss', () => {
  it('renders plaintext when cache has the default key', async () => {
    vi.spyOn(apiModule.api, 'listKeys').mockResolvedValue({
      keys: [
        {
          keyId: 'k-default',
          key: 'sk-•••a4c2',
          label: 'default',
          createdAt: '2026-04-15T00:00:00Z',
          disabled: false,
          expiresAt: null,
        },
      ],
    });
    keyCache.setCachedKey('alice@x.com', 'k-default', 'sk-PLAINTEXT-XYZ');

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/sk-PLAINTEXT-XYZ/)).toBeInTheDocument();
    });
    expect(screen.getByText(/本地缓存 · 退出登录后将消失/)).toBeInTheDocument();
  });

  it('renders masked + CTA when cache miss for the default key', async () => {
    vi.spyOn(apiModule.api, 'listKeys').mockResolvedValue({
      keys: [
        {
          keyId: 'k-default',
          key: 'sk-•••a4c2',
          label: 'default',
          createdAt: '2026-04-15T00:00:00Z',
          disabled: false,
          expiresAt: null,
        },
      ],
    });
    // No cache entry written.

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/这台设备没有该 Key 的本地缓存/)).toBeInTheDocument();
    });
    expect(screen.getByText('为这台设备创建一个新 Key')).toBeInTheDocument();
    // Plaintext value is NOT shown — only the masked one.
    expect(screen.queryByText(/sk-PLAINTEXT/)).toBeNull();
  });

  it('skips disabled and expired keys when picking the default', async () => {
    vi.spyOn(apiModule.api, 'listKeys').mockResolvedValue({
      keys: [
        {
          keyId: 'k-disabled',
          key: 'sk-•••dead',
          label: 'default',
          createdAt: '2026-04-15T00:00:00Z',
          disabled: true,
          expiresAt: null,
        },
        {
          keyId: 'k-expired',
          key: 'sk-•••0aab',
          label: 'old',
          createdAt: '2026-03-01T00:00:00Z',
          disabled: false,
          expiresAt: '2026-04-01T00:00:00Z',
        },
        {
          keyId: 'k-good',
          key: 'sk-•••f00d',
          label: 'good',
          createdAt: '2026-04-20T00:00:00Z',
          disabled: false,
          expiresAt: null,
        },
      ],
    });
    keyCache.setCachedKey('alice@x.com', 'k-good', 'sk-PLAINTEXT-GOOD');

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/sk-PLAINTEXT-GOOD/)).toBeInTheDocument();
    });
  });

  it('sweeps cache entries for keys no longer in the list', async () => {
    vi.spyOn(apiModule.api, 'listKeys').mockResolvedValue({
      keys: [
        {
          keyId: 'k-survive',
          key: 'sk-•••f00d',
          label: 'default',
          createdAt: '2026-04-15T00:00:00Z',
          disabled: false,
          expiresAt: null,
        },
      ],
    });
    keyCache.setCachedKey('alice@x.com', 'k-survive', 'sk-A');
    keyCache.setCachedKey('alice@x.com', 'k-orphan', 'sk-B');

    renderDashboard();

    await waitFor(() => {
      expect(keyCache.getCachedKey('alice@x.com', 'k-orphan')).toBeNull();
    });
    expect(keyCache.getCachedKey('alice@x.com', 'k-survive')).toBe('sk-A');
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd /Users/Sirius/Developer/tokenboss/frontend && npx vitest run src/screens/__tests__/Dashboard.test.tsx`

Expected: All 4 fail (Dashboard doesn't have these behaviors yet — the spellResolver still calls revealKey, no CTA, no sweep).

- [ ] **Step 4: 改 `defaultKey` 过滤 + 删掉 spellResolver**

In `frontend/src/screens/Dashboard.tsx`, locate the `defaultKey` line (around line 253):

```ts
  const defaultKey = keys.find((k) => k.label === 'default') ?? keys[0];
```

Replace with:

```ts
  const defaultKey =
    keys.find((k) => k.label === 'default' && !k.disabled && !isExpired(k)) ??
    keys.find((k) => !k.disabled && !isExpired(k));
```

Then locate the `spellExtra` / `spellResolver` block (around lines 256-268). The current implementation reads cache and falls back to `revealKey`. Replace the whole block with a cache-only read:

```ts
  const cachedDefaultPlain =
    user?.email && defaultKey ? getCachedKey(user.email, String(defaultKey.keyId)) : null;
  const spellExtra =
    defaultKey && cachedDefaultPlain
      ? `TOKENBOSS_API_KEY=${cachedDefaultPlain}`
      : defaultKey
      ? `TOKENBOSS_API_KEY=${defaultKey.key}`  // masked fallback
      : undefined;
  // No spellResolver — cache is the only source of plaintext now.
```

Then ensure `isExpired` and `getCachedKey` are imported at the top of `Dashboard.tsx`. Search for existing imports of `keyCache`. Add as needed:

```ts
import { isExpired } from '../lib/keyExpiry';
import { getCachedKey, clearCachedKey } from '../lib/keyCache';
```

(`clearCachedKey` is needed for sweep in step 6.)

If a `<TerminalBlock ... />` (or similar) component is rendered with `spellResolver={spellResolver}`, also remove the prop pass — it has no purpose anymore.

- [ ] **Step 5: 加缓存 miss 时的 CTA UI**

Right above where the install spell is rendered, add a conditional block. Search for where `spellExtra` or the install snippet block is in JSX:

```bash
grep -n "TOKENBOSS_API_KEY\|spellExtra\|TerminalBlock" src/screens/Dashboard.tsx | head
```

Once located, around the install snippet, change the rendering structure so that a `defaultKey && !cachedDefaultPlain` branch shows a CTA block:

```tsx
{defaultKey && cachedDefaultPlain && (
  <p className="font-mono text-[10.5px] text-[#A89A8D] mt-1">
    💾 本地缓存 · 退出登录后将消失
  </p>
)}

{defaultKey && !cachedDefaultPlain && (
  <div className="mt-2 border-2 border-ink rounded-md bg-amber-50 p-3 text-[12.5px] leading-relaxed">
    <div className="font-bold text-ink mb-1">📍 这台设备没有该 Key 的本地缓存</div>
    <div className="text-[#6B5E52] mb-2">
      为了你的安全，明文不能在新设备上重新查看。
    </div>
    <button
      type="button"
      onClick={() => setCreateOpen(true)}
      className={
        'px-3 py-1.5 bg-ink text-white font-bold text-[12px] border-2 border-ink rounded ' +
        'shadow-[2px_2px_0_0_#E8692A] ' +
        'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#E8692A] ' +
        'transition-all'
      }
    >
      为这台设备创建一个新 Key
    </button>
  </div>
)}
```

Adapt the button's onClick to whatever opens the existing CreateKeyModal in this file (`setCreateOpen(true)` based on the spec excerpt; verify by grep).

- [ ] **Step 6: 加 cache sweep — 列表加载后清掉 orphan 条目**

Find `reloadKeys` (or the function that calls `api.listKeys()` and `setKeys(...)`). Right after the `setKeys(...)` call, add the sweep logic:

```ts
async function reloadKeys() {
  try {
    const resp = await api.listKeys();
    setKeys(resp.keys);
    setKeysLoadError(null);

    // Sweep: any cached plaintext for keyIds no longer in the list is
    // stale (the key was deleted, possibly from another device). Collect
    // first, delete after — mutating localStorage mid-iteration shifts
    // indices and can skip entries.
    if (user?.email) {
      const present = new Set(resp.keys.map((k) => String(k.keyId)));
      const prefix = `tb_key_v1:${user.email}:`;
      const orphanIds: string[] = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const lk = localStorage.key(i);
          if (lk && lk.startsWith(prefix)) {
            const cachedId = lk.slice(prefix.length);
            if (!present.has(cachedId)) orphanIds.push(cachedId);
          }
        }
        orphanIds.forEach((id) => clearCachedKey(user.email!, id));
      } catch { /* private mode */ }
    }
  } catch (err) {
    setKeysLoadError((err as Error).message);
  }
}
```

(adjust to the actual surrounding code structure — the `setKeys` / `setKeysLoadError` names may differ slightly).

- [ ] **Step 7: 跑测试 + typecheck**

Run: `cd /Users/Sirius/Developer/tokenboss/frontend && npx vitest run src/screens/__tests__/Dashboard.test.tsx && npx tsc --noEmit`

Expected: All pass.

- [ ] **Step 8: Commit**

```bash
cd /Users/Sirius/Developer/tokenboss
git add frontend/src/screens/Dashboard.tsx frontend/src/screens/__tests__/Dashboard.test.tsx
git commit -m "feat(dashboard): defaultKey 过滤 disabled/expired + 缓存 miss 兜底 CTA + listKeys 后清 orphan 缓存"
```

---

## Task 11: 前端 — `OnboardInstall` 改成 createKey 流程 + 边缘确认弹窗

**Files:**
- Modify: `frontend/src/screens/OnboardInstall.tsx`
- Create: `frontend/src/screens/__tests__/OnboardInstall.test.tsx`

- [ ] **Step 1: 写失败测试**

Create `frontend/src/screens/__tests__/OnboardInstall.test.tsx`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as apiModule from '../../lib/api';
import * as keyCache from '../../lib/keyCache';
import * as authModule from '../../lib/auth';
import OnboardInstall from '../OnboardInstall';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(authModule, 'useAuth').mockReturnValue({
    user: {
      userId: 'u_1',
      email: 'alice@x.com',
      emailVerified: true,
      balance: 0,
      createdAt: '2026-04-01T00:00:00Z',
    },
    session: { token: 't' } as any,
    loading: false,
    setSession: () => {},
    logout: () => {},
    refreshUser: async () => {},
  } as any);
});

const renderIt = () =>
  render(
    <MemoryRouter>
      <OnboardInstall />
    </MemoryRouter>,
  );

describe('OnboardInstall — new flow', () => {
  it('new user (0 keys) creates default + caches plaintext', async () => {
    vi.spyOn(apiModule.api, 'listKeys').mockResolvedValue({ keys: [] });
    vi.spyOn(apiModule.api, 'createKey').mockResolvedValue({
      keyId: 'k-new',
      key: 'sk-NEW-PLAINTEXT',
      label: 'default',
      createdAt: '2026-05-02T00:00:00Z',
      expiresAt: null,
    });

    renderIt();

    await waitFor(() => {
      expect(screen.getByText(/sk-NEW-PLAINTEXT/)).toBeInTheDocument();
    });
    expect(keyCache.getCachedKey('alice@x.com', 'k-new')).toBe('sk-NEW-PLAINTEXT');
  });

  it('cache hit (existing default with cached plaintext) renders without calling createKey', async () => {
    vi.spyOn(apiModule.api, 'listKeys').mockResolvedValue({
      keys: [
        {
          keyId: 'k-existing',
          key: 'sk-•••abcd',
          label: 'default',
          createdAt: '2026-04-15T00:00:00Z',
          disabled: false,
          expiresAt: null,
        },
      ],
    });
    const createSpy = vi.spyOn(apiModule.api, 'createKey');
    keyCache.setCachedKey('alice@x.com', 'k-existing', 'sk-CACHED-PLAINTEXT');

    renderIt();

    await waitFor(() => {
      expect(screen.getByText(/sk-CACHED-PLAINTEXT/)).toBeInTheDocument();
    });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('edge case (existing default, cache miss) shows confirm modal — confirm rebuilds', async () => {
    vi.spyOn(apiModule.api, 'listKeys').mockResolvedValue({
      keys: [
        {
          keyId: 'k-stale',
          key: 'sk-•••abcd',
          label: 'default',
          createdAt: '2026-04-15T00:00:00Z',
          disabled: false,
          expiresAt: null,
        },
      ],
    });
    const deleteSpy = vi.spyOn(apiModule.api, 'deleteKey').mockResolvedValue({ ok: true });
    const createSpy = vi.spyOn(apiModule.api, 'createKey').mockResolvedValue({
      keyId: 'k-fresh',
      key: 'sk-FRESH-PLAINTEXT',
      label: 'default',
      createdAt: '2026-05-02T00:00:00Z',
      expiresAt: null,
    });

    renderIt();

    await waitFor(() => {
      expect(screen.getByText(/旧 Key 将被吊销/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('吊销旧 Key 并生成新的'));

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith('k-stale');
      expect(createSpy).toHaveBeenCalled();
      expect(screen.getByText(/sk-FRESH-PLAINTEXT/)).toBeInTheDocument();
    });
    expect(keyCache.getCachedKey('alice@x.com', 'k-fresh')).toBe('sk-FRESH-PLAINTEXT');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/Sirius/Developer/tokenboss/frontend && npx vitest run src/screens/__tests__/OnboardInstall.test.tsx`

Expected: All 3 fail.

- [ ] **Step 3: 重写 `OnboardInstall.tsx`**

Replace the entire content of `frontend/src/screens/OnboardInstall.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TerminalBlock } from '../components/TerminalBlock';
import { OnboardShell } from '../components/OnboardShell';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { getCachedKey, setCachedKey } from '../lib/keyCache';
import { isExpired } from '../lib/keyExpiry';
import { slockBtn } from '../lib/slockBtn';

/**
 * Step 02 — paste-and-go. Resolves the user's default API key plaintext:
 * 1) cache hit → render (most common after first visit)
 * 2) no key yet → createKey + cache + render
 * 3) edge: existing default but cache miss → confirm rebuild, then 1+2
 *
 * The page itself IS the "shown once" moment: user is about to paste the
 * key into their AI client. We write to localStorage immediately on receipt.
 */
export default function OnboardInstall() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [waiting, setWaiting] = useState(true);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [needsRebuild, setNeedsRebuild] = useState<{ existingKeyId: string } | null>(null);
  const [rebuilding, setRebuilding] = useState(false);

  useEffect(() => {
    if (!user?.email) return;
    let cancelled = false;

    async function bootstrap(email: string) {
      try {
        const { keys } = await api.listKeys();
        if (cancelled) return;

        // Look for a USABLE existing default — not disabled, not expired.
        // Disabled / expired keys don't serve the user even if cached, so
        // we treat them the same as the edge case (rebuild required).
        const existing = keys.find(
          (k) => k.label === 'default' && !k.disabled && !isExpired(k),
        );
        if (existing) {
          const cached = getCachedKey(email, String(existing.keyId));
          if (cached) {
            setApiKey(cached);
            return;
          }
          // Edge: stale default, plaintext lost on this browser. Ask user.
          setNeedsRebuild({ existingKeyId: String(existing.keyId) });
          return;
        }
        // If only disabled/expired defaults exist, prompt rebuild for the
        // first such key so the user can replace it instead of getting
        // silently stuck.
        const stale = keys.find((k) => k.label === 'default');
        if (stale) {
          setNeedsRebuild({ existingKeyId: String(stale.keyId) });
          return;
        }

        // Normal new-user path: 0 keys → create default
        await createDefaultKey(email);
      } catch (e) {
        if (!cancelled) setKeyError((e as Error).message);
      }
    }

    async function createDefaultKey(email: string) {
      const created = await api.createKey({ label: 'default' });
      if (cancelled) return;
      setCachedKey(email, String(created.keyId), created.key);
      setApiKey(created.key);
    }

    bootstrap(user.email);

    return () => {
      cancelled = true;
    };
  }, [user?.email]);

  // Eventually replaced by polling /v1/usage for the first chat call.
  useEffect(() => {
    if (!apiKey) return;
    const timer = setTimeout(() => setWaiting(false), 3000);
    return () => clearTimeout(timer);
  }, [apiKey]);

  async function handleConfirmRebuild() {
    if (!user?.email || !needsRebuild) return;
    setRebuilding(true);
    setKeyError(null);
    try {
      await api.deleteKey(needsRebuild.existingKeyId);
      const created = await api.createKey({ label: 'default' });
      setCachedKey(user.email, String(created.keyId), created.key);
      setApiKey(created.key);
      setNeedsRebuild(null);
    } catch (e) {
      setKeyError((e as Error).message);
    } finally {
      setRebuilding(false);
    }
  }

  return (
    <OnboardShell
      step="02"
      cnLabel="发咒语"
      enLabel="Send to Agent"
      title="一行就接好。"
      width="lg"
    >
      <TerminalBlock
        cmd="set up tokenboss.co/skill.md"
        extra={apiKey ? `TOKENBOSS_API_KEY=${apiKey}` : undefined}
        loading={!apiKey && !keyError && !needsRebuild}
        size="lg"
        className="mb-4"
        prompt={
          <>
            <span aria-hidden="true" className="mr-1.5">↓</span>
            把这两行整体发给你的 Agent
            <span className="text-white/40 mx-1.5">·</span>
            30 秒自动接入
            <span className="text-white/40 mx-1.5">·</span>
            <span className="text-white">$10 试用立刻能用</span>
          </>
        }
      />

      {apiKey && (
        <p className="font-mono text-[10.5px] text-[#A89A8D] mt-1 mb-3">
          这是你第一次也是唯一一次看到完整 Key — 装好客户端后请妥善保存。
        </p>
      )}

      {keyError && (
        <p className="font-mono text-[11px] text-accent mb-2">{keyError}</p>
      )}

      {needsRebuild && (
        <div className="mt-3 border-2 border-ink rounded-md bg-amber-50 p-4">
          <div className="text-[14px] font-bold text-ink mb-2">要重新生成 Key 吗？</div>
          <p className="text-[13px] text-[#6B5E52] leading-relaxed mb-2">
            你之前的 default Key 还在 newapi 那边可用，但<strong>这个浏览器没有它的明文缓存</strong>
            ——为了你的安全，明文不能在新设备上再次显示。
          </p>
          <p className="text-[13px] text-[#6B5E52] leading-relaxed mb-3">
            继续的话，<strong>旧 Key 将被吊销</strong>，任何已经绑定它的客户端都会停止工作。
          </p>
          <button
            type="button"
            onClick={handleConfirmRebuild}
            disabled={rebuilding}
            className={
              'px-3 py-1.5 bg-ink text-white font-bold text-[13px] border-2 border-ink rounded ' +
              'shadow-[2px_2px_0_0_#E8692A] ' +
              'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#E8692A] ' +
              'disabled:opacity-50 disabled:cursor-not-allowed transition-all'
            }
          >
            {rebuilding ? '处理中…' : '吊销旧 Key 并生成新的'}
          </button>
        </div>
      )}

      <button
        type="button"
        disabled={waiting || !apiKey}
        onClick={() => nav('/onboard/success')}
        className={slockBtn({ size: 'md', tone: 'primary', disabled: waiting || !apiKey })}
      >
        {waiting ? '等 Agent 接入…' : '我已经发给它了'}
      </button>
    </OnboardShell>
  );
}
```

Note: the existing OnboardShell / TerminalBlock / slockBtn invocations at the bottom may differ slightly from this scaffold — preserve whatever the existing onboarding chrome was. The point is the data-flow rewrite at the top + the rebuild confirmation block + the small "first and only time" note.

- [ ] **Step 4: 跑测试 + typecheck**

Run: `cd /Users/Sirius/Developer/tokenboss/frontend && npx vitest run src/screens/__tests__/OnboardInstall.test.tsx && npx tsc --noEmit`

Expected: All pass. If typecheck fails, the most likely culprit is the `OnboardShell` / `TerminalBlock` props — adjust to match the actual signatures.

- [ ] **Step 5: Commit**

```bash
cd /Users/Sirius/Developer/tokenboss
git add frontend/src/screens/OnboardInstall.tsx frontend/src/screens/__tests__/OnboardInstall.test.tsx
git commit -m "feat(onboard): OnboardInstall 改用 createKey + 写缓存 + 边缘确认弹窗 (revealKey 移除)"
```

---

## Task 12: 前端 — 删除 `api.revealKey` 客户端方法（最终清理）

**Files:**
- Modify: `frontend/src/lib/api.ts:401-405`

- [ ] **Step 1: 确认无任何剩余引用**

Run: `cd /Users/Sirius/Developer/tokenboss/frontend && grep -rn "revealKey\b" src/ --include="*.ts" --include="*.tsx"`

Expected: only the definition in `api.ts:401-405` should remain. If any caller still references it, fix or revert — the previous tasks should have removed all usages.

- [ ] **Step 2: 删除方法**

In `frontend/src/lib/api.ts`, find:

```ts
  revealKey(keyId: string): Promise<{ keyId: number; key: string }> {
    return request<{ keyId: number; key: string }>(
      `/v1/keys/${encodeURIComponent(keyId)}/reveal`,
    );
  },
```

Delete those lines.

- [ ] **Step 3: 跑全量前端测试 + typecheck + 构建**

Run: `cd /Users/Sirius/Developer/tokenboss/frontend && npx tsc --noEmit && npx vitest run && npm run build`

Expected: All pass; build succeeds. If `tsc` complains about stale references to `revealKey`, search again with grep and remove them.

- [ ] **Step 4: Commit**

```bash
cd /Users/Sirius/Developer/tokenboss
git add frontend/src/lib/api.ts
git commit -m "chore(api): 删除 api.revealKey 客户端方法 — 端点已下线"
```

---

## Task 13: 端到端 smoke test

**Goal:** 把整个流程在本地跑一遍，确认设计文档里的关键场景都活的。

- [ ] **Step 1: 起后端 + 前端**

In two terminals:

```bash
# Terminal A — backend
cd /Users/Sirius/Developer/tokenboss/backend
npm run dev

# Terminal B — frontend
cd /Users/Sirius/Developer/tokenboss/frontend
npm run dev
```

- [ ] **Step 2: 走「全新用户」路径**

In a clean browser session (incognito or cleared localStorage):

1. 访问前端，注册一个新邮箱
2. 验证邮箱 → 进入 OnboardInstall
3. 验证：页面渲染了一个完整的 `sk-...` 明文（不是掩码）
4. 验证：DevTools → Application → Local Storage → 有一个 `tb_key_v1:<email>:<keyId>` 条目
5. 完成 onboarding，进 Dashboard
6. 验证：安装咒语显示完整明文 + 下方"💾 本地缓存 · 退出登录后将消失"

- [ ] **Step 3: 走「显示一次」路径**

1. 在 Dashboard 点 `+ 创建 API Key`
2. 输入 `test-temp`，有效期选「7 天」
3. 验证创建后的弹窗：
   - 大块明文显示
   - 警告文案"⚠️ 立即保存这个 Key"和"💾 缓存在这台设备"都在
   - 没有 × 关闭按钮
   - 点弹窗外的灰色遮罩 → 不关闭
   - 按 ESC → 不关闭
   - 必须点「我已保存好，关闭」才能退出
4. 弹窗关闭后，列表里出现 `test-temp` 行，显示 `7 天后过期`，**没有复制按钮**

- [ ] **Step 4: 走「Logout 清缓存」路径**

1. 验证 localStorage 里有 `tb_key_v1:<email>:*` 条目
2. 点 Logout
3. 验证：所有 `tb_key_v1:<email>:*` 条目都消失了
4. 重新登录
5. 验证：Dashboard 安装咒语降级到「📍 这台设备没有该 Key 的本地缓存」+ CTA

- [ ] **Step 5: 走「reveal 端点 404」**

```bash
curl -i -H "Authorization: Bearer <session-token>" \
  http://localhost:3000/v1/keys/123/reveal
```

Expected: HTTP 404 (route doesn't exist).

- [ ] **Step 6: Commit smoke 报告（可选）**

如果你想把 smoke 结果留档：

```bash
cd /Users/Sirius/Developer/tokenboss
echo "Smoke run $(date +%F): all six checks pass" >> docs/superpowers/plans/2026-05-02-api-key-security.md
git add docs/superpowers/plans/2026-05-02-api-key-security.md
git commit -m "test(keys): smoke test 通过 — 全新用户 / 显示一次 / Logout 清缓存 / reveal 404"
```

---

## Done

实施完成后，确认：

- 所有 13 个 task 的 commit 都在 `git log` 里
- `npx tsc --noEmit` 在 frontend / backend 都干净
- `npx vitest run` 在 frontend / backend 都全绿
- `grep -rn "revealKey\|/v1/keys/.*reveal" src/` 在前后端都返回 0 条结果（除了测试里检验 404 的那条）
- 手测的 6 步 smoke 全过

下一轮：JWT 真注销（参见 spec 文档 § "不在本次的隐含工作"）。
