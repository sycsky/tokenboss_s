---
capability: cc-switch-integration
shipped_via:
  - gh-3-tokenboss-cc-switch-integration  # v1.0 - merge df41a7f - 2026-05-14
last_updated: 2026-05-14
---

# Capability Spec · CC Switch Integration

跨 REQ 长期累积的产品行为契约。GWT scenarios 描述用户可观察的行为，**反映实际 shipped 的实现**（含 Stage 3.5 Vertical Slice 发现并固化的决策）。

RFC 2119 关键词（MUST / SHOULD / MAY）用于强制级别。

## Requirement: 主流程 · 登录态用户 per-agent 导入

The system MUST allow a logged-in user to import TokenBoss as a provider into all 5 supported CLI tools (OpenClaw, Hermes, Codex, OpenCode, Claude Code) via a per-agent click model — one user gesture per CLI, one `ccswitch://` URL fired per click.

> **历史决策（SD-6 fixed in gh-3 Stage 3.5）：** 早期 design 是"单个 master 按钮触发 5 个 URL"，但浏览器（Chromium / Safari）对同一 tab 内连续 `window.location.assign(customScheme)` 或 hidden iframe 多个 src navigation 都有不可预测 throttle —— 实测只有第一个到 OS handler。**实际 shipped = per-card grid**：用户看见 5 张 agent 卡片，逐个点击 = 1 user gesture = 1 deep link，浏览器一定放行。

### Scenario: 已登录用户首次点任意 card → lazy fetch + cache 5 URL + 触发当前 card

- **GIVEN** 用户已登录 TokenBoss 网站（有有效 session cookie）
- **AND** 用户访问 `/install/manual`
- **AND** 用户账号下不存在名为 `"CC Switch"` 的 reserved newapi token
- **WHEN** 用户点击任意一张 agent 卡片的"导入到 X"按钮（第一次）
- **THEN** Frontend POST `/v1/deep-link` 调 backend
- **AND** Backend `findUserKeyByName("CC Switch")` → 未找到 → `createAndRevealToken({name: "CC Switch", ...})` 在 newapi 端创建新 token
- **AND** Backend 用刚创建的 plaintext key 生成 5 个 `ccswitch://v1/import?...` URL（5 个 app 各一个）+ 返回 `DeepLinkResponse`
- **AND** Frontend 缓存这 5 个 URL 到 React state
- **AND** Frontend 触发**当前点击 card 对应的那 1 个** `ccswitch://` URL（通过 `triggerDeepLink` lib 的 hidden iframe 触发）
- **AND** CC Switch 弹**1 张独立确认卡片**
- **AND** 当前 card UI 变 ✓ 绿色，进度行从 "0/5 已导入" → "1/5 已导入"

### Scenario: 已登录用户继续点其余 cards → 使用缓存，每张 card 1 个 ccswitch://

- **GIVEN** 用户上一步已点击过任意 1 张 card（5 个 URL 已缓存在 state）
- **WHEN** 用户依次点击剩余 4 张 card 的"导入"按钮
- **THEN** 每次点击 **不重新调** `/v1/deep-link`（D7 invariant：重复调会让前几个 key 失效）
- **AND** 复用缓存中对应 app 的 URL 触发 ccswitch://
- **AND** CC Switch 每次弹 1 张独立确认卡片
- **AND** 全部 5 张点完后，进度行显示 "5/5 已导入"，grid 下方出现"全部完成" celebration block

### Scenario: 已登录用户第二次访问 /install/manual（refresh 或新 session） — D7 删旧建新

- **GIVEN** 用户上次访问过 /install/manual，accept 过部分或全部 CC Switch 卡片，账号 newapi 端已有 `"CC Switch"` token
- **WHEN** 用户重新打开 /install/manual 且任意 card 第一次点击
- **THEN** Backend 调 `listUserTokens` 找到 existing `"CC Switch"` token
- **AND** Backend 调 `deleteUserToken(session, existing.id)` 删除老 token
- **AND** Backend 调 `createAndRevealToken({name: "CC Switch", ...})` 创建新 token（fresh plaintext key）
- **AND** Frontend 缓存新 URL + 触发当前 card 的 URL
- **AND** 用户之前 CC Switch 配置中的 sk- key 已失效（CLI 跑会 401）— 用户需要重新 accept 5 张卡片以接收新 key

> **D7 rationale**: newapi `listUserTokens` 返回 masked plaintext，无法跨调用 reuse 同一个 key。删旧建新让用户每次"重新接入"得到 fresh key，避免歧义。代价：旧的 sk- key 失效，用户需重新 import 5 张。

