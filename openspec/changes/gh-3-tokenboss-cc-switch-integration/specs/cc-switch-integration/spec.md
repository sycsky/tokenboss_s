---
capability: cc-switch-integration
change: gh-3-tokenboss-cc-switch-integration
---

# Capability Spec · CC Switch Integration

GWT scenarios for v1.0 主流程 + 边界路径 + Anthropic shim 后续调用。RFC 2119 关键词（MUST / SHOULD / MAY）用于强制级别。

## Requirement: 主流程 · 登录态用户一键导入

The system MUST allow a logged-in user to import TokenBoss as a provider into all 5 supported CLI tools (OpenClaw, Hermes, Codex, OpenCode, Claude Code) via a single button click that triggers CC Switch deep links.

### Scenario: 已登录用户首次点 "一键导入" 触发 5 个 deep link

- **GIVEN** 用户已登录 TokenBoss 网站（有有效 session cookie）
- **AND** 用户本机已装 CC Switch（任何版本 ≥ v3.0）
- **AND** 用户账号下不存在名为 `"CC Switch"` 的 reserved key
- **WHEN** 用户访问 `/install/manual` 并点击主按钮 "一键导入到 CC Switch"
- **THEN** Backend 自动创建一个 `name: "CC Switch"` + `purpose: "ccswitch-import"` 的新 key
- **AND** Backend 返回 5 个 `ccswitch://v1/import?...` URL（对应 5 个 CLI app）
- **AND** Frontend 依次（间隔 200ms）调用 `window.location.assign(url)` 触发 5 个 URL
- **AND** CC Switch 弹 5 张独立确认卡片
- **AND** Frontend 屏上显示 toast "5 张确认卡片已发送到 CC Switch"

### Scenario: 已登录用户再次点 "一键导入"（reserved key 已存在）

- **GIVEN** 用户已登录且账号下**已有**名为 `"CC Switch"` + `purpose: "ccswitch-import"` 的 key
- **WHEN** 用户点击 "一键导入"
- **THEN** Backend **不创建新 key**，复用已有 reserved key
- **AND** 返回 5 个 deep link URL 含同一个 API key
- **AND** Frontend 同上流程触发

### Scenario: 用户在 CC Switch 内接受 5 张卡片后跑本地 CLI

- **GIVEN** 5 张确认卡片在 CC Switch 内展示
- **WHEN** 用户在 CC Switch 内点 "Import All" 或逐个 "Import"
- **THEN** CC Switch 写入对应 CLI config 文件：
  - `~/.codex/config.toml` 加 `[model_providers.tokenboss]` 块
  - `~/.openclaw/...` 加 TokenBoss provider
  - `~/.claude/settings.json` 加 `ANTHROPIC_BASE_URL` 等 env
  - OpenCode / Hermes 各自的 config 路径
- **AND** 用户跑 `codex` / `openclaw` / 任何 CLI 时，请求自动发往 `https://api.tokenboss.co/v1`

## Requirement: 兜底路径 · 未登录用户贴 key import

The system MUST allow an anonymous (not logged in) user to manually paste their existing TokenBoss API key and trigger the same 5-deep-link import flow, without requiring the user to register or log in.

### Scenario: 未登录用户用已有 key 完成 import

- **GIVEN** 用户**未登录** TokenBoss 网站
- **AND** 用户本机已装 CC Switch
- **AND** 用户已经有一个 TokenBoss API key（之前在别处创建的）
- **WHEN** 用户访问 `/install/manual` 看到 `<KeyInjectionFlow>`
- **AND** 用户选 "我自己粘 key" 路径
- **AND** 用户在输入框粘贴有效 key（`sk-` + 48 chars 格式）
- **AND** 用户点 "一键导入到 CC Switch"
- **THEN** Frontend **不调 backend**，直接 client-side 构造 5 个 ccswitch:// URL 含用户粘贴的 key
- **AND** Frontend 依次触发 5 个 URL（同登录态流程）
- **AND** Backend 不感知此次 import 行为（funnel 数据缺失 — 接受，v1.5 加 analytics）

### Scenario: 未登录用户粘贴格式不对的 key

