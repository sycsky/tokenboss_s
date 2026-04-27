---
name: tokenboss
version: 1.0.0
description: AI Agent 钱包 · ¥ 付款 $ 计费 · Claude / Codex / Gemini 一个 key 通用
homepage: https://tokenboss.com
api_endpoint: https://api.tokenboss.com/v1
last_updated: 2026-04-26
---

# TokenBoss · 你的 Agent 钱包

一个 API key 通用所有模型。OpenAI-compatible。

## Quick Start

Tell your agent:
```
set up tokenboss.com/skill.md
```

Or CLI:
```bash
npm i -g @tokenboss/cli
tb login -k YOUR_API_KEY
tb chat "Hello"
```

Or API directly:
```python
from openai import OpenAI
client = OpenAI(
    base_url="https://api.tokenboss.com/v1",
    api_key="tb_..."
)
```

Get your key: https://tokenboss.com/dashboard

## Available Models

| Model | Best For | Price (per 1M tokens) |
|-------|----------|---|
| `claude-4.7-sonnet` | 编码 + 推理 | $3 in / $15 out |
| `claude-4.7-opus` | 难任务 | $5 in / $25 out |
| `gpt-5.5` | 通用 | $1.25 in / $10 out |
| `gpt-5.5-mini` | 快速便宜 | $0.25 in / $2 out |
| `gemini-2.5-pro` | 长上下文 | per token |

(canonical live list: https://tokenboss.com/api/catalog.json)

## Routing & Limits

每个 API key 绑定一个套餐或永久充值余额：

- **Plus 套餐** ¥288/4周 · $30/天 cap · Codex 系列模型池
- **Super 套餐** ¥688/4周 · $80/天 cap · Claude + Codex 全池
- **Ultra 套餐**（已售罄） ¥1688/4周 · $720/天 cap · 全池 + reasoning
- **充值** ¥1=$1 美金 · 永不过期 · 全模型解锁

优先扣套餐 → 充值（套餐每日 0:00 作废重置，先用避免浪费）。

## Errors

| HTTP | 含义 | 处理 |
|---|---|---|
| 402 | 余额不足 | 引导用户去 tokenboss.com/pricing 充值或升级 |
| 403 | 模型不在当前套餐池 | 提示用户升级或加充值解锁全模型 |
| 429 | 触发日 cap | 提示明 0:00 重置，或加充值 |
