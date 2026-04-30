# X-Source 全链路 Agent 归属设计

**Date:** 2026-04-30
**Status:** Approved (brainstorm), pending implementation plan
**Topic:** 在 chatProxy 入口捕获请求来源（OpenClaw / Hermes / Claude Code / Codex / 第三方 Agent），落到 tokenboss 这边的 attribution 表，前端 `/console/history` + Dashboard 展示真实 Agent 名而不是当前的 keyHint fallback。
**Builds on:** commit `1be9be2`（前端 source ?? keyHint fallback —— v1.x 临时 band-aid，本设计是真解）

## Context

`/console/history` 的"来源"列长期空，因为 `usageHandlers.ts:92` 硬编码 `source: null`（newapi 没有 x-source 概念，chatProxy 也不读 incoming header）。Commit `1be9be2` 把列改成 `source ?? keyHint ?? '—'` 作为临时方案 —— **依赖用户给 API key 起名时含 Agent 名**，覆盖很差，单 key 多 agent 用户完全分不清。

本设计实现真正的 per-call source attribution：chatProxy 入口捕获、SQLite 落地、`/v1/usage` join 后回填、前端规范展示。

## Decisions

### 1. 范围

**做：**
- 在 `POST /v1/chat/completions` 入口捕获 source
- 三级识别（按优先级）：
  1. 显式 `X-Source: <slug>` header
  2. `User-Agent` 模式匹配（fallback）
  3. 都没拿到 → `'other'` slug（永远兜底，**chat completions 线 source 永远非空**）
- 落到 tokenboss SQLite 新表 `usage_attribution`
- `usageHandlers` 拉 newapi log 后 join attribution 表，把 source 字段填上
- 前端 `/console/history` + Dashboard 通过 `formatSource()` 规范展示

**不做：**
- 其它 endpoint（`/v1/embeddings` / `/v1/audio/*` 等）暂不接 —— 这些线保留 commit 1be9be2 的 keyHint fallback
- 不回填部署前的旧数据（旧 chat 调用永远显 `'Other'`）
- 不引入 live FX / 第三方 user-agent 库
- 不改 chatProxy 现有转发逻辑（仅入口加捕获 + 出口加 forward `X-Request-ID`）
- 不要求 SDK 端立刻发版（X-Source 是 v1.x 起的约定，过渡期 UA fallback 兜底）

### 2. API 契约 + SDK 约定

**HTTP header：**

```
X-Source: <slug>           # 主识别路径
X-Request-ID: tb-<8 hex>   # 我们生成并 forward 给 newapi，用于精确 join
```

- `slug` 字符空间：`[a-z0-9-]{1,32}`（lowercase、限长 32、字符白名单）
- 4 个一线 Agent 的 canonical slug：`openclaw` / `hermes` / `claude-code` / `codex`
- 任意第三方 Agent 自己定 slug，后端不卡白名单；前端 `formatSource()` 显示侧统一处理

**UA fallback 模式：**

| 正则 | → slug |
|---|---|
| `/openclaw/i` | `openclaw` |
| `/hermes/i` | `hermes` |
| `/claude.?code/i` | `claude-code` |
| `/codex/i` | `codex` |

匹配不到 → `'other'`（method = `'fallback'`）

**SDK 约定文档：** plan 阶段新建 `docs/sdk-source-attribution.md`，说明：
- header 格式 + canonical slug 列表
- 推荐 SDK 端代码：`headers['X-Source'] = 'openclaw'`
- UA fallback 是兜底，**强烈建议** SDK 显式发 X-Source（更准、更未来 proof）

### 3. 数据模型

新增 SQLite 表 `usage_attribution`：

```sql
CREATE TABLE IF NOT EXISTS usage_attribution (
  requestId    TEXT PRIMARY KEY,
  userId       TEXT NOT NULL,
  source       TEXT NOT NULL,
  sourceMethod TEXT NOT NULL,
  model        TEXT,
  capturedAt   TEXT NOT NULL,
  CHECK (length(source) <= 32),
  CHECK (length(sourceMethod) <= 32),
  CHECK (model IS NULL OR length(model) <= 128)
);
CREATE INDEX IF NOT EXISTS idx_attribution_user_time
  ON usage_attribution(userId, capturedAt DESC);
```

**字段说明：**

