# Repo Reality Check · 2026-05-13

Stage 0 现状盘点 — brainstorming + 实证调研期间收集的事实，作为后续 design / tasks 的真实起点。

## 结构

- **单仓 monorepo**：`frontend/`（React 18 + Vite + Tailwind 3.4）+ `backend/`（Node 20+ + TypeScript）+ `ClawRouter/`（独立 npm package `@blockrun/clawrouter`，有自己的 `CLAUDE.md`）
- 本 REQ 不涉及 ClawRouter

## 分支

- 默认 `main` · 本 REQ baseline = `f98412d` (chore: 引入 v1.0 工作流基建)
- 无相关 in-flight feature branch

## 数据层（reality check）

- **Backend `package.json` 同时有 `@aws-sdk/client-dynamodb` 和 `better-sqlite3` deps** — 历史遗留双路径
- **`backend/template.yaml`（AWS SAM）当前未启用** — Zeabur 是实际部署
- **实际生产数据存储**：grep `backend/src/handlers/` 显示主要是 `chatProxy` / `responsesProxy` / `keysHandlers` / `paymentHandlers` 等，没有强 backend DB 操作 — 主路径是 stateless API + 调用上游 LLM；用户/key 管理用现有 `lib/newapi.ts` + DynamoDB 客户端
- 本 REQ **不引入新 DB schema**，reserved "CC Switch" key 是 newapi 系统普通 key 一条记录

## Backend 现有 endpoint surface

通过 `ls backend/src/handlers/` + `grep` 路由文件得：

| Handler | 路由（推断） |
|---|---|
| `chatProxy.ts` | `POST /v1/chat/completions`（OpenAI-compat） |
| `responsesProxy.ts` | `POST /v1/responses`（OpenAI Responses API） |
| `modelsHandler.ts` | `GET /v1/models` |
| `authHandlers.ts` | `/api/auth/*`（登录 / register / magic link / verify email） |
| `keysHandlers.ts` | `/api/me/keys` 类（用户 key CRUD） |
| `adminHandlers.ts` | `/admin/*` |
| `paymentHandlers.ts` / `paymentWebhook.ts` | 支付 |
| `usageHandlers.ts` | 用量 |
| `redeemHandler.ts` | 兑换码 |
| `buckets.ts` | 限流 / 桶 |
| `catalogJson.ts` | model catalog |
| `routerConfigHandler.ts` | router 配置 |
| `skillMd.ts` | skill md（推测是 ClawRouter 集成相关） |

**TokenBoss 当前不暴露 `/v1/messages` (Anthropic-native)，也不暴露 Gemini-native** — 本 REQ 新增 `/v1/messages` shim 是首个非 OpenAI 协议 endpoint。

## Frontend 现状

- 路由表：见 `frontend/src/App.tsx`（已有 `/install/manual` 路由，对应 `ManualConfigPC.tsx`）
- **`frontend/src/screens/ManualConfigPC.tsx` 753 行** — 当前主要"重写对象"
- 共享组件：`TerminalBlock` / `AppNav` / `Breadcrumb` / `CompatRow` 等可复用
- 现有登录系统：`/login` / `/register` / Magic link / VerifyEmail（`screens/Login.tsx` 等）
- 现有 Onboarding 流：`/onboard/welcome` → `/onboard/install` → `/onboard/success`
- 现有 Dashboard：`/console` + 子路由

## URL Reality Check（**关键修正**）

实证 curl 测试结果：

| URL | HTTP Status | 真实身份 |
|---|---|---|
| `https://api.tokenboss.co/v1/models` | **401**（key missing）| ✅ **真实公开 API endpoint** |
| `https://www.tokenboss.co` | 200 | marketing / web app |
| `https://app.tokenboss.co` | TLS failure | ❌ 不通（之前 mental model 误认） |
| `https://tokenboss-backend.zeabur.app/v1/models` | 404 | Zeabur 内部域名，**非公开 API endpoint** |

**污染面 — `tokenboss-backend.zeabur.app` 出现的位置**：

- `docs/AI配置指令-TokenBoss厂商.md`（多处：line 17, 122, 146, 172, 178, 184, 190 等）
- `ROUTER_DEV.md`
- `frontend/src/screens/ManualConfigPC.tsx` 内 4 个 Agent recipe 的内嵌 URL

**所有这些位置 v1.0 PR 内同步修正为 `https://api.tokenboss.co/v1`**。

## Test infra

