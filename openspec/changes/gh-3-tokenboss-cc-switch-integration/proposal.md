---
issues: [3]
status: draft
affects:
  - frontend
  - backend
  - docs
created: 2026-05-13
slug: gh-3-tokenboss-cc-switch-integration
---

# Proposal · TokenBoss → CC Switch 一键导入（v1.0）

## 背景

当前 `/install/manual` 屏给 OpenClaw / Hermes / Codex / OpenAI-compat 四个 Agent 写了 753 行 install → configure → verify 教程（`frontend/src/screens/ManualConfigPC.tsx`）。对普通用户来说复制粘贴负担过重 — 每个 CLI 工具都要手动改 config 文件、填 base URL、贴 API key。

另有 `docs/AI配置指令-TokenBoss厂商.md`（258 行）是"把这份文档贴给 AI 让 AI 帮你配"的产物，但本质还依赖用户自己的 AI 助手 — 对非 AI Agent 重度用户不友好。

## 目标

让用户从 TokenBoss 网站点 **1 个按钮**，把 TokenBoss 同时配置进本地 OpenClaw / Hermes / Codex / OpenCode / Claude Code 五个主流 AI CLI 工具。

## 方案概要

利用开源 [CC Switch](https://github.com/farion1231/cc-switch)（68.9k★ Tauri 桌面 app）的 `ccswitch://v1/import` Deep Link 协议：

- 用户在 `/install/manual` 点 "一键导入到 CC Switch"
- Frontend 调 `POST /api/me/deep-link` 拿后端生成的 5 个 `ccswitch://` URL
- Frontend 依次（间隔 200ms）触发 5 个 URL
- CC Switch 弹 5 张独立确认卡片（实证 — 见 §6 详见 [[../repo-reality.md]] 调研发现）
- 用户在 CC Switch 内接受 → 各 CLI config 文件被写入

Claude Code 因为用 Anthropic-native 协议（`/v1/messages`）而 TokenBoss 当前只暴露 OpenAI-compat（`/v1/chat/completions`），新增 backend `POST /v1/messages` shim 做 Anthropic↔OpenAI 双向格式转换（含 streaming SSE 转换）。

## v1.0 Scope

**包含：**

1. `/install/manual` 整屏重写 — 主流 UX：1 个"一键导入"按钮 + 协议族外链 + 旧 753 行 recipe 收纳到 disclosure 折叠
2. 新增 `POST /api/me/deep-link` endpoint（生成 5 个 deep link + 管理 reserved "CC Switch" key）
3. 新增 `POST /v1/messages` Anthropic-compat shim（含 streaming SSE 双向转换）
4. 3 个新协议族文档路由：`/docs/protocols/{openai-compat,anthropic-shim,gemini-proxy}`
5. 登录态自动 inject key / 未登录态贴 key 兜底
6. CC Switch 未装的 explicit UX 引导（不做自动 detect）
7. 全仓 URL 修正：`tokenboss-backend.zeabur.app` → `api.tokenboss.co/v1`（Reality check 发现的污染面，详见 [[repo-reality.md]]）
8. `docs/AI配置指令-TokenBoss厂商.md` 归档到 `docs/legacy/`（内容拆解到新 3 个协议族文档路由）

## Out of Scope（独立 REQ follow-up）

- onboarding / landing / dashboard 三个扩散入口 → v1.1
- Fork CC Switch 为 "TokenBoss Desktop"（登录态 + 余额查看 + 后续扩展）→ REQ-B
- Gemini-native shim → 视 v1 fallback 数据决定后续
- cc-switch upstream PR 加 TokenBoss 为内置 preset → 独立小 REQ

## 关键技术决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | `POST` 而非 `GET` /api/me/deep-link | 隐式可能创建 reserved key 是写操作 |
| D2 | Reserved `"CC Switch"` key **每个用户最多 1 个**（按 `purpose: "ccswitch-import"` 字段唯一标识） | 避免每次点按钮都新建 key 让用户 key 列表膨胀；purpose 字段方便单独 revoke 这个 key 不影响其他集成 |
| D3 | Streaming SSE 转换必做 | Claude Code 默认 `stream=true`，不做等于 v1 不支持 Claude Code |
| D4 | 不做 CC Switch 自动探测 | 跨平台 probe 不稳定，UX 用 explicit "去 ccswitch.io 下载" 引导 |
| D5 | 单 PR ship + 不加 feature flag | 改动主要是全新增量（新 endpoint / 新屏），现有 `/v1/chat/completions` 不动 |
| D6 | Frontend 依次触发 5 个 ccswitch:// (非 batch URL) | 实证验证 CC Switch 接收后展示 4 张独立确认卡片，UX 可接受；无需依赖 upstream batch schema PR 周期 |

## 约束 / 限制条件

- **单仓单 PR** 合入 main
- **不动**现有 `/v1/chat/completions`、`/v1/responses` OpenAI-compat 路径
- **Mac-only 实测**（v1 实证），Win/Linux 标 "应工作但未验证"列入 v1.1 验收
- Backend 不引入新 DB schema（reserved key 是普通 newapi key 一条记录）
- 不引入新环境变量

## 主要风险

| # | 风险 | 严重度 | Mitigation |
|---|---|---|---|
| R1 | Streaming SSE 转换实现复杂、漏边界 | 🔴 高 | 8 组 fixture 覆盖；Sentry breadcrumb 看真实 SSE 流；Stage 3.5 Vertical Slice 实操 |
| R2 | CC Switch deep link schema v1 升级到 v2 breaking change | 🟠 中 | 订阅 cc-switch 仓库 release notification；schema 版本号已在 URL path 里 |
| R3 | 跨平台 v1 only Mac 实测 | 🟠 中 | v1.1 验收纳入 Win/Linux |
| R4 | Reserved key 命名冲突 | 🟡 低 | Backend 按 `purpose` 字段唯一识别，不按 name |
| R5 | 未登录贴 key 路径 funnel 数据丢失 | 🟡 低 | 接受，v1.5 加 frontend analytics |
| R6 | CC Switch 老版本不支持当前 deep link schema | 🟡 低 | 文案提示 "需要 CC Switch v3.0+" |
| R7 | 用户在 CC Switch 内 dismiss 卡片我们不感知 | 🟡 低 | CC Switch upstream 无 webhook；接受 |

## 估算

约 **17.5-19.5 工作日 ≈ 2.5 周**（单人），含日历缓冲。

11 个 high-level task 切片（写到 [[tasks.md]]，Stage 2 writing-plans 时填到文件 / 代码级颗粒）：

1. `anthropicConvert.ts` lib + 8 组 fixture（含 streaming）— backend ~4-5 天
2. `ccSwitchUrl.ts` lib + 5 app × fixture — backend ~1 天
3. `deepLinkHandler.ts` + reserved key 选择策略 + 单元测试 — backend ~1.5 天
4. `messagesProxy.ts` endpoint + 集成测试（含 streaming round-trip）— backend ~2-3 天
5. Frontend lib: `api.getDeepLink()`, `agentDefs.ts` — frontend ~0.5 天
6. 7 个新组件 — frontend ~3 天
7. `ManualConfigPC.tsx` 整屏重写 — frontend ~1.5 天
8. 3 个 `/docs/protocols/*` 子路由屏（重写自 `docs/AI配置指令-TokenBoss厂商.md`）— frontend ~2-2.5 天
9. 全仓 URL 修正 + `docs/AI配置指令-TokenBoss厂商.md` 归档 — docs ~0.5 天
10. E2E playwright 测试 — frontend ~1 天
11. Stage 3.5 Vertical Slice 实操 + 录屏 — full ~0.5 天

## Cross-spec dependencies

- 无（v1 第一个 REQ，无依赖；本 REQ 是后续 v1.1 / REQ-B 的 prerequisite）

## 相关资源

- GitHub Issue: https://github.com/sycsky/tokenboss_s/issues/3
- CC Switch 项目: https://github.com/farion1231/cc-switch
- CC Switch deep link schema 示例: 见 https://github.com/farion1231/cc-switch/blob/main/deplink.html
- Stage 0 现状盘点: [[repo-reality.md]]
- GWT 场景详: [[specs/cc-switch-integration/spec.md]]
- 架构 / 数据流 / 接口设计: [[design.md]]（Stage 2 写）
- 任务清单: [[tasks.md]]（Stage 2 写）
- HTML 原型: `mock/`（Stage 2.5 写）
