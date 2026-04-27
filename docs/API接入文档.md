# TokenBoss API 接入文档

> 不通过 OpenClaw 路由插件，把 TokenBoss 当成 OpenAI 兼容网关使用的方式。
> 适用于：自己的脚本、已有的 OpenAI SDK 项目、各类 ChatBot 工具、IDE 插件等。

---

## 1. 你需要准备的两样东西

| 项目 | 值 |
| --- | --- |
| **Base URL** | `https://www.tokenboss.co` |
| **API Key** | 形如 `sk-xxxxxxxxxxxxxxxxxxxx` |

填到工具配置时，多数客户端会要求 Base URL 写到 `/v1` 那一层，请填：

```
https://www.tokenboss.co/v1
```

---

## 2. 怎么获取 API Key

1. 打开 https://www.tokenboss.co ，注册并登录
2. 进入 **「API 密钥」** 页面
3. 点 **「新建密钥」**，给它起个名字（例如 `我的Mac` / `Cursor`）
4. 系统会弹出完整的 `sk-xxxx...`，**点复制按钮立即保存到密码管理器**

> ⚠️ **明文密钥只会显示这一次。** 关闭弹窗后，列表里只能看到掩码（`sk-xxxx****xxxx`），找不回完整 key。如果丢了，删掉旧的、新建一个就行。

---

## 3. 支持的接口

TokenBoss 对外暴露 **OpenAI 兼容协议**，端点固定如下：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/v1/chat/completions` | 聊天 / 续写（支持 `stream: true` 流式 SSE） |
| `GET`  | `/v1/models`           | 当前可用模型列表 |

> 目前**不支持** Anthropic 原生协议（`/v1/messages`）。如果你用的工具只支持 Anthropic 原生格式，请使用 OpenClaw 路由插件方式接入。

---

## 4. 配置示例

### 4.1 OpenAI 官方 Python SDK

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-你的TokenBoss密钥",
    base_url="https://www.tokenboss.co/v1",
)

resp = client.chat.completions.create(
    model="claude-sonnet-4-5",
    messages=[
        {"role": "user", "content": "你好，介绍一下你自己"},
    ],
)
print(resp.choices[0].message.content)
```

### 4.2 OpenAI 官方 Node SDK

```js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "sk-你的TokenBoss密钥",
  baseURL: "https://www.tokenboss.co/v1",
});

const resp = await client.chat.completions.create({
  model: "claude-sonnet-4-5",
  messages: [{ role: "user", content: "你好" }],
});
console.log(resp.choices[0].message.content);
```

### 4.3 curl（直接调用，调试用）

```bash
curl https://www.tokenboss.co/v1/chat/completions \
  -H "Authorization: Bearer sk-你的TokenBoss密钥" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-5",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": true
  }'
```

### 4.4 环境变量方式（适用于很多工具）

很多工具直接读 `OPENAI_API_KEY` 和 `OPENAI_BASE_URL`，例如：

```bash
# Linux / macOS
export OPENAI_API_KEY="sk-你的TokenBoss密钥"
export OPENAI_BASE_URL="https://www.tokenboss.co/v1"

# Windows PowerShell
$env:OPENAI_API_KEY = "sk-你的TokenBoss密钥"
$env:OPENAI_BASE_URL = "https://www.tokenboss.co/v1"
```

---

## 5. 常见客户端配置指引

| 工具 | API Type / 协议 | Base URL | API Key |
| --- | --- | --- | --- |
| **Cursor**          | OpenAI                    | `https://www.tokenboss.co/v1` | `sk-...` |
| **Cherry Studio**   | OpenAI                    | `https://www.tokenboss.co/v1` | `sk-...` |
| **Chatbox**         | OpenAI API Compatible     | `https://www.tokenboss.co/v1` | `sk-...` |
| **NextChat**        | OpenAI                    | `https://www.tokenboss.co`    | `sk-...` |
| **LobeChat**        | OpenAI                    | `https://www.tokenboss.co/v1` | `sk-...` |
| **OpenWebUI**       | OpenAI API                | `https://www.tokenboss.co/v1` | `sk-...` |
| **Dify / FastGPT**  | OpenAI 自定义模型供应商     | `https://www.tokenboss.co/v1` | `sk-...` |

> 不同工具对 Base URL 是否带 `/v1` 处理不同：
> - 多数工具要求带 `/v1`（推荐先这样配）
> - 个别工具会自动拼 `/v1`，如果出现 `/v1/v1/chat/completions` 这样的 404，就把 Base URL 去掉 `/v1`

---

## 6. 模型名 (`model` 字段) 怎么填

可以填两类值：

### 6.1 具体模型名（直连指定模型）

例如：

- `claude-sonnet-4-5`
- `claude-opus-4`
- `gpt-5`
- `gpt-4o`
- `gemini-2.5-pro`
- `deepseek-v3`

完整可用列表请通过 `GET /v1/models` 获取，或在 dashboard 的「可用模型」页查看。

### 6.2 智能档位（让 TokenBoss 自动选模型）

| 档位 | 说明 |
| --- | --- |
| `auto`     | 自动按任务类型挑选最合适的模型 |
| `eco`      | 优先省 Token 的便宜模型 |
| `premium`  | 优先效果最好的旗舰模型 |
| `agentic`  | 优先适合 agent / 工具调用场景的模型 |

档位会自带 fallback，遇到上游异常会自动切换备用模型，不需要客户端做重试。

---

## 7. 计费与额度

- 计费按订阅套餐内的额度扣减，不按单次调用收费
- 余额 / 用量 / 倒计时在 dashboard **「用量」** 页可见
- 余额耗尽时请求会返回 `402 Payment Required`，前往 **「充值」** 页续费即可恢复

---

## 8. 错误码速查

| HTTP | 含义 | 处理建议 |
| --- | --- | --- |
| `401` | 密钥无效 / 已删除 | 检查 `Authorization` 头是否带了 `Bearer ` 前缀，或重新生成密钥 |
| `402` | 套餐余额不足          | 在 dashboard 充值 / 续费 |
| `404` | 路径错误             | 检查 Base URL 是否多写或漏写了 `/v1` |
| `429` | 触发限流             | 退避重试，或减少并发 |
| `5xx` | 上游临时故障          | 已自动 fallback；如持续出现请到 dashboard 反馈 |

---

## 9. 安全建议

- **不要把 `sk-xxx` 提交到 Git**，加进 `.gitignore` 或用 `.env` 管理
- 给不同设备 / 不同项目分别建独立密钥，方便单独吊销
- 怀疑泄露立刻在 dashboard 删除该密钥，不影响其他密钥

---

## 10. 还有问题？

- 完整文档：https://www.tokenboss.co/docs
- 工单 / 反馈：dashboard 右下角「联系客服」
