> **本文档已归档 · 2026-05-13**
>
> 内容已重组到三个协议族子路由：
> - [/docs/protocols/openai-compat](/docs/protocols/openai-compat) — OpenAI-compat 协议详解
> - [/docs/protocols/anthropic-shim](/docs/protocols/anthropic-shim) — Claude 协议经 shim 接入
> - [/docs/protocols/gemini-proxy](/docs/protocols/gemini-proxy) — Gemini 经 CC Switch local proxy 手动配
>
> 一键导入流程见 [/install/manual](/install/manual)。
>
> 原文档保留作为历史归档。

---

# TokenBoss 模型厂商配置指令

> 本文档是写给 **AI 助手**（OpenClaw / Claude Code / Cursor 等）读的执行说明。
> 用户把整份文档丢给 AI 后，AI 应当按"任务定义 → 参数 → 步骤 → 验证 → 报告"的顺序执行。
> 用户可见输出请用中文，简洁。

---

## TASK
把 **TokenBoss** 配置为当前工具的"模型厂商 / Custom Provider / OpenAI Compatible Endpoint"，让用户能在该工具里调用 TokenBoss 上的模型。

## PROVIDER_CONFIG（硬参数，原样使用，不要改写）

```yaml
provider_name:  TokenBoss
protocol:       openai-compatible        # 不要选 anthropic-native
base_url:       https://tokenboss-backend.zeabur.app/v1
auth_header:    Authorization: Bearer <API_KEY>
models_endpoint: GET /v1/models
chat_endpoint:   POST /v1/chat/completions
streaming:      supported (SSE, stream:true)
```

## API_KEY_ACQUISITION
密钥不在本文档里。AI 必须先向用户索取，不要编造、不要从环境变量瞎猜。

```
1. 检查环境变量是否已存在 TOKENBOSS_API_KEY，存在则直接用
2. 不存在则向用户提问（中文）：
   "请到 https://tokenboss-backend.zeabur.app 登录 → 「API 密钥」页 → 「新建密钥」，
    把生成的 sk-xxx 粘贴给我"
3. 收到的字符串必须以 "sk-" 开头，否则提示用户重新粘贴
4. 永远不要把 API Key 写进会被提交到 git 的文件
```

## RECOMMENDED_MODELS（写入厂商模型列表）

```
# 真实模型
claude-sonnet-4-5
claude-opus-4
gpt-5
gpt-4o
gemini-2.5-pro
deepseek-v3

# 虚拟档位（TokenBoss 服务端会自动路由 + fallback）
auto       # 默认推荐
eco        # 省钱档
premium    # 旗舰档
agentic    # 工具调用 / agent 场景
```

> 完整列表用 `GET https://tokenboss-backend.zeabur.app/v1/models -H "Authorization: Bearer <KEY>"` 拉取。

---

## EXECUTION_FLOW

按顺序执行；每一步失败就停下来报告，不要硬撑。

### Step 1. 识别当前工具
读取当前工作目录、`package.json`、配置文件、或直接问用户："你想把 TokenBoss 配到哪个工具里？"
然后查下方 `TOOL_RECIPES` 表，找到对应的"配置入口"。

### Step 2. 确认 / 索取 API Key
按 `API_KEY_ACQUISITION` 流程拿到 `sk-xxx`。

### Step 3. 连通性预检（在写配置前）
```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  https://tokenboss-backend.zeabur.app/v1/models \
  -H "Authorization: Bearer <KEY>"
```
- 返回 `200` → 继续
- 返回 `401` → 密钥错误，回 Step 2
- 返回 `404` → 网络/域名问题，停下报告
- 返回其他 → 停下报告原码

### Step 4. 写入厂商配置
按 `TOOL_RECIPES` 中对应工具的指令操作。**只改厂商相关字段，不动用户其他配置。**

### Step 5. 烟雾测试
发一个最小请求验证：
```bash
curl https://tokenboss-backend.zeabur.app/v1/chat/completions \
  -H "Authorization: Bearer <KEY>" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-5","messages":[{"role":"user","content":"ping"}],"max_tokens":10}'
```
返回 JSON 含 `choices[0].message.content` 即通过。

