# API Key 安全收口设计：显示一次 + 缓存透明 + 可选有效期

**Date:** 2026-05-02
**Status:** Approved (brainstorm), pending implementation plan
**Topic:** 把 API Key 的安全模型从「服务端随时可 reveal 明文」收口到「平台只在创建瞬间展示一次，之后明文只活在用户自己的设备缓存里」。同时给用户一个可选的「创建时设有效期」做被动防御。
**Out of scope:** JWT 真注销（朋友报的另一个安全问题，独立 scope，下一轮处理）。

## Context

朋友反馈的两个安全问题里，本设计处理 **API Key 这一条线**：

1. **明文可重复 reveal**：现状 `GET /v1/keys/{keyId}/reveal` 让任何登录会话随时拿回 Key 明文。攻击者只要登进账号（JWT 被劫持 / 别处密码复用 / 共享设备未登出 等），打开 Dashboard 自动触发 `revealKey` → 拿到所有 Key 明文 → 花用户的钱。
2. **吊销/禁用按钮缺失**：列表行的"垃圾桶"图标 `aria-label` 叫"吊销"，实际调的是 `DELETE` 走 newapi hard delete；没有清晰可解释的处置路径。

威胁模型：API Key 直接花用户在 newapi 的余额。**Key 泄露 ≈ 钱包被掏**。

参照 OpenRouter / GitHub PAT / Stripe 的成熟做法，TokenBoss 的安全模型转向「平台仅展示一次，事后由用户自己保管」，配合可选有效期机制减少未察觉泄漏的爆炸半径。

## Decisions

### 1. 范围

**做：**

- 砍掉 `GET /v1/keys/{keyId}/reveal` 端点 + `revealKeyHandler` + `frontend/src/lib/api.ts:revealKey()`
- 创建 API 响应里继续返回一次明文（已是现状），新增创建后**显式确认弹窗**（"我已保存好"按钮）才退出
- 显式确认时把明文同步写 `localStorage` 缓存（`tb_key_v1:${email}:${keyId}`）
- Dashboard 的安装咒语继续从缓存渲染完整明文（保住 30 秒装机 UX）
- 缓存 miss（新设备 / 清缓存 / 清登录）时，咒语降级成掩码 + "为这台设备创建新 Key" CTA
- 创建请求体加可选 `expiresInDays`（正整数 ≥ 1，或省略/`null` = 永久），透传到 newapi 的 `expired_time` 字段
- 列表行展示有效期：`永久` / `23 天后过期` / `已过期 12 天`
- **列表行的 Copy 按钮移除**（统一兑现"显示一次"承诺；事后获取明文的唯一路径是 Dashboard 咒语，且仅在该设备）
- Logout（含 401 自动登出）时清空当前用户的所有 `tb_key_v1:${email}:*` 条目
- default Key 的服务端自动创建从 `verifyCode` 移除，挪到 `OnboardInstall` 由前端显式 `createKey` 触发

**不做：**

- 不做独立的 "Revoke / 吊销" 按钮（Delete 已能"立即止损"，Expiry 做"被动防御"，两动作即可，避免三选一的心智负担）
- 不做存量用户迁移邮件 / 横幅 / 过渡期保留 reveal（采用 M1 硬切，让新 UI 的"缓存 miss 兜底"同时服务"换浏览器的存量用户"）
- 不做 JWT 真注销（独立 scope）
- 不做密码再认证 / 2FA（独立产品决策）
- 不动 `chatProxy` 的 `sk-xxx → userId` 解析（`api_key_index` SHA256 索引保持不变）
- 不动 `keysHandlers.deleteKeyHandler` 的语义（保持 hard delete）

### 2. 后端契约变更

| 变更 | 路径 | 描述 |
|------|------|------|
| 删除 | `GET /v1/keys/{keyId}/reveal` | 端点、handler、`local.ts` 路由表全部清掉 |
| 修改 | `POST /v1/keys` 请求体 | 新增 `expiresInDays?: number \| null`（整数 ≥ 1；缺省 / `null` = 永久；其他值 → 400） |
| 修改 | `POST /v1/keys` → `newapi.createAndRevealToken` | `expired_time = expiresInDays ? unixSeconds() + expiresInDays * 86400 : -1` |
| 修改 | `GET /v1/keys` 响应每条记录 | 新增 `expiresAt: string \| null`（ISO；`null` 表示永久） |
| 不变 | `DELETE /v1/keys/{keyId}` | 保持 hard delete，包括清 `api_key_index` |