- **GIVEN** 用户未登录
- **WHEN** 用户在贴 key 输入框输入 `not-a-real-key`（不是 `sk-` 开头或长度不对）
- **THEN** Frontend 在 client-side 校验 key 格式（regex `/^sk-[A-Za-z0-9]{48}$/`）
- **AND** 显示错误提示 "key 格式不对，应为 `sk-` 开头 48 字符"
- **AND** "一键导入" 按钮保持 disabled 状态

## Requirement: Anthropic-compat Shim · Claude Code 接入

The system MUST expose a `POST /v1/messages` endpoint that accepts Anthropic-native format requests (matching `/v1/messages` schema of api.anthropic.com), translates them to OpenAI-compat format, dispatches to internal chat proxy, and translates responses back — including server-sent events for streaming.

### Scenario: Claude Code 发起非 streaming chat 请求

- **GIVEN** 用户已通过 CC Switch import 把 TokenBoss 配进 Claude Code
- **AND** Claude Code 的 `ANTHROPIC_BASE_URL=https://api.tokenboss.co/v1`
- **WHEN** Claude Code 发起 `POST /v1/messages` 请求 body 形如 `{"model":"claude-sonnet-4-5","messages":[...],"max_tokens":1024}`（无 `stream` 字段或 `stream: false`）
- **THEN** Backend 接收 Anthropic-format request
- **AND** 调用 `anthropicConvert.requestToOpenAI()` 转成 OpenAI-format
- **AND** 内部 dispatch 给现有 `chatProxy` 路由逻辑（不走 HTTP）
- **AND** 拿到 OpenAI-format response 后调用 `anthropicConvert.responseToAnthropic()`
- **AND** 返回 Anthropic-format response（`{content: [...], stop_reason, ...}`）
- **AND** Claude Code 客户端 happy path 不报错

### Scenario: Claude Code 发起 streaming chat 请求

- **GIVEN** 同上配置
- **WHEN** Claude Code 发起 `stream: true` 请求
- **THEN** Backend 启动 streaming response
- **AND** 消费上游 OpenAI-format SSE chunks
- **AND** Emit Anthropic-format SSE events 序列：`message_start` → `content_block_start` → `content_block_delta` × N → `content_block_stop` → `message_delta` → `message_stop`
- **AND** Claude Code 客户端正常显示流式输出

### Scenario: Claude Code 用 tool_use（function calling）

- **GIVEN** 同上配置
- **WHEN** Claude Code 发起带 `tools` 数组的 request
- **THEN** Backend 转换 Anthropic tool schema → OpenAI tool schema
- **AND** Response 中 OpenAI 的 `tool_calls` 转回 Anthropic 的 `tool_use` content block
- **AND** Claude Code 收到符合 Anthropic format 的 tool use 响应

### Scenario: 上游返回错误（model_not_found / 401 / 429 / 5xx）

- **GIVEN** 同上配置
- **WHEN** 内部 chatProxy 返回 OpenAI-format error response
- **THEN** Backend 调用 `anthropicConvert.errorToAnthropic()` 转换
- **AND** 返回 Anthropic-format error `{"type":"error","error":{"type":"...","message":"..."}}`
- **AND** HTTP status code 透传（401 / 429 / 5xx）

## Requirement: CC Switch 未装的 explicit UX

The system MUST provide an explicit, always-visible "未装 CC Switch?" guidance card linking to ccswitch.io, instead of attempting to auto-detect CC Switch installation status.

### Scenario: 用户首次访问 /install/manual

