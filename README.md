# TokenBoss / OpenClaw 中转站

面向非编程用户的 AI API 中转站。一键安装到 OpenClaw 等 Agent 工具，RMB 计费，智能路由省 token。

## 子项目

| 目录 | 作用 | 技术栈 |
|---|---|---|
| [`ClawRouter/`](./ClawRouter) | 本地代理 / 智能路由（fork 自 @blockrun/clawrouter，待改造上游为自有后端） | TypeScript, Node 20, tsup |
| [`backend/`](./backend) | 中转站后端：用户/订阅/计费/代理 | AWS SAM + Lambda (Node 20) + API Gateway HTTP API + DynamoDB |
| [`frontend/`](./frontend) | 用户 Dashboard + Admin 面板 | Vite + React 18 + TypeScript + Tailwind CSS |

## 在线设计文档

<https://tokenboss-preview.vercel.app/> — 内部设计稿（SPEC / CEO PLAN / ARCH / TODOS / TEST）

## 架构决定（2026-04-09）

覆盖原 `/arch.html` 的 Next.js + Vercel + Postgres + one-api 方案，改为 AWS 无服务架构以追求"最轻量"：

- **Compute**：AWS Lambda (Node.js 20, arm64)
- **API**：API Gateway HTTP API（比 REST API 便宜 70%）
- **DB**：DynamoDB 单表（PK/SK + GSI1），PAY_PER_REQUEST，TTL 自动清理过期 pairing 码/预留
- **Auth 边界**：用户看到的唯一凭据是 `tb_live_xxx` 代理 key；上游 Anthropic/OpenAI key 只存在于 Lambda 环境变量
- **前端**：静态站点，部署到 S3 + CloudFront 或 Vercel，完全前后端分离
- **多区**：MVP 单区（建议 `ap-east-1` 香港），HK↔US 隧道和 `one-api` 独立部署的复杂度全部推到 Phase 1.5

## 快速开始

```bash
# 后端
cd backend
npm install
npm run build
npm run local          # sam local start-api → http://localhost:3000

# 前端
cd frontend
npm install
npm run dev            # http://localhost:5173
```