**ProxyKeySummary 类型变更（前后端共享）：**

```ts
interface ProxyKeySummary {
  keyId: string;
  key: string;          // 已是掩码
  label: string;
  createdAt: string;
  disabled: boolean;    // 保留：显示 newapi 边缘禁用状态
  expiresAt: string | null;  // NEW
}
```

**verifyCode 自动建 Key 的去除：** `authHandlers.ts` 处理 `/v1/auth/verifyCode` 的成功分支里，调用 newapi 创建 default token + 写 `api_key_index` 那段全部删掉。新用户验证完邮箱进 `/onboard/install` 时是 0 Key 状态。

### 3. 前端变更

**3a. `OnboardInstall.tsx`**

去掉 `listKeys + revealKey` 两步，改成显式创建路径：

```ts
useEffect(() => {
  (async () => {
    const { keys } = await api.listKeys();
    const existing = keys.find(k => k.label === 'default' && !k.disabled);

    if (existing) {
      // 大多数情况：用户在这台浏览器创建过/完成过 onboarding，缓存 hit
      const cached = getCachedKey(user.email, existing.keyId);
      if (cached) { setApiKey(cached); return; }

      // 边缘情况：存量用户在新代码部署后第一次回 onboarding。
      // 不能直接 delete —— 该用户的旧 default 可能正绑定在另一台机器
      // 上做 chat 调用。先弹确认，让用户清楚后果。
      setNeedsConfirmRebuild({ existingKeyId: existing.keyId });
      return;
    }

    // 正常路径（新用户 / 0 Key）：创建新 default
    const created = await api.createKey({ label: 'default' });
    setCachedKey(user.email, created.keyId, created.key);
    setApiKey(created.key);
  })();
}, []);
```

边缘路径的确认弹窗（`needsConfirmRebuild` 触发）：

> **要重新生成 Key 吗？**
>
> 你之前的 default Key 还在 newapi 那边可用，但**这个浏览器没有它的明文缓存**——为了你的安全，明文不能在新设备上再次显示。
>
> 继续的话，旧 Key 会被吊销，**任何已经绑定它的客户端都会停止工作**。
>
> [ 取消 ]   [ 吊销旧 Key 并生成新的 ]

用户确认后：`await api.deleteKey(existing.keyId)` → `await api.createKey({ label: 'default' })` → 写缓存 → 渲染。

OnboardInstall **不弹**「我已保存好」强制确认弹窗——用户当下就在 onboarding 流程里要把明文粘到客户端，整个 OnboardInstall 页面本身就是"展示一次 + 立即使用"的语义。页面文案里加一行小字提醒：「这是你第一次也是唯一一次看到完整 Key —— 装好客户端后请妥善保存。」

`isExpired` helper（前端共用，放 `frontend/src/lib/keyExpiry.ts`）：

```ts
export function isExpired(k: { expiresAt: string | null }): boolean {
  return k.expiresAt != null && new Date(k.expiresAt).getTime() <= Date.now();
}
```

**3b. 创建弹窗（`CreateKeyModal` + 结果展示）**

新增字段：有效期下拉。布局：

```
+ 创建 API Key
─────────────────────────
名称   [ default          ]

有效期 [ 永久不过期      ▾ ]
       ├ 永久不过期（默认）
       ├ 30 天
       ├ 7 天
       ├ 24 小时
       └ 自定义...

[ 取消 ]   [ 创建 ]
```

「自定义」展开一个日期选择器：UI 限制最小 1 天、软上限 1825 天（约 5 年，UI 默认值；用户可手输更长，后端不卡）。

**3c. 创建结果弹窗（即 `Dashboard.tsx:281` 的 `justCreated` 分支）**

强化为强制确认 + 透明缓存说明：

