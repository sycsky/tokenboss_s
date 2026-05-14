# Router 插件开发流程（`@tokenboss/router`）

## 环境准备（首次）

```bash
cd D:/openclaw/ClawRouter
npm install          # 安装开发依赖（tsup、vitest 等）
```

本地测试需要一个后端。最简单的方式是直接指向线上后端：

```bash
# 创建 .env.local（不会被提交）
echo 'TOKENBOSS_API_URL=https://api.tokenboss.co' > .env.local
echo 'TOKENBOSS_API_KEY=你的sk-xxx' >> .env.local
```

---

## 开发调试

```bash
npm run dev          # tsup watch 模式，改代码自动重编译
```

另开一个终端，以独立 CLI 模式跑代理（不依赖 openclaw）：

```bash
TOKENBOSS_API_URL=https://api.tokenboss.co \
TOKENBOSS_API_KEY=sk-xxx \
node dist/cli.js start --port 8402
```

然后用 curl 直接打代理测试：

```bash
curl http://localhost:8402/v1/models

curl http://localhost:8402/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-xxx" \
  -d '{"model":"blockrun/auto","messages":[{"role":"user","content":"hi"}]}'
```

---

## 核心文件速查

| 文件 | 作用 |
|---|---|
| `src/proxy.ts` | HTTP 服务器主体，请求进来在这里处理 |
| `src/router/` | 模型选择算法（纯本地，不发网络请求） |
| `src/router/config.ts` | 默认 tiers 配置（fallback，正常运行时被远程配置覆盖） |
| `src/router/remote-tiers.ts` | 从后端 `/v1/router/tiers` 拉配置，每 10 分钟刷新 |
| `src/models.ts` | 所有已知模型列表、别名映射 |
| `src/model-cache.ts` | 从后端 `/v1/models` 拉模型列表，缓存 30 分钟 |
| `src/tokenboss.ts` | 向后端转发时注入 `Authorization: Bearer` |
| `src/index.ts` | openclaw 插件入口（注册命令、启动代理） |
| `src/cli.ts` | 独立 CLI 入口（`tokenboss-router start`） |
| `src/exclude-models.ts` | 用户排除模型列表，存在 `~/.openclaw/blockrun/exclude-models.json` |
| `src/session.ts` | 会话内模型锁定（防止同一对话中途换模型） |
| `src/response-cache.ts` | 相同请求去重缓存 |

---

## 改完之后

```bash
npm run typecheck    # 先过类型检查
npm test             # 跑 vitest（336 个测试）
npm run build        # tsup 打包，所有依赖内联进 dist/
```

---

## 发布到 NPM

```bash
npm version patch    # 自动把版本号 +1（例如 0.12.138 → 0.12.139）
npm publish --access public
```

首次发布需要先 `npm login`（npmjs.com 账号）。

发布后用户重新运行安装脚本即可拿到新版本，不需要做任何其他操作。

---

## 推送到 GitHub

```bash
cd D:/openclaw
git add ClawRouter/
git commit -m "描述改了什么"
git push
```

---

## 常见改动场景

**改路由逻辑**（模型选择策略）
→ 改 `src/router/` 下的文件，需发布新版本 NPM

**加新模型**
→ 改 `src/models.ts` 的模型列表，同时更新 `backend/config/router-tiers.json`，需发布新版本 NPM

**改 Tier 配置**（哪种复杂度用哪个模型）
→ 只改 `backend/config/router-tiers.json`，push 后插件 10 分钟内自动生效，**不需要发布新版本 NPM**

**改安装脚本**
→ 改 `backend/public/install/install.ps1`，push 后 Zeabur 重新部署即生效，**不需要发布新版本 NPM**

**改 openclaw 插件命令**（斜线命令）
→ 改 `src/index.ts` 里的 commands 数组，需要发布新版本 NPM

---

## 架构说明

```
openclaw → 本地代理 :8402 → TokenBoss 后端 → newapi → 真实 LLM
```

### 关键环境变量（用户机器上）

| 变量名 | 说明 |
|---|---|
| `TOKENBOSS_API_URL` | TokenBoss 后端地址，如 `https://api.tokenboss.co` |
| `TOKENBOSS_API_KEY` | 用户的代理 key（`tb_live_xxx`），由后端 dashboard 生成 |
| `TOKENBOSS_PROXY_PORT` | 本地代理端口，默认 8402 |

这三个变量由安装脚本自动写入用户系统环境变量，用户无需手动设置。

### 路由模式

用户在 openclaw 里通过设置模型名切换：

| 模型名 | 路由行为 |
|---|---|
| `blockrun/auto` | 按请求复杂度自动选 tiers |
| `blockrun/eco` | 优先选便宜模型（ecoTiers） |
| `blockrun/premium` | 优先选高质量模型（premiumTiers） |
| `blockrun/agentic` | 工具调用场景（agenticTiers） |

路由配置来自后端 `backend/config/router-tiers.json`，插件启动时拉取，每 10 分钟刷新一次。

### 打包说明

tsup 配置了 `noExternal: [/.*/]`，所有依赖都打包进 `dist/index.js` 和 `dist/cli.js`，`package.json` 的 `dependencies` 字段为空。发布后的包约 2MB，用户安装时无需 `npm install`。