| 字段 | 说明 |
|---|---|
| `requestId` | 精确 join 路径用。即使 newapi 不回，本身也用于查重 / debug |
| `userId` | TokenBoss 这边的 userId。chatProxy 入口通过 `sha256(bearerToken) → api_key_index` 反查（这张表已有，cheap SQLite lookup） |
| `source` | normalized slug（已 lowercase、字符校验过）|
| `sourceMethod` | 值从哪条路得来的，便于以后看 X-Source 普及率 |
| `model` | soft join 三元组之一 |
| `capturedAt` | soft join 时间窗中心 |

**保留策略：** 30 天滚动 cron 清理（attribution 是 dashboard 用的辅助元数据，不是审计；超过 30 天的 history 落到 `'other'` 也无所谓）。具体 cron 实施位置待 plan 阶段调研（见 Open Question #4）。

**Schema 同时支持精确 join 和软 join**：实施时按 plan 阶段 probe 结果选一条主路径；schema 都支持。

### 4. chatProxy 入口 capture 流程

每次 `POST /v1/chat/completions` 进来，proxy 入口加：

```
1. 生成 requestId：tb-<8 hex>
2. 解析 source（按优先级）：
   a. X-Source header 存在且合法 → 用它，method='header'
   b. UA 正则匹配 → 用匹配到的 slug，method='ua'
   c. 都没匹配 → 'other'，method='fallback'
3. 用 sha256(bearerToken) 反查 api_key_index → userId
   - 找不到 userId（匿名 / 直连 newapi 的 key）→ 跳过 attribution 写入
4. INSERT OR IGNORE INTO usage_attribution (...)
   - 失败（SQLite 异常）→ console.warn 并继续，不阻塞 chat 转发
5. 给 upstream fetch 加 header：
   X-Request-ID: tb-<8 hex>
```

**为什么 attribution 写入要 non-blocking：** chat completion 是延迟敏感的；attribution 是 dashboard 辅助元数据，丢一条比阻塞主流程更可接受。better-sqlite3 sync API 正常 < 1ms；只有磁盘异常时才慢。`try/catch` 包住即可。

**新增工具函数（lib 层）：**

- `backend/src/lib/sourceAttribution.ts`（新）：
  - `parseSourceHeader(raw: string | undefined): {slug, method} | null`
  - `parseUaSource(ua: string | undefined): {slug, method} | null`
  - `resolveSource(headers): {slug: string, method: 'header'|'ua'|'fallback'}`（串以上两个，兜底返 `'other'/'fallback'`）
- `backend/src/lib/store.ts`（修改）：
  - 加 `usage_attribution` 表 DDL + idempotent migration
  - `insertAttribution(rec)` / `getAttributionByRequestIds(ids[])` / `getAttributionsForJoin(userId, models[], minCapturedAt, maxCapturedAt)` 三个 helper（**批量接口**，避免 N+1）

### 5. usageHandlers 端 join 流程（批量化）

`/v1/usage` 拉 newapi log，对当页所有 entries 做一次性 join。两条路径根据 plan probe 结果选：

**精确 join（首选 —— 如果 newapi forward request_id 通）：**

```sql
SELECT requestId, source FROM usage_attribution
WHERE requestId IN (?, ?, ?, ...)  -- newapi log 当页所有 request_id
```

应用层用 Map 一次性映射回去。**单 SQL，O(1) per entry**。

**软 join（兜底 —— 如果 newapi 自己 reroll request_id）：**

```sql
SELECT requestId, userId, model, source, capturedAt
FROM usage_attribution
WHERE userId = ?
  AND capturedAt BETWEEN ? AND ?         -- min - 5s 到 max + 5s
  AND model IN (?, ?, ?, ...)             -- 当页 distinct models
```

应用层对每条 newapi entry 在内存里挑 `model` 匹配 + `|capturedAt - entry.created_at|` 最小的那条。**单 SQL + 内存扫，O(N+M) 总开销**。

**第三 fallback（永远兜底）：** attribution 表里没匹配（写入失败 / 30 天清理后 / 部署前的旧数据）→ `source = 'other'`。**chat-completions 这条线 source 永远非 null**。

### 6. 前端展示

新增 `frontend/src/lib/sourceDisplay.ts`（沿用 `formatModelName.ts` 的"已知美化、未知透传"模式）：

```typescript
const KNOWN: Record<string, string> = {
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
  'claude-code': 'Claude Code',
  codex: 'Codex',
  other: 'Other',
};

export function formatSource(slug: string | null | undefined): string {
  if (!slug) return '—';
  const k = slug.toLowerCase().trim();
  if (KNOWN[k]) return KNOWN[k];
  // 第三方 slug → '-' 当词分隔符 title-case
  return k.split('-').filter(Boolean).map(w => w[0]!.toUpperCase() + w.slice(1)).join(' ') || '—';
}
```