```
✓ Key 已创建

  sk-fU7xRq...完整明文...      [📋 复制]

  ⚠️ 立即保存这个 Key
  此 Key 仅显示这一次。关闭后将永远无法再次查看。

  💾 缓存在这台设备
  我们会把这个 Key 缓存在浏览器 localStorage 里，让 Dashboard
  的安装咒语继续可用。退出登录、清除浏览器数据或换设备时，
  缓存就消失——届时唯一的办法是创建一个新 Key。

[ 我已保存好，关闭 ]
```

约束：
- 点遮罩**不**关闭
- 不显示 X 关闭按钮
- 必须点「我已保存好，关闭」才退出
- 关闭瞬间执行 `setCachedKey(email, keyId, plaintext)` —— 这是**手动创建路径**写缓存的时机

**3d. `APIKeyList.tsx` 行内**

```
活跃永久 Key：
[●] default                                           [🗑]
sk-•••a4c2
创建于 2026-04-15 · 永久                12 次 · $0.05

活跃带过期：
[●] for-side-project                                  [🗑]
sk-•••8f1e
创建于 2026-04-15 · 23 天后过期         3 次 · $0.01

已过期：
[○] old-test-key            [已过期]                  [🗑]
sk-•••0aab
创建于 2026-03-01 · 已过期 12 天        8 次 · $0.02

newapi 边缘禁用（保留显示，无主动入口）：
[○] some-key                [已吊销]                  [🗑]
sk-•••f00d
创建于 2026-04-01 · 永久
```

**Copy 按钮整段代码删除**（`handleCopy` / `copyingId` / `copiedId` / `copyError` 状态都删掉，连带 `revealKey` 调用）。

**3e. Dashboard 安装咒语：缓存 miss 兜底 + 透明声明**

```tsx
// defaultKey 的选取要排除 disabled 和 expired
const defaultKey =
  keys.find(k => k.label === 'default' && !k.disabled && !isExpired(k))
  ?? keys.find(k => !k.disabled && !isExpired(k));

const cachedPlain = defaultKey ? getCachedKey(user.email, defaultKey.keyId) : null;
```

两种渲染路径：

```
缓存 hit：
  TOKENBOSS_API_KEY=sk-fU7xRq...完整明文...    [📋 复制]
  💾 本地缓存 · 退出登录后将消失

缓存 miss（含存量用户换浏览器）：
  TOKENBOSS_API_KEY=sk-•••a4c2
  📍 这台设备没有该 Key 的本地缓存
  为了你的安全，明文不能在新设备上重新查看。
  [ 为这台设备创建一个新 Key ]
```

CTA 点击 = 直接走 `+ 创建 API Key` 流程（弹 3b 的创建弹窗）。

**3f. Logout 清缓存**

`frontend/src/lib/auth.tsx:151` 的 `logout()`：

```ts
logout: () => {
  clearAllCachedKeys(user?.email);  // NEW
  setStoredSession(null);
  setUser(null);
  setSession(null);
}
```

`keyCache.ts` 新增 helper：

```ts
export function clearAllCachedKeys(email: string | undefined): void {
  if (!email) return;
  const prefix = `${NS}:${email}:`;
  try {
    const toDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) toDelete.push(k);
    }
    toDelete.forEach(k => localStorage.removeItem(k));
  } catch { /* private mode etc. */ }
}
```

**401 auto-logout 也走同一路径**（`auth.tsx:97-99`），不需要单独改。

### 4. 缓存与持久化语义

`localStorage` 的 `tb_key_v1:${email}:${keyId}` 是**明文 Key 在本系统里的唯一长期存储位置**（除了 newapi 的服务端，那里 TokenBoss 没法再 reveal）。

写入时机（共两处，都是"用户当下就在看明文"的瞬间）：
1. **手动创建路径**：Dashboard / 列表页点 `+ 创建`，结果弹窗里点「我已保存好，关闭」。
2. **Onboarding 路径**：`OnboardInstall` 拿到 `createKey` 响应后立即写入（用户接下来要把它粘到客户端，整个 onboarding 步骤就是"展示一次 + 立即使用"的语义）。