### Scenario: 用户在 CC Switch 内接受卡片后跑本地 CLI

- **GIVEN** 用户接受了任意一张 CC Switch 确认卡片（比如 openclaw）
- **THEN** CC Switch 写入对应 CLI 的本地 config 文件：
  - **openclaw**: `~/.openclaw/openclaw.json` 加 TokenBoss provider with `baseUrl=https://api.tokenboss.co/v1` + `apiKey=sk-...`
  - **codex**: `~/.codex/config.toml` 加 `[model_providers.tokenboss]` 块 + `base_url`
  - **hermes**: Hermes 的 config 路径加 TokenBoss provider
  - **opencode**: OpenCode 的 config 路径加 TokenBoss provider
  - **claude** (Claude Code): `~/.claude/settings.json` 加 `env: { ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL=https://api.tokenboss.co, ANTHROPIC_MODEL=claude-sonnet-4-6, ... }`
- **AND** 用户跑对应 CLI 时，请求自动发往 `https://api.tokenboss.co/v1`（OpenAI-compat CLIs）或 `/v1/messages`（Claude Code via Anthropic shim）

## Requirement: 兜底路径 · 未登录用户贴 key import

The system MUST allow an anonymous (not logged in) user to manually paste an existing TokenBoss API key and trigger the same per-agent import flow client-side (no backend call), without requiring registration or login.

### Scenario: 未登录用户贴 valid key → grid appear → per-card click

- **GIVEN** 用户**未登录** TokenBoss 网站
- **AND** 用户已有一个有效的 TokenBoss API key（`sk-` + 48 chars 格式）
- **WHEN** 用户访问 `/install/manual` 看到 `<AnonKeyPasteInput>`
- **AND** 用户在输入框粘贴 key
- **THEN** Frontend 在 client-side 校验 key 格式（regex `/^sk-[A-Za-z0-9]{48}$/`）
- **AND** 校验通过后，输入框下方 render `<AgentImportGrid>` 显示 5 张 agent 卡片
- **WHEN** 用户依次点击各 card 的"导入到 X"按钮
- **THEN** Frontend 直接 client-side 用 `buildAllCCSwitchUrls(key)` 构造 5 个 URL（**不调 backend** — 无需 session）
- **AND** 每次点击触发对应 card 的 ccswitch:// URL
- **AND** Backend 不感知此次 import 行为（funnel 数据缺失 — 接受，未来 v1.5 加 analytics）

### Scenario: 未登录用户粘贴格式不对的 key

- **WHEN** 用户在输入框输入 `not-a-real-key`（不是 `sk-` 开头或长度不对）
- **THEN** Frontend client-side 校验失败
- **AND** 显示错误提示 "格式不对：Key 应该是 sk- 开头 + 48 位字母/数字"
- **AND** `<AgentImportGrid>` **不渲染**（grid 仅在 key 校验通过后才出现）

## Requirement: Deep link 默认 model name 跟 TokenBoss newapi channel 一致

The system MUST configure CC Switch deep link defaults with model names that match TokenBoss newapi's actual provisioned channels — clients fail at runtime if the default model isn't available upstream.

> **历史教训（SD-7 fixed in gh-3 Stage 3.5）：** 早期硬编码 `claude-sonnet-4-5` / `claude-haiku-4-5` 等模型名，实测 newapi 实际只有 `claude-sonnet-4-6` / `claude-opus-4-6` / `claude-opus-4-7`（无 haiku）→ Claude Code 默认调 `-4-5` → 503 "no available channel"。

### Scenario: Deep link Claude env 含真实可用模型

- **WHEN** Backend 或 frontend 构造 `claude` app 的 deep link
- **THEN** Embedded JSON config 含：
  - `ANTHROPIC_AUTH_TOKEN: <user_key>`
  - `ANTHROPIC_BASE_URL: https://api.tokenboss.co`（**不带 /v1** — D8: Claude Code 客户端自动拼 `/v1/messages`）
  - `ANTHROPIC_MODEL: claude-sonnet-4-6`
  - `ANTHROPIC_DEFAULT_HAIKU_MODEL: claude-sonnet-4-6`（newapi 无 haiku，sonnet 顶；slower 但 work；用户可在 CC Switch UI 自调）
  - `ANTHROPIC_DEFAULT_SONNET_MODEL: claude-sonnet-4-6`
  - `ANTHROPIC_DEFAULT_OPUS_MODEL: claude-opus-4-7`