- **GIVEN** 用户访问 `/install/manual`（登录态或未登录都一样）
- **WHEN** 屏渲染
- **THEN** Hero 区域显示 `<CCSwitchDetector>` 卡片，文案为 "未装 CC Switch?" + 链接 [https://ccswitch.io](https://ccswitch.io) + "Mac / Win / Linux 都有"
- **AND** 这个卡片**永远显示**（不做 detect）

### Scenario: 用户没装 CC Switch 但点了主按钮

- **GIVEN** 用户未装 CC Switch
- **WHEN** 用户点 "一键导入到 CC Switch"
- **THEN** Frontend 仍然依次触发 5 个 `ccswitch://` URL（不做 pre-check）
- **AND** OS 弹"找不到应用打开此 URL"对话框（macOS / Windows / Linux 各自的系统 UI）
- **AND** TokenBoss 不另外提示（OS 的提示已足够明确）

## Requirement: 旧 753 行 recipe 收纳

The system MUST preserve the existing 753-line per-Agent install recipe content (OpenClaw / Hermes / Codex / OpenAI-compat) inside a default-collapsed disclosure panel as a fallback for advanced users.

### Scenario: 高级用户找回旧手动配置教程

- **GIVEN** 重写后的 `/install/manual` 屏
- **WHEN** 用户滚到屏底
- **THEN** 看到 `<details>` 折叠 panel，summary 文字 "高级 · 手动配置 recipe"
- **AND** 默认折叠（disclosure closed）
- **AND** 展开后看到原 4 个 Agent recipe（OpenClaw / Hermes / Codex / OpenAI-compat），内嵌 URL 已修正为 `api.tokenboss.co/v1`

## Requirement: 3 个协议族文档子路由

The system MUST provide three new frontend routes under `/docs/protocols/*` documenting the OpenAI-compat / Anthropic-shim / Gemini-proxy approaches respectively, rewritten from `docs/AI配置指令-TokenBoss厂商.md` and adapted to a human-reader perspective (not AI-execution-instruction format).

### Scenario: 用户查 OpenAI-compat 协议详解

- **GIVEN** 用户在 `/install/manual` 看到底部 `<ProtocolFamilyLinks>`
- **WHEN** 用户点 "OpenAI-compat 协议详解" 卡片
- **THEN** 跳转到 `/docs/protocols/openai-compat`
- **AND** 屏内容覆盖：协议总览、TokenBoss 自定义模型列表、高级配置（Cursor / Cherry Studio / Chatbox / NextChat 等其他 OpenAI-compat 工具）、错误码表、troubleshooting
- **AND** 所有 base URL 引用为 `https://api.tokenboss.co/v1`

### Scenario: 用户查 Claude 协议接入

- **GIVEN** 同上
- **WHEN** 用户点 "Claude 协议接入" 卡片
- **THEN** 跳转到 `/docs/protocols/anthropic-shim`
- **AND** 屏内容覆盖：backend `/v1/messages` shim 工作原理、Claude Code 配置说明、CC Switch 手动配置 fallback（不通过 deep link）、streaming 支持声明

### Scenario: 用户查 Gemini 协议接入

- **GIVEN** 同上
- **WHEN** 用户点 "Gemini 协议接入" 卡片
- **THEN** 跳转到 `/docs/protocols/gemini-proxy`
- **AND** 屏内容覆盖：Gemini CLI 协议跟 TokenBoss 不直接兼容的说明、用 CC Switch local proxy + format conversion 手动配置教学、v1 不做 native shim 的理由

## Requirement: 全仓 URL 修正

The system MUST replace all stale references to `tokenboss-backend.zeabur.app` (the Zeabur internal domain) with `api.tokenboss.co` (the canonical public API endpoint) across all frontend code, backend code, documentation, and openspec-tracked content.

### Scenario: ManualConfigPC 旧 recipe 内嵌 URL

- **GIVEN** 旧 `RECIPES` 数据数组（4 个 Agent recipe）被搬到 `<AdvancedManualRecipes>` disclosure
- **WHEN** 用户展开 disclosure 看 OpenClaw recipe 的 curl 命令
- **THEN** 命令中的 URL 显示为 `https://api.tokenboss.co/v1`（不是 `tokenboss-backend.zeabur.app/v1`）

### Scenario: ROUTER_DEV.md 引用

- **GIVEN** `ROUTER_DEV.md` 顶层文档
- **WHEN** 查看文件
- **THEN** 所有 `tokenboss-backend.zeabur.app` 替换为 `api.tokenboss.co`（保留语义，比如环境变量 `TOKENBOSS_API_URL` 默认值改为 `https://api.tokenboss.co`）

### Scenario: 老 docs/AI配置指令-TokenBoss厂商.md 归档

- **GIVEN** v1.0 PR merge 后
- **WHEN** 查看仓库
- **THEN** `docs/AI配置指令-TokenBoss厂商.md` 已移到 `docs/legacy/AI配置指令-TokenBoss厂商.md`
- **AND** 文件顶部加一行 "本文档已归档。新协议族指南见 [/docs/protocols/openai-compat](/docs/protocols/openai-compat) 等"