清除时机：
- 用户主动 logout
- 401 自动 logout
- 用户清浏览器数据（系统行为，不需要我们做什么）
- 用户在另一设备 delete 该 Key（**本设计不主动同步**——下次列表加载发现该 keyId 不存在时，调用方应清掉对应缓存条目；列表层加一段 sweep 兜底）

读取时机：
- Dashboard 安装咒语渲染前
- `OnboardInstall` 存量用户走兜底分支时

### 5. 迁移路径（M1 硬切）

部署当天行为：

| 用户类别 | 体验 |
|---------|------|
| 本地有缓存明文（之前在该浏览器 reveal 过） | 零影响。Dashboard 咒语继续渲染明文。 |
| 本地无缓存明文（换过浏览器 / 清过缓存 / 注册没装客户端等） | 进 Dashboard 看到「这台设备没有缓存」兜底块 + CTA。点 CTA 创建新 Key 即可恢复装机能力。**旧 Key 在 newapi 那边继续活着、可以正常做 chat 调用**——已经装在某台机器上的客户端不会断；只是这台浏览器永远拿不回明文。用户可选择删掉旧 Key，也可保留（不影响其他设备）。 |

不做：迁移邮件、过渡期保留 reveal、Dashboard 横幅。

理由：被影响的用户少，新 UI 的兜底块本来就要为「换设备」常态场景做，一份代码同时覆盖两类用户。

### 6. 默认有效期：永久

创建弹窗的有效期下拉默认选「永久不过期」。

理由：
- 大多数用户用 Key 是装在 OpenClaw / Hermes / Claude Code 客户端里长期使用，强制 90 天会带来不必要的重新装机负担
- 安全意识强的用户可以主动选短期
- 如果未来发现需要更激进，再把默认值切到 90 天，是个低成本调整

## Architecture

数据流（创建一个新 Key）：

```
[Frontend] CreateKeyModal — 用户点"创建"
     |
     | POST /v1/keys { label, expiresInDays? }
     v
[Backend] createKeyHandler
     |
     | newapi.createAndRevealToken({ name, unlimited_quota: true,
     |   expired_time: -1 or unixSeconds()+days*86400 })
     v
[newapi] 生成 token + 返回明文 sk-xxx
     |
     v
[Backend] putApiKeyIndex(userId, tokenId, sha256(apiKey))
     |
     | 201 { keyId, key: "<plaintext>", label, createdAt, expiresAt, disabled: false }
     v
[Frontend] CreateKeyModal 显示明文 + 复制按钮 + 透明缓存说明
     |
     | 用户点"我已保存好，关闭"
     v
setCachedKey(email, keyId, plaintext) — 写 localStorage
     |
     v
关闭弹窗，触发 reloadKeys()，列表显示新行（已是掩码）
```

数据流（Dashboard 加载咒语）：

```
[Frontend] Dashboard mount
     |
     | api.listKeys() — 返回所有 Key（掩码 + 元数据）
     v
defaultKey = first non-disabled non-expired key with label === "default" or fallback
     |
     v
cached = getCachedKey(email, defaultKey.keyId)
     |
     +— hit  → 渲染明文咒语 + "本地缓存"声明
     |
     `— miss → 渲染掩码咒语 + "这台设备没有缓存" CTA
                                |
                                v
                       用户点 CTA → 走创建流程（同上）
```

数据流（Logout）：

```
[Frontend] 用户点 Logout（或 401 自动触发）
     |
     v
clearAllCachedKeys(email) — 删 localStorage 里所有 tb_key_v1:{email}:* 条目
     |
     v
setStoredSession(null) — 删 tb_session
     |
     v
setUser(null), setSession(null)
     |
     v