- `vitest` 三个 stream 各自 `npm test --passWithNoTests` 都能跑
- E2E：playwright（项目根有 `.playwright-mcp/` 目录）
- 现有测试样例：`backend/src/lib/__tests__/newapiAdminSession.test.ts`（用作新测试结构参考）

## Lint / type baseline

未实际跑 `npm run typecheck`（Stage 0 偷懒了）— Stage 2 writing-plans 起 task 1 时实跑。

## OpenSpec 状态

`openspec/changes/` 已有 2 个未 archive 的 change folder：

- `add-seo-baseline/`（历史，slug 无 gh 前缀）
- `pause-membership-tiers/`（历史，slug 无 gh 前缀）

跟本 REQ **无冲突 / 无依赖**。

## 部署 / 环境变量

- **Zeabur**（frontend + backend 都是）
- `frontend/vercel.json` 是历史遗留，不影响 Zeabur 部署
- `backend/template.yaml` (AWS SAM) 当前未启用
- 本 REQ **不引入新环境变量**

## 本机 toolchain + 端口

- `node >= 20` ✓
- `npm` / `tsx` / `vitest` ✓
- CC Switch v3.14.1 **已预装**在 `/Applications/CC Switch.app`（用户本机）— 实证调研直接复用
- 端口冲突：无（本 REQ 不引入新端口）

## 跨分支依赖

- 无（main 当前干净）

## 术语 migration

- "TokenBoss 后端 URL" 在历史代码 / 文档中混用过 `tokenboss-backend.zeabur.app` / `api.tokenboss.co` / `app.tokenboss.co`（不存在）/ `www.tokenboss.co`。本 REQ 统一为 **`api.tokenboss.co/v1`**（chat API endpoint）+ **`www.tokenboss.co`**（marketing / web app domain）

## 已知 quirk

- 旧 `ManualConfigPC.tsx` 753 行 RECIPES 数据数组：4 个 Agent recipe（OpenClaw / Hermes / Codex / OpenAI-compat），**没有 Claude Code** — 因为协议不兼容
- 现有 newapi key 系统（`backend/src/lib/newapi.ts`）force-prepends `sk-` on key reveal — 本 REQ reserved key 沿用同机制

## CC Switch Deep Link UX 实证发现（关键）

Stage 0 期间下载 CC Switch v3.14.1（dmg → ~/Applications 装 + cleanup，实际用户已预装的 /Applications/CC Switch.app）+ 触发 5 个 ccswitch:// URL 测试得：

1. **`ccswitch://` URL scheme 由 CC Switch 注册**（LaunchServices claim id "CC Switch Deep Link"）
2. **每次 deep link 触发都 force-focus CC Switch 窗口**（log 里 5 次 `Window shown and focused`）
3. **Import 不会自动落库**（DB grep 无 `TokenBoss-Test` 匹配）— deep link → frontend event → 弹确认对话框 → 用户点 import → 落库
4. **连续 4 个有效 URL 触发 → CC Switch 弹 4 张独立确认卡片**（用户实测确认，非 batch 非覆盖）— 这决定了 v1.0 设计采用"前端依次触发 N 个 URL"策略，UX 可接受
   - 注：实测 4 张是因为调研期 5 个 URL 中第一个有 zsh 数组 bug 让 `app` 字段为空被 CC Switch 拒（log 中可见 `Invalid app type: ..., got ''`），剩 4 个有效 URL → 4 张卡片。**v1.0 正常实施时 5 个有效 URL 预期 5 张卡片**（proposal.md 和 spec.md 均按 5 张写）
5. **CC Switch DB 路径**：`~/.cc-switch/cc-switch.db`（SQLite，23MB），含 `providers` / `provider_endpoints` / `mcp_servers` / `prompts` / `skills` / `settings` / `proxy_config` / `usage_daily_rollups` 等表

## CC Switch Deep Link Schema 实证

从 `farion1231/cc-switch` 的 `deplink.html` 抓出的真实 URL 示例：

**简化版（最适合本 REQ）：**
```
ccswitch://v1/import?resource=provider&app=<app>&name=<name>&endpoint=<base_url>&homepage=<url>&apiKey=<key>
```

**完整版（每个 CLI 的复杂 config 用 base64 JSON）：**
```
ccswitch://v1/import?resource=provider&app=<app>&name=<name>&configFormat=json&config=<base64-encoded-json>
```

- `app` 字段必须是：`claude` / `codex` / `gemini` / `opencode` / `openclaw` / `hermes` 之一
- 不存在 `apps=a,b,c` 多 app 模式（仅 MCP resource 有此能力）— 故 v1.0 选择"前端依次触发 N 个 URL"