### Scenario: Deep link Codex TOML 含真实可用模型

- **WHEN** Backend / frontend 构造 `codex` app 的 deep link
- **THEN** Embedded TOML config 的 `[general].model` 字段 = `claude-sonnet-4-6`（不再是 `-4-5`）

> **长期方案（v1.0.1+ 路线图）：** Backend `/v1/deep-link` handler 在生成时调一次 `/v1/models`，从 `owned_by="vertex-ai"` 的 Claude 列表里挑最新版本动态填，避免每次 model 升级都要改 hardcode。

## Requirement: Anthropic-compat Shim · Claude Code 接入

The system MUST expose a `POST /v1/messages` endpoint that accepts Anthropic Messages API format requests, translates them to OpenAI-compat format, dispatches to internal chat proxy, and translates responses back — including server-sent events for streaming.

### Scenario: Claude Code 发起 non-streaming chat 请求

- **GIVEN** 用户已通过 CC Switch import 把 TokenBoss 配进 Claude Code
- **AND** Claude Code 的 `ANTHROPIC_BASE_URL=https://api.tokenboss.co`（D8: 不带 /v1）
- **AND** `ANTHROPIC_AUTH_TOKEN=sk-<48chars>`
- **AND** `ANTHROPIC_MODEL=claude-sonnet-4-6`（newapi 实际可用模型）
- **WHEN** Claude Code 发起 `POST /v1/messages` 含 `{"model":"claude-sonnet-4-6","messages":[...],"max_tokens":...}`（无 `stream` 或 `stream: false`）
- **THEN** Backend 接收 Anthropic-format request，正确 parse
- **AND** 转 OpenAI-format 后 dispatch 给 internal chat proxy（不走 HTTP）
- **AND** 上游 newapi → real Vertex AI 返回 OpenAI-format response
- **AND** Backend 转回 Anthropic-format response（`{id, type:"message", role:"assistant", content:[...], model, stop_reason, usage}`）
- **AND** Claude Code 客户端 happy path 不报错，正常显示模型回复

### Scenario: Claude Code 发起 streaming chat 请求

- **GIVEN** 同上配置
- **WHEN** Claude Code 发起 `stream: true` 请求
- **THEN** Backend 启动 streaming response，Content-Type: text/event-stream
- **AND** 消费上游 OpenAI-format SSE chunks
- **AND** Emit Anthropic-format SSE 事件序列（顺序）：
  1. `event: message_start` data 含 `msg_<24hex>` 合成 id + input_tokens 估算 + output_tokens=0
  2. `event: content_block_start` data type:"text"
  3. `event: content_block_delta` data type:"text_delta" × N（每个 text chunk 一次）
  4. `event: content_block_stop`
  5. `event: message_delta` data 含 stop_reason + 累计真实 output_tokens
  6. `event: message_stop`
- **AND** Claude Code 客户端正常逐步显示流式输出

### Scenario: Claude Code 用 tool_use（function calling）

- **WHEN** Claude Code 发起含 `tools` 数组 + 可能含 `tool_choice` 的 request
- **THEN** Backend 转换 Anthropic tool schema → OpenAI `{type:"function", function:{name, description, parameters}}`
- **AND** 转 `tool_choice` 3-way mapping (auto → "auto", any → "required", tool+name → function struct)
- **AND** Response 中 OpenAI 的 `tool_calls` 转回 Anthropic 的 `tool_use` content block（含 `id`、`name`、`input` 解析自 arguments JSON）
- **AND** Streaming 路径：`input_json_delta` 事件累计 tool 的 arguments 片段

### Scenario: Backend 不支持的 Anthropic 字段

- **WHEN** Request 含 `top_k` 字段
- **THEN** Backend 静默 drop + console.warn（OpenAI 无对应字段；request 仍然转换并 dispatch 成功）
- **WHEN** Request 含 `cache_control`（Anthropic prompt caching）/ `service_tier` / `anthropic-beta` headers
- **THEN** Backend 同样 drop（v1.0 不支持这些 Anthropic 高级 feature，未来 v1.x 视需要加）

### Scenario: 上游错误 propagate（401 / 402 / 429 / 5xx）