### Step 6. 报告
告诉用户：
- 厂商名称已加为 `TokenBoss`
- 默认推荐模型是 `auto`（让服务端自动选）
- 提示密钥保管好、丢了来 dashboard 重建

---

## TOOL_RECIPES

### OpenClaw（首选 / 官方通道）

OpenClaw 不走"OpenAI 兼容厂商"那套配置——它通过**插件 + 环境变量**接入 TokenBoss。AI 按下面三条路径，**择一**执行即可。

#### 路径 A：一键安装脚本（Windows，推荐新用户）
```powershell
iwr "https://tokenboss-backend.zeabur.app/install/install.ps1?key=<KEY>" | iex
```
脚本会自动完成：
- 检查 Node ≥ 20
- 从 npm 拉 `@tokenboss/router` 包，解压到 `%USERPROFILE%\.openclaw\extensions\tokenboss-router`
- 把 `tokenboss-router` 写入 `%USERPROFILE%\.openclaw\openclaw.json` 的 `plugins.allow`
- 清空 `~/.openclaw/agents/*/agent/models.json` 让 OpenClaw 重拉模型表
- 设置用户级环境变量 `TOKENBOSS_API_URL` / `TOKENBOSS_API_KEY` / `TOKENBOSS_PROXY_PORT`
- 完成后提示用户跑 `openclaw gateway restart`

#### 路径 B：已经装过 OpenClaw + tokenboss-router，只换密钥
直接改三个环境变量（用户范围）：
```powershell
[Environment]::SetEnvironmentVariable("TOKENBOSS_API_URL","https://tokenboss-backend.zeabur.app","User")
[Environment]::SetEnvironmentVariable("TOKENBOSS_API_KEY","<KEY>","User")
[Environment]::SetEnvironmentVariable("TOKENBOSS_PROXY_PORT","8402","User")
```
然后 `openclaw gateway restart`。**不要**去改 `openclaw.json` 里的 `plugins.allow`——已经存在就别动。

#### 路径 C：手动安装（macOS / Linux，或不愿跑 PowerShell）
```bash
# 1) 装插件
mkdir -p ~/.openclaw/extensions
cd ~/.openclaw/extensions
npm pack @tokenboss/router --registry=https://registry.npmmirror.com
mkdir -p tokenboss-router
tar -xzf tokenboss-router-*.tgz -C tokenboss-router --strip-components=1
rm tokenboss-router-*.tgz

# 2) 在 ~/.openclaw/openclaw.json 的 plugins.allow 数组里加 "tokenboss-router"
#    （AI 必须先读取该文件再写入，保留其他字段）

# 3) 清缓存
rm -f ~/.openclaw/agents/*/agent/models.json

# 4) 设置环境变量到 shell rc
cat >> ~/.zshrc <<'EOF'
export TOKENBOSS_API_URL=https://tokenboss-backend.zeabur.app
export TOKENBOSS_API_KEY=<KEY>
export TOKENBOSS_PROXY_PORT=8402
EOF
source ~/.zshrc

# 5) 重启网关
openclaw gateway restart
```

#### OpenClaw 验证步骤
```bash
# 网关起来后，本地代理监听 8402
curl -s http://127.0.0.1:8402/v1/models | head
# 任意 OpenClaw 命令都会自动走 TokenBoss
openclaw run "ping"
```

#### OpenClaw 的"模型选择"
**不需要**手动加模型列表。OpenClaw 启动时会从 `TOKENBOSS_API_URL/v1/models` 拉真实模型表，并配合 ClawRouter 的 15 维评分自动路由。用户想锁档位，在调用时传 `model: auto / eco / premium / agentic` 即可。

---