**调用点改：**

`UsageHistory.tsx` + `Dashboard.tsx` 现行 `source={r.source || r.keyHint || undefined}` 改成显式分支：

```tsx
source={r.source ? formatSource(r.source) : (r.keyHint ?? undefined)}
```

- chat-completions 线：`r.source` 永远非空（最差是 `'other'`）→ 走 formatSource → 显示规范名
- 其它 endpoint 线：`r.source` 仍可能 null → 走 right-hand keyHint fallback（保留 commit 1be9be2 的语义）

**注意：** 不要写成 `formatSource(r.source) || r.keyHint` —— `formatSource` null/空输入返 `'—'`（truthy 字符串），会让 keyHint fallback 永远不触发。必须用三元 `r.source ? formatSource(r.source) : keyHint` 显式分支。

**视觉：** `Other` 跟 `OpenClaw` 用同样字号 / 字色显示，**不加色 / 不加 icon**（避免过度设计；spec credits-economy § 8 没指定 source 配色）。

### 7. 校验、错误处理、边界

**chatProxy 入口校验：**

| 输入 | 处理 |
|---|---|
| `X-Source` 长度 > 32 | 截断到 32 |
| `X-Source` 含非法字符（非 `[a-z0-9-]`）| 当 header 不存在，落到 UA fallback |
| `X-Source` 大写 | lowercase 后再校验 |
| `X-Source` 多个值 | 取第一个 |
| 没 bearer / api_key_index 反查不到 userId | 跳过 attribution 写入（这种调用本来就不进 dashboard）|

**SQLite 写入异常：**
- `try/catch` 包住 `insertAttribution`
- 失败 → `console.warn('[chatProxy] attribution insert failed', { requestId, error })` + 继续
- 不阻塞 chat completion 主流程

**join 阶段失败：**
- attribution miss → fallback 到 `'other'`
- attribution 表查询失败（极罕见 SQLite 异常）→ 返回不带 source 的 entry（前端 fallback 到 `'—'`）+ console.error
- 不让 `/v1/usage` 整体 500

**X-Request-ID 冲突：**
- 极小概率 `tb-<8 hex>` 撞同 user 同一秒已有 id（4B 空间 vs ~10 QPS）
- 用 `INSERT OR IGNORE` —— 撞了就丢这条 attribution（最差变 `'other'`）

**newapi 不接受 / reject `X-Request-ID`：**
- 我们 forward 的 header 被忽略 → 软 join 路径触发条件，不是错误

**clock skew：**
- 同机房 < 100ms，软 join 5s 窗口足够容错
- 万一时钟偏 > 5s（极罕见）→ 软 join miss → 落到 `'other'`，无大碍

### 8. 测试策略

**单元测试：**

- `sourceAttribution.test.ts`（backend lib，新）
  - `parseSourceHeader`: valid slug / 大写 / 超长 / 非法字符 / undefined
  - `parseUaSource`: 4 个 Agent UA pattern + 未匹配 + undefined
  - `resolveSource`: header 优先级 / UA fallback / 都没匹配 → `'other'`

- `sourceDisplay.test.ts`（frontend lib，新）
  - 4 个 KNOWN slug → brand 字符串
  - 第三方 slug → titlecase
  - null / undefined / empty → `'—'`

- `usageHandlers.test.ts`（backend handler，扩充）
  - newapi mock log + attribution 表预填，断言 join 后 source 字段正确
  - attribution miss → source = `'other'`
  - 软 join 时间窗内多条 → 取最近的

**集成测试：**

- `chatProxy.attribution.test.ts`（backend，新）
  - mock upstream（`MOCK_UPSTREAM=1`）+ X-Source → 断言 attribution 表写入正确行
  - 不带 X-Source 但带 OpenClaw UA → 断言 source = `'openclaw'` / method = `'ua'`
  - 匿名 / 无 bearer → 断言 attribution 表无新行
  - SQLite mock 写入失败 → 断言主流程 200 完成

**手工 e2e（追加到 `docs/订阅测试指南.md`）：**

1. 配真 OpenClaw / Hermes 客户端发请求 → `/console/history` 显对应 Agent 名
2. curl 发 `X-Source: random-test` → 显 `Random Test`
3. curl 不发 X-Source 不发 UA → 显 `Other`

**Probe 脚本（plan 阶段独立工件）：**

`scripts/probe-newapi-request-id.mjs`：发 chat 请求带 `X-Request-ID: tb-probe-{hex}` → 等几秒拉 `/api/log` 看返回的 `entry.request_id` 是不是我们的值。输出明确 join 路径选择。