- **WHEN** 内部 chat proxy 返回错误 response（含 HTTP status + body）
- **THEN** Backend 调用 `errorToAnthropic` 转换错误 type
- **AND** 返回 Anthropic-format error body `{type:"error", error:{type: "<mapped>", message: "<from upstream>"}}`
- **AND** HTTP status code 透传（401 → 401, 402 → 402, 429 → 429, 5xx → 5xx）
- **AND** Error type mapping：
  - `authentication_error` / `authentication` → `authentication_error`
  - `permission_denied` → `permission_error`
  - `not_found` → `not_found_error`
  - `rate_limit_exceeded` → `rate_limit_error`
  - `overloaded` / `service_unavailable` → `overloaded_error`
  - `server_error` / 其他 → `api_error`

## Requirement: CC Switch 未装的 explicit UX

The system MUST provide an explicit, always-visible "未装 CC Switch?" guidance card linking to ccswitch.io, instead of attempting to auto-detect CC Switch installation status.

### Scenario: 用户访问 /install/manual

- **WHEN** /install/manual 屏渲染（登录态或未登录态都一样）
- **THEN** Hero 区域显示 `<CCSwitchDetector>` 卡片，文案 "还没装 CC Switch?" + 链接 [ccswitch.io](https://ccswitch.io) + "Mac / Win / Linux 都有"
- **AND** 这个卡片**永远显示**，不做 detect（跨浏览器 detect 不稳定）

### Scenario: 用户没装 CC Switch 但点了 card 按钮

- **GIVEN** 用户未装 CC Switch
- **WHEN** 用户点击任意 card 的"导入"按钮
- **THEN** Frontend 仍然触发 ccswitch:// URL（不做 pre-check）
- **AND** OS 弹"找不到应用打开此 URL"对话框（macOS / Windows / Linux 各自的系统 UI）
- **AND** TokenBoss 不另外提示（OS 的提示已足够明确）

## Requirement: 3 个协议族文档子路由

The system MUST provide three frontend routes under `/docs/protocols/*` documenting the OpenAI-compat / Anthropic-shim / Gemini-proxy approaches respectively, rewritten in human-reader perspective from `docs/AI配置指令-TokenBoss厂商.md`（已归档 `docs/legacy/`）.

### Scenario: 用户从 ProtocolFamilyLinks 跳到协议族文档

- **GIVEN** 用户在 /install/manual 看到底部 `<ProtocolFamilyLinks>` 3 个卡片
- **WHEN** 用户点 "OpenAI-compat 协议" → 跳 `/docs/protocols/openai-compat`，含协议总览 + 自定义模型 + 8 个工具配置 + 错误码表
- **WHEN** 用户点 "Claude 协议接入" → 跳 `/docs/protocols/anthropic-shim`，含 backend shim 原理 + Claude Code 配置（含 D8 不带 /v1 黄色 callout）+ CC Switch 手动 fallback + streaming 支持声明
- **WHEN** 用户点 "Gemini 协议接入" → 跳 `/docs/protocols/gemini-proxy`，含 v1 不一键导入的原因 + CC Switch local proxy 手动配置 3 步教程 + 限制 + v2 路线图

## Requirement: 旧 753 行 recipe 收纳

The system MUST preserve the existing 753-line per-Agent install recipe content (OpenClaw / Hermes / Codex / OpenAI-compat) inside a default-collapsed disclosure panel as a fallback for advanced users.

### Scenario: 高级用户找回旧手动配置教程

- **WHEN** 用户滚 /install/manual 到屏底
- **THEN** 看到 `<details>` 折叠 panel，summary "高级 · 手动配置 recipe（旧版完整教程）"
- **AND** 默认折叠
- **AND** 展开后看到原 4 个 Agent recipe，内嵌 URL 已修正为 `https://api.tokenboss.co/v1`

## Requirement: 全仓 URL canonical = api.tokenboss.co

The system MUST use `api.tokenboss.co` as the canonical public TokenBoss API endpoint across all frontend code, backend code, documentation, and openspec-tracked content. The legacy Zeabur internal domain `tokenboss-backend.zeabur.app` MUST NOT appear in active (non-archived) files.

### Scenario: 全仓 grep 无 zeabur.app 残留

- **WHEN** 运行 `grep -rn "tokenboss-backend.zeabur.app" .` 排除 `docs/legacy/` 和 `openspec/changes/archive/`
- **THEN** 应返回零结果

### Scenario: 老 docs/AI配置指令.md 归档

- **GIVEN** `docs/AI配置指令-TokenBoss厂商.md` 是 v0 时代给 AI 看的执行清单
- **WHEN** v1.0 ship 后
- **THEN** 该文件已 `git mv` 到 `docs/legacy/AI配置指令-TokenBoss厂商.md`
- **AND** 文件顶部含归档声明，含跳新 `/docs/protocols/*` 路由的链接
