# Vertical Slice Report · gh-3 v1.0 Final Acceptance

> Stage 3.5 Vertical Slice gate — full e2e 端到端实测，验证 backend + frontend + CC Switch + CLI 完整链路。
>
> 用户填空 / 勾选。完成后改"## 通过结论"为实际状态，commit + push。

---

## 测试环境

- **branch:** `feature/gh-3-stage3` (10 个 implementation commits land 完毕)
- **backend:** 启动 `cd backend && npm run dev`（或 `npm run dev:mock`）
- **frontend:** 启动 `cd frontend && npm run dev`
- **CC Switch:** 已装 v3.14.1 at `/Applications/CC Switch.app`
- **测试日期:** _________

## 测试步骤实测

### 1. 主流程（登录态用户一键导入）

- [ ] 浏览器访问 http://localhost:5173/install/manual
- [ ] 已登录态（localStorage `tb_session` 有效 JWT）
- [ ] 看到 Hero + `CCSwitchDetector` + `<PrimaryImportButton>` "一键导入到 CC Switch"
- [ ] 点击主按钮
- [ ] CC Switch 弹 **___ 张确认卡片**（预期：5 张 — openclaw / hermes / codex / opencode / claude）
- [ ] 卡片内容显示 TokenBoss + base_url = `https://api.tokenboss.co/v1` + fresh `sk-` key
- [ ] toast 显示 "已发送到 CC Switch" 或类似

### 2. 接受卡片 → CLI config 写入

逐个或一次接受全部 5 张。验证：

- [ ] `~/.codex/config.toml` 新增 `[model_providers.tokenboss]` block, `base_url = "https://api.tokenboss.co/v1"`
- [ ] `~/.openclaw/...` (具体路径取决于 OpenClaw 实际 config schema) 含 TokenBoss provider
- [ ] `~/.claude/settings.json` 含 `ANTHROPIC_BASE_URL=https://api.tokenboss.co`（**不带 /v1**, D8）+ `ANTHROPIC_AUTH_TOKEN=sk-...`
- [ ] OpenCode 和 Hermes 各自 config 路径同理

### 3. CLI 真实 chat 请求 (happy path)

每个 CLI 跑一次最小 ping 测试：

- [ ] `codex` "ping": ✓ / ✗ · 上游模型 `claude-sonnet-4-5` / 其他 · 延迟 ___ ms
- [ ] `openclaw` (or其他 OpenAI-compat CLI you 实际装的) "ping": ✓ / ✗
- [ ] `claude` (Claude Code) streaming "ping": ✓ / ✗ · 流式 chunk 数 ___ · 是否看到 reply
- [ ] Anthropic shim 转换正确（Claude Code 端没报 protocol error）

### 4. 协议族文档子路由（Task 8 产物）

- [ ] http://localhost:5173/docs/protocols/openai-compat 屏渲染 + 内容完整
- [ ] http://localhost:5173/docs/protocols/anthropic-shim 屏渲染 + D8 黄色 callout 显眼
- [ ] http://localhost:5173/docs/protocols/gemini-proxy 屏渲染 + 解释 v1 不一键导入的原因

### 5. 边界情况（可选）

- [ ] 未登录态访问 /install/manual：看到 `<AnonKeyPasteInput>` + 输入框 + 校验
- [ ] 贴非法 key（如 `not-sk-...`）：按钮 disable + 错误提示
- [ ] 贴合法 key（`sk-` + 48 chars）：按钮 enable + 点击触发 5 个 ccswitch:// (CC Switch 又弹 5 张)

## Spec drift 发现（如有）

> 实测期间发现 spec / design.md 跟现实偏差，回写到 [[../design.md]] §10 Spec Drift 章节（已有 SD-1/2/3/4，按需追加 SD-5+）。

- [ ] 无 spec drift
- [ ] 发现 spec drift：（描述）

## 录屏 / GIF（可选但强烈推荐）

- [ ] 录 1-2 分钟 screencast 跑 happy path（用 QuickTime Mac 内置 / Loom / OBS）
- [ ] 保存到 `mock/vertical-slice-demo.mp4` 或 `.gif`
- [ ] 上传到 GitHub Issue #3 作为 attachment

## 通过结论

- [ ] ✅ **PASS** — 全部步骤 ✓，准备走 Stage 4 测试 + Stage 5 review + Stage 6 archive ship
- [ ] 🟡 **PARTIAL PASS** — 主路径 ✓，但发现 ___ 阻塞项（列出），需小 hot-fix
- [ ] 🔴 **FAIL** — 重大问题（描述），回 Stage 2 改 design

## 后续步骤（PASS 后）

按 WORKFLOW.md Stage 4-6:

- **Stage 4 测试验证**：5 项绿色（单元 + 集成 + E2E + 安全 + UI）。当前已经：
  - ✅ Backend 单元 + 集成：__ tests pass
  - ✅ Frontend 单元：__ tests pass
  - ✅ E2E Playwright：2/2 pass
  - ⏸ 安全扫描：__（npm audit pending）
  - ⏸ UI 视觉 diff：N/A (本期未做 visual regression)
- **Stage 5 代码审查**：feature/gh-3-stage3 → main PR + reviewer 审 + 4-选项决策 (merge/keep/discard/handoff)
- **Stage 6 完成开发分支**：finishing-a-development-branch skill + /opsx:archive + 反向回写 spec drift to capability spec