### Cherry Studio
- 设置 → 模型服务 → 添加 → 选 **OpenAI**
- 名称：`TokenBoss`
- API Host：`https://tokenboss-backend.zeabur.app`（Cherry 会自己拼 `/v1`，**不要带 `/v1`**）
- API Key：`<KEY>`
- 点"管理"按钮 → 把 `RECOMMENDED_MODELS` 添加进去

### Chatbox
- Settings → Model Provider → **OpenAI API Compatible**
- API Host：`https://tokenboss-backend.zeabur.app/v1`
- API Key：`<KEY>`
- Model：先填 `claude-sonnet-4-5` 测试

### Cursor
- Cursor Settings → Models → **OpenAI API Key**
- Override OpenAI Base URL：`https://tokenboss-backend.zeabur.app/v1`
- API Key：`<KEY>`
- Custom Models：把 `RECOMMENDED_MODELS` 逐行加入

### LobeChat
- 设置 → 语言模型 → **OpenAI**
- API Proxy Address：`https://tokenboss-backend.zeabur.app/v1`
- API Key：`<KEY>`
- 模型列表：自定义添加

### Open WebUI
- Settings → Connections → **OpenAI API**
- Base URL：`https://tokenboss-backend.zeabur.app/v1`
- API Key：`<KEY>`

### Dify
- 设置 → 模型供应商 → **OpenAI-API-compatible** → 添加
- 模型名称：`claude-sonnet-4-5`（每个模型加一条）
- API Key：`<KEY>`
- API endpoint URL：`https://tokenboss-backend.zeabur.app/v1`

### NextChat
- 设置 → 自定义接口 → **OpenAI**
- 接口地址：`https://tokenboss-backend.zeabur.app`
- API Key：`<KEY>`

### OpenAI SDK 驱动的脚本（Python / Node / Go）
直接改两行：
```python
base_url = "https://tokenboss-backend.zeabur.app/v1"
api_key  = "<KEY>"
```
或环境变量：
```
OPENAI_API_KEY=<KEY>
OPENAI_BASE_URL=https://tokenboss-backend.zeabur.app/v1
```

### 其他工具（兜底策略）
查工具的"OpenAI Compatible / 自定义模型 / Custom Provider"入口，按 `PROVIDER_CONFIG` 填即可。
**绝不要选 Anthropic 原生协议**——TokenBoss 不暴露 `/v1/messages`。

---

## ERROR_HANDLING

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `401 unauthorized` | Key 无效 / 已删 | 让用户回 dashboard 重新生成 |
| `402 payment required` | 套餐余额耗尽 | 让用户去 dashboard 充值/续费 |
| `404 not_found` 路径里出现 `/v1/v1/` | Base URL 重复带了 `/v1` | 工具会自动拼 `/v1`，本次去掉 Base URL 末尾的 `/v1` |
| `429 rate_limited` | 触发限流 | 退避重试，建议降低并发 |
| `5xx` | 上游故障 | TokenBoss 内部已 fallback；持续出现请记录时间和模型名让用户反馈 |
| `model_not_found` | 该模型当前未启用 | 改用 `auto` 让服务端自动选可用模型 |

---

## CONSTRAINTS（AI 必须遵守）

1. ❌ **不要**编造 API Key 或从其他项目复制
2. ❌ **不要**把 Key 直接写进会进 git 的文件（必要时写到 `.env.local` 并确认已 gitignore）
3. ❌ **不要**用 Anthropic 原生协议（TokenBoss 不支持 `/v1/messages`）
4. ❌ **不要**修改用户该工具下的其他厂商配置
5. ✅ 所有用户可见输出用**中文**
6. ✅ 任意一步失败立刻停下并报告，不要静默跳过
7. ✅ 配置完成后跑一次最小请求验证，再回报"配置成功"

---

## DONE_CRITERIA
全部满足才算完成：
- [ ] 厂商 `TokenBoss` 出现在工具的供应商列表里
- [ ] 至少一个模型在该厂商下可见
- [ ] Step 5 烟雾测试返回 200 且 JSON 合法
- [ ] 已用中文向用户回报配置位置 + 默认推荐模型