## Open Questions

plan 阶段需砸钉子：

1. **newapi 是否接受 forwarded `X-Request-ID` 并写入 log.request_id**
   - 跑 `scripts/probe-newapi-request-id.mjs`
   - 决定走精确 join 还是软 join

2. **真实 UA 字符串**
   - OpenClaw / Hermes / Claude Code / Codex 各自 SDK 的 `User-Agent` 实际长什么样
   - 影响 § 4 UA fallback 正则
   - plan 阶段联系 SDK 端 / 看源码 / 跑真客户端 tcpdump 确认
   - 短期可先用宽松正则 `/openclaw/i` 等占位

3. **api_key_index 反查的覆盖率**
   - register / verifyCode / OAuth 等所有发 key 的入口是不是都调了 `putApiKeyIndex`
   - 如果有缺失 → 那部分 user 调用永远 attribution miss → 永远显 `'other'`
   - plan 阶段调研

4. **30 天清理 cron 实施位置**
   - tokenboss backend 现在没有 cron framework
   - 加轻量 cron handler（zeabur cron 支持）or 放进 `/v1/admin/sweep` 让 ops 触发？

## Non-goals

- ❌ 其它 endpoint（embeddings / audio）的 source attribution
- ❌ 部署前旧数据回填
- ❌ Live FX / 第三方 user-agent parser 库
- ❌ 强制 SDK 端立刻发 X-Source（过渡期 UA fallback 兜底）
- ❌ source 配色 / icon UI（视觉过度设计）
- ❌ 软 join 时间窗自动调整（5s 写死，监控发现误归属高了再缩）

## Risk & rollback

| 风险 | 影响 | 缓解 |
|---|---|---|
| chatProxy attribution 写入抛异常 | 主流程被阻塞 | try/catch 包住，console.warn 后继续 |
| SQLite 写入吞吐成瓶颈 | chat 延迟上升 | better-sqlite3 sync < 1ms；INSERT OR IGNORE 防主键冲突；监控 attribution insert 时长 |
| newapi 把 forwarded request_id 当攻击防御丢掉 | 退化到软 join | spec 已设计软 join 兜底 |
| 第三方 slug 含恶意 unicode / 长字符串 | XSS / DOS | 入口校验 `[a-z0-9-]{1,32}` + 截断；React 默认 escape |
| 软 join 5s 窗口太宽误归属 | dashboard 显错 source（罕见）| 监控 sourceMethod 分布；缩到 2s |
| attribution 表无限增长 | DB 膨胀 | 30 天 cron 清理（Open Q #4 落实）|

**rollback 路径：**

- **完全 disable**：env `SOURCE_ATTRIBUTION=off` —— chatProxy 跳过 attribution 写入；usageHandlers 跳过 join；source 全部回 null → 前端 fallback 到 keyHint（commit 1be9be2 现状）
- **只 disable join**：保留 attribution 写入（debugging 数据）但 usageHandlers 不读 → source 显 null → keyHint fallback
- **DB 回滚**：drop `usage_attribution` 表（idempotent migration 可重新建）；其它代码无需改

**部署节奏：**

1. 先 ship attribution 写入 + DDL（一段时间没人读，纯写入数据）
2. 跑几天看分布是否符合预期（method 分布、source 多样性）
3. 再 ship usageHandlers 的 join 逻辑 → 前端开始展示
4. 这样 day 1 上线就有几天历史数据可看，不会"刚部署所有 entry 都是 Other"

## Acceptance

- `chatProxy` 收到带 `X-Source: openclaw` 的 chat 请求 → `usage_attribution` 表新增一行 `(source='openclaw', sourceMethod='header', userId=...)`
- `chatProxy` 收到只带 OpenClaw UA 的 chat 请求 → 表新增 `(source='openclaw', method='ua')`
- `chatProxy` 收到既无 X-Source 也无识别 UA 的请求 → 表新增 `(source='other', method='fallback')`
- 匿名调用 / 无 bearer → 不写表
- `/v1/usage` 返回的每条 chat-completions entry 的 `source` 字段非空（最差 `'other'`）
- `/console/history` 来源列：`openclaw` → 显 `OpenClaw`；`random-test` → 显 `Random Test`；`other` → 显 `Other`
- attribution 表 30 天前的行被 cron 清理
- chatProxy 主流程从未因 attribution 失败被阻塞（attribution insert 抛异常 → 主流程仍 200）
- 单元 + 集成 + e2e 测试齐全
