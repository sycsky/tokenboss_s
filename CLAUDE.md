# TokenBoss — Claude Working Agreement

TokenBoss 是一个面向 **AI Agent 使用者**的 token 经济产品 — OpenClaw / Hermes / Claude Code / Codex 等 agent 用户在自己的 agent 里调用 TokenBoss 操作。v1.0 是单仓 monorepo；v2 路线图会加 Agent Skills / MCP 层。

> **方法论入口：** 所有需求开发遵循根目录的 [`WORKFLOW.md`](./WORKFLOW.md) — 9-stage 流程从 GitHub Issue 到 archive + 飞轮。本文档只讲项目约定，不重复工作流细节。

## Scope

**In scope（本仓）：**
- Frontend (`frontend/`) — React 18 + Vite + Tailwind 3.4
- Backend (`backend/`) — Node 20+ + TypeScript，部署 **Zeabur**（`backend/Dockerfile` + `backend/zbpack.json`）；`backend/template.yaml` 是历史 AWS SAM 配置，当前不用
- ClawRouter (`ClawRouter/`) — 独立 npm package `@blockrun/clawrouter`（wallet auth + x402 micropayments + 55+ LLM 路由）
- Spec & plan docs (`openspec/`) — per-REQ changes + 长期 capability specs
- 方法论 (`WORKFLOW.md`)

**Out of scope：**
- 历史 spec/plan（pre-2026-05-13）→ `docs/legacy/superpowers/` 只读归档，新工作流走 `openspec/`
- API reference 文档（生成的）→ 跟代码一起，不进 `openspec/`
- 生成的产物（`dist/` · `node_modules/`）→ gitignore

## Stream 速查

| Stream | 范围 | 关键文件 / 入口 |
|---|---|---|
| Frontend | `frontend/src/` | `tailwind.config.js`, `vite.config.ts`, `package.json` |
| Backend | `backend/src/` | `tsconfig.json`，`vitest.config.ts`，`Dockerfile` + `zbpack.json`（Zeabur），本地 dev: `npm run dev` |
| ClawRouter | `ClawRouter/` | **`ClawRouter/CLAUDE.md`**（独立约定，干 router 工作时先读它）+ `ClawRouter/CONTRIBUTING.md` |

> ⚠️ **ClawRouter 是子项目**：有独立 CLAUDE.md / CHANGELOG / LICENSE / VERSION。修改 ClawRouter 代码时遵循 `ClawRouter/CLAUDE.md`，**不要让顶层规则覆盖它**。

## 任务源 · GitHub Issues

| 系统 | 用途 |
|---|---|
| GitHub Issues（本仓） | 任务源；issue number `#N` 当任务 ID，`<slug>` 用 `gh-<N>-<kebab-case>` |
| `gh issue` CLI | `gh issue list` 看在飞 · `gh issue view <N>` 看单条 · `gh issue create` 新建 |
| Issue ↔ spec 双向链 | PR description 写 `Closes #N`（merge 自动关 issue）· spec 的 `proposal.md` front matter 写 `issues: [#N]` · merge 后 `gh issue comment <N> --body "Implemented in <PR>. Spec at <archive-path>"` 留 audit |

## 分支与提交

- 默认分支：`main`
- Feature 分支：`feature/<slug>` · `fix/<slug>` · `chore/<slug>` · `docs/<slug>`
- Commit message：Conventional Commits（`feat:` / `fix:` / `docs:` / `refactor:` / `chore:`）
- 中文 + 混英文技术术语 OK
- **用户本地 review 后才推 — 永远不要 auto-push**
- 不强制 dev 集成分支（小团队，feature/<slug> 直接 PR 到 main）

## 部署

| Stream | 主路径 | 备选 |
|---|---|---|
| Frontend | **Zeabur**（`frontend/zbpack.json` + nginx Dockerfile） | — |
| Backend | **Zeabur**（`backend/zbpack.json` + `backend/Dockerfile`） | — |
| ClawRouter | **npm publish**（独立 package） | — |

> `backend/template.yaml` + `npm run deploy` (sam build) 是历史 AWS SAM 配置，**当前未启用**。要么后续清理掉，要么留作未来 AWS 部署的备份。

> `frontend/vercel.json` 是历史遗留，不是当前部署路径。

## 工作风格约定

1. **iterate-don't-rebuild** — 实现前先读现有代码；改造现有组件而非新建；共享组件先改源再批量应用，不另起炉灶
2. **less is more** — 给人类用户看的 UI 越少越好；给 agent 看的响应最小化但 reason-able；丰富功能堆到 v2 Skills 层，不塞 v1.0 UI
3. **参考不是抄袭** — 用户给参考时提取原则，不直接抄结构；项目已有结构是验证过的资产
4. **AI Agent 用户视角** — REQ brainstorming 必须明确面向 human web UI / agent API/SDK / both（影响 Stage 2.5 mock 形态）

## For Claude Code Sessions

session 进入 TokenBoss 后：

1. **先看 `WORKFLOW.md`** — 这是 ground truth 工作流；本文档只是项目约定补充
2. **检查 `openspec/changes/`** — 有相关 REQ 草稿吗？没有再开 brainstorming
3. **brainstorming / writing-plans skills** 产物写到 `openspec/changes/gh-NN-<slug>/`，**不要**写到 `docs/legacy/superpowers/`（那是历史归档）
4. **改 spec 时**遵循 spec drift 反向通道：实施期间发现偏差先写到 `design.md` ## Spec Drift，Stage 6 archive 时再回写到 `openspec/specs/<cap>/spec.md`
5. **完成后 `/opsx:archive`**：archive change folder + 同步 delta spec 到 capability spec
6. **ClawRouter 工作**：先读 `ClawRouter/CLAUDE.md`，那是 router 自己的契约