跳转登录页
```

## Edge Cases

| 场景 | 处理 |
|------|------|
| 用户在创建弹窗里没点"我已保存好"就硬刷页面 / 关浏览器 | 明文丢失，缓存未写入。Key 在 newapi 那边活着但 TokenBoss 永远拿不回。用户必须 delete + 重建。**这是有意的语义**——刷新就是放弃保存。 |
| 用户在 A 浏览器创建 Key，去 B 浏览器装客户端 | 标准换设备流程：B 上看到"缓存 miss"兜底，CTA 创建新 Key。也可手动从密码管理器粘贴 A 上保存的明文（但 TokenBoss UI 不提供导入入口，用户在客户端 .env 里粘贴即可）。 |
| 列表里看到一个 keyId 但本地缓存对该 keyId 有条目，且 keyId 已不在最新列表（被另一设备 delete 了） | 列表加载完后做一次 sweep：遍历 `tb_key_v1:${email}:*`，对不在 listKeys 返回结果里的 keyId 执行 `clearCachedKey`。 |
| 用户创建 Key 时设了 24h 过期，24h 后 newapi 该 token 自动失效 | 列表渲染 `已过期 N 天` 标签，咒语不再用它做 defaultKey（fallback 到下一个），用户需要 delete 它清场。 |
| `verifyCode` 自动建 Key 这段被删掉后，新用户注册完没立刻进 onboarding 就关浏览器 | 用户下次登录是 0-Key 状态。Dashboard 显示"还没有 Key"的空态 + 创建 CTA。无副作用。 |
| 存量用户（部署前注册）在新代码上线后**第一次回 OnboardInstall**，本浏览器无 default 缓存 | OnboardInstall 检测到这种情况，弹确认弹窗（见 3a 文案）告诉用户「旧 Key 将被吊销，已绑定它的客户端会停止工作」。用户确认后：`deleteKey(旧)` + `createKey(新)` + 写缓存。用户取消则停在确认页（用户可手动退出 onboarding，不被强制操作）。 |
| 存量用户的 default Key 是 verifyCode 建的，没主动设过 expiry，newapi 那边 `expired_time = -1`（永久） | 列表展示"永久"，跟新用户一致。 |
| 私密浏览模式 / 禁用 localStorage | `getCachedKey` / `setCachedKey` / `clearAllCachedKeys` 全 try-catch 静默 fail。Dashboard 走"缓存 miss"兜底分支。功能上等价于"每次都是新设备"。 |
| 同一浏览器多账号切换 | logout 只清当前 email 的条目（`clearAllCachedKeys(email)` 用 `${NS}:${email}:` 前缀匹配）。其他账号缓存不受影响。 |

## 测试覆盖

**后端：**

- `keysHandlers.test.ts`：
  - `POST /v1/keys` 接受 `expiresInDays`，正确传给 newapi（mock 验证 `expired_time` 计算）
  - `POST /v1/keys` 不传 `expiresInDays` → `expired_time = -1`
  - `GET /v1/keys` 响应每条带 `expiresAt`（ISO 或 null）
  - `GET /v1/keys/{id}/reveal` 返回 404（路由已删）
- `authHandlers.test.ts`：
  - `verifyCode` 成功后**不再**有 newapi 调用（确认 default Key 自动创建被移除）

**前端：**

- `keyCache.test.ts`：
  - `clearAllCachedKeys(email)` 只删指定 email 前缀
  - 私密模式 / quota 异常时不抛
- `APIKeyList.test.tsx`：行内不再有 Copy 按钮
- `Dashboard.test.tsx`：缓存 miss 时渲染掩码 + CTA；缓存 hit 时渲染明文
- `OnboardInstall.test.tsx`：
  - 新用户路径（0 Key）→ `createKey` → 写缓存 → 渲染
  - 缓存 hit 路径（已有 default + 缓存）→ 不调 `createKey`，直接渲染缓存值
  - 边缘路径（存量 default 但缓存 miss）→ 弹确认 → `deleteKey(旧)` + `createKey(新)` → 写缓存 → 渲染
- `auth.test.tsx`：logout 清掉 localStorage 里的 `tb_key_v1:${email}:*` 条目

## 不在本次的隐含工作（提醒下一轮）

- **JWT 真注销**：用户朋友报的另一个安全问题。当前设计假设 logout 只是前端清理；如果 JWT 没失效，攻击者拿到 token 还能继续用。需要单独一轮设计选定方案（session 表 / `tokenVersion` / refresh token）。
- **2FA / 二次验证**：创建 Key 这种敏感动作要不要二次验证？独立产品决策，本轮不做。
- **审计日志**：Key 创建 / 删除 / 过期事件目前只在 newapi 那边有记录，TokenBoss 自己没结构化审计表。如果未来要做合规，需补一张 `key_events` 表。
