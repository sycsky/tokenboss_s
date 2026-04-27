# TokenBoss v1.0 UX 重设计 · 7 棒金线

**Date:** 2026-04-26
**Status:** Approved, pending implementation
**Topic:** TokenBoss 网站 v1.0 完整 UX 重设计 —— 7 个面（landing / auth / onboarding / 控制台 / pricing / 使用历史 / 账户）+ 1 个 Agent 接入文件（skill.md）。

## Context

继 [credits-economy 经济模型 spec](./2026-04-25-credits-economy-design.md) 和 [v1 features scope spec](./2026-04-25-v1-features-scope-design.md) 之后，本 spec 锁定**用户面具体设计**——每个页面的信息架构、视觉语言、文案语气、关键交互。基于 4-5 天 brainstorming 迭代收敛而成（visual companion 同步：landing v0→v10、onboarding v0→v8、pricing v0→v8、history v0→v1.2、settings v0→v1、控制台 v0→v1、manual-config-pc v0→v3）。

## 三大原则

### 1. Less is more

每个 UI 元素都要"挣得"展示资格；默认怀疑式删除。已被砍掉的活例子：

- Settings: 头像 / 显示名 / 最常用模型
- Pricing tier 卡: 智能路由 / 多端复用 / 含 Sonnet/Opus / 优先排队 / 高峰不降级 / 专属客服 / SLA（→ hover "i" tooltip）
- Pricing 顶导: 使用历史 / API Key（→ 收纳进控制台子区）
- History: CSV 导出 / 用量(tokens)列 / 搜索框 / 今天-昨天分组行
- Landing v10: 已支持工具区（与 compat row 重复）/ 3 步上手段 / 杠杆卡 / "无需信用卡"销售 meta

### 2. 参考 ≠ 抄袭

竞品参考（codesome.ai, skillboss.co, UniVibe, Hermes pricing, DragonCode, aigocode）拿来提取**设计原则**（克制 / 留白 / 编辑感 / 信息架构），不是结构模板。已验证过的 TokenBoss 自有结构（3 张 tier 卡、控制台收纳所有账号事、editorial 01/02 小节）保持不变。

### 3. 目标用户 = AI Agent 用户

OpenClaw / Hermes 主推；Claude Code / Codex 兼容；Cursor / Windsurf 等纯 IDE 编程工具**明确不放**。所有 compat 文案 / install 指引 / skill.md 模板都对齐这条。

## 视觉系统

### Design tokens
- **配色**：cream `#F7F3EE` 主背 + coral orange `#E8692A` 主色 + ink `#1C1917` 主字 + green/red 状态色
- **字体**：
  - DM Sans（无衬线，西文 + 数字）
  - Geist Mono（等宽，价格 / 时间戳 / 数据）
  - Noto Sans SC（中文，含 800 weight 给 hero）
  - Noto Serif SC（仅用于 italic 数字，编辑感）
- **圆角**：8-14px 卡片，6-8px 按钮，999px pill
- **阴影**：极克制（仅手机 mock shadow + featured tier border-emphasis）

### 编辑式语法
- 小节用编号双语标记 `01 / 标准价 / Pay as you go`（italic Noto Serif SC 数字 + 中文 label + UPPERCASE EN mono）
- ghost 字效果 = `color: var(--ink-3); opacity: 0.32`（hero 关键词淡化对比）
- 1px ink 横线作为 hero rule（小节起手势）
- 数据用 hairline 分割（无圆角无阴影 list-row）

## 7 棒金线设计

### 棒 1 · Landing (v10)

**结构（移动端）：**
```
[App nav: TB · 登录]
        ↓
[Compat row: 适配你喜欢的 Agent · OC CX HM CC]
        ↓
[H1: 你的 Agent 钱包]    （"钱包"用 accent 橙）
        ↓
[黑底终端块: $ set up tokenboss.com/skill.md · COPY]
[meta: 在 OpenClaw / Hermes / Claude Code 终端粘贴一行 · ¥ 付款 $ 计费]
        ↓
[CTA: 免费开始 · 送 $10 体验]
[已有账户？登录]
        ↓
[小节 "套餐" + 3 张 tile]: PLUS ¥288 / SUPER ¥688 / ULTRA ¥1688 SOLD
        ↓
[小节 "按量充值" + ¥50 → $50 永不过期]
        ↓
[Footer: 套餐 / 文档 / 条款 / 隐私 / 联系]
```

**桌面端**：相同信息架构 + 右侧 hero 留 [Brand Visual TBD] placeholder，nav 分组（左 logo + 内容 nav 套餐/文档；右 auth actions 登录 + 免费开始 →）。

**核心决策**：
- Hero "**你的 Agent 钱包**" —— TokenBoss 名字本来就该 own 的语义，比喻 vision-friendly（v2 Skills + 集成自然延展）
- 主视觉是黑底终端命令块（skillboss-style），不是 verbose 模型列表
- compat row 抬到 hero 之上（Agent 用户第一帧确认兼容自己工具）
- v2 nav 入口（Skills / 客户案例）**推迟到 v1.0+ launch 后**补，v1.0 不画饼

### 棒 2 · Auth (auth-v0)

**Register 页：**
- 邮箱输入 → 6 位验证码（无密码）
- "送 $10 / 24h 试用"礼物卡视觉
- Desktop 右侧 [Brand Visual TBD] placeholder

**Login 页：**
- "欢迎回来" hero
- 邮箱输入 → 6 位验证码 → 进控制台
- 6 位框 3-filled state 演示

**核心决策**：
- 完全移除现有 scrypt 密码逻辑
- v1.1 加 Google OAuth（free win）

### 棒 3 · Onboarding (onboarding-v0)

**4 屏（移动端竖屏切换）：**

**屏 1 - I am Agent / I am Human 选择**：
- 用户告诉系统当前是用 Agent 还是手动（影响后续路径）
- "I am Agent" → 一行咒语路径
- "I am Human" → 跳 manual-config-pc PC 引导

**屏 2 - 一行咒语**：
```
[黑底终端块: $ set up tokenboss.com/skill.md · COPY]
[meta: 在 OpenClaw / Hermes / Claude Code 粘贴]
[等待状态: 检测到 Agent 拉取 skill.md...]
```

**屏 3 - API key 一次显示**：
- 系统生成 key（仅显示一次）
- 警告 "此 key 仅显示一次，建议立即复制保存"
- 复制按钮

**屏 4 - 搞定庆祝**：
- "搞定" 简洁庆祝
- 2-row 激活卡（trial $10 / 24h 已激活）
- "回到 OpenClaw" + "看 控制台" 双 CTA

**核心决策**：
- ~~Pairing code TB-XXX 流程~~ 已废，被 skill.md 一行替代
- ~~⚡ Model footer~~ 不做（聊天回复无 hook 注入），改在控制台显示"最近调用"strip
- 简化结构：从原 5 屏 → 4 屏

### 棒 4 · 控制台 (dashboard-v1)

**移动端结构（一屏滚到底）：**
```
[App nav: TB · 套餐 pill · 头像]
        ↓
[$X.XX 余额 hero（橙色大卡）+ 充值 / 联系客服 双 CTA]
        ↓
[今日 cap 进度条: $5.43 / $30 · 18% bar · 明 0:00 重置]
        ↓
[黑底脉动 strip: 最近调用 9:41 · Sonnet 4.7 · −$0.027]
        ↓
[活跃额度池 list: Plus 套餐 / 充值余额 · 优先扣套餐 → 充值]
        ↓
[今日统计: 21 次 / $0.48]
        ↓
[接入中心卡: 已接入 OpenClaw 运行中 + 接入新 Agent 虚线橙底]
        ↓
[最近使用 4 行 + "查看全部 →"]
        ↓
[API Key 列表 + "+ 创建新 Key"]
```

**桌面端**：上面 balance hero 全宽 + 2/3 主区（buckets / 历史 5 行 table）+ 1/3 侧栏（接入中心 / 今日 / API Key）。顶导仅 [控制台][套餐]。

**核心决策**：
- "Dashboard" → "控制台"（更本地化，codesome 也用这个词）
- 使用历史 / API Key **收纳进控制台**作为内嵌区，不再单独占顶导（v2 加 Embeddings/TTS/Image API 也都收纳）
- "升级 Super" CTA → "**联系客服**"（v1.0 不做自助升级）

### 棒 5 · 套餐定价 (pricing-v8)

**结构：**
```
[Hero: 用 ¥ 付，按 $ 算 (heavy 800 + ghost "$")]
        ↓
[01 / 标准价 / Pay as you go (italic serif 编号)]
        ↓
[baseline 锚卡: ¥1 = $1 美金 · 充值 ¥50 起 · 永不过期 · 全模型]
        ↓
[02 / 套餐 / Membership]
        ↓
[3 张 tier 卡横排 (Plus / Super★ / Ultra 售罄)
 每张: ×N 橙 pill + ≈$X 美金额度副锚 + 仅 4 个关键数据
 (日 cap · 总额度 · 倍数 · 模型)
 + per-card CTA + "i" hover tooltip 露其余信息]
```

**核心决策**：
- ¥1=$1 baseline 抬到顶上当锚 → 套餐显倍数优惠才 visual
- tier 卡只留 4 个关键（×N · ≈$X · 日 cap · 模型），其他 8 条藏 hover tooltip
- CTA 按 auth state 分叉：访客→"免费注册试用"，登录用户→"联系客服开通"
- 访客视图 Ultra 不显示售罄（CTA = 注册试用）；登录后才显"名额已满"
- ×N pill 文案: 仅"×3 / ×4 / ×12"，不带"优惠"二字

### 棒 6 · 使用历史 (history-v1.2)

**结构：**
```
[Hero: 使用历史 + 当前余额 pill ($8.32)]
[统计行: 共 247 次 · $14.32 已用 · 4 月以来]
        ↓
[24h 消耗柱状图: 24 个橙色 bar · 峰值 22:00 用 accent-deep · y 轴 / legend]
        ↓
[筛选条 (无搜索): 日期 / 模型 / 来源 3 个 select + active chips]
        ↓
[表格: 时间 (完整 timestamp) / 类型 pill / 来源 / 模型 / $变化]
[消耗 = 橙 pill / 红字; 重置 = 绿 pill / 绿字; 作废 = 灰 pill / 灰字]
        ↓
[分页: 首页 / 上一页 / 1 2 3 ... / 下一页 / 末页]
```

**核心决策**：
- 24h 图表借鉴 UniVibe（让用户一眼看消耗节奏）
- 类型列 = 消耗 + 重置 + 作废 三态（每日 0:00 双事件正向反映）
- 删 CSV 导出 / 用量(tokens)列 / 搜索框 / 今天-昨天分组行（less is more）
- 完整 timestamp 替代日分组（参考 UniVibe）

### 棒 7 · 账户设置 (settings-v1)

**结构：**
```
[App nav: 控制台 ‹ · 账户 tag]
[H1: 账户]
        ↓
[01 / 账户 / Account]
[卡: 邮箱 / 套餐 / 注册时间 - 三行]
        ↓
[02 / 用量 / Usage]
[卡: 总消耗 $14.32 / 总调用 247 - 二格]
        ↓
[03 / 操作 / Actions]
[联系客服 + 退出登录 (red)]
```

**核心决策**：
- 极简：邮箱即身份，无头像 / 无显示名 / 无最常用模型
- 邮箱修改 → 联系客服（不做自助修改身份）
- 桌面 max-width 760px 居中（设置类页本来就该窄）

### 接入文档 (manual-config-pc)

**结构：** docs 风格（左侧栏 + 右内容区）
- 左 sidebar: Agent 列表（OpenClaw / Hermes / NanoClaw / Claude Agent SDK / OpenAI 兼容）
- 右内容: 默认推 `set up tokenboss.com/skill.md` 一行咒语；下方折叠的 4 步传统 fallback（克隆 → install → 配 key → 测试）

## skill.md 文件骨架（v1.0 主路径）

托管在 `tokenboss.com/skill.md`，Agent 拉远程 markdown 即注册到本地 skill 目录。

```yaml
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
\```
set up tokenboss.com/skill.md
\```

Or CLI:
\```bash
npm i -g @tokenboss/cli
tb login -k YOUR_API_KEY
tb chat "Hello"
\```

Or API directly:
\```python
from openai import OpenAI
client = OpenAI(
    base_url="https://api.tokenboss.com/v1",
    api_key="tb_..."
)
\```

Get your key: https://tokenboss.com/dashboard

## Available Models

| Model | Best For | Price (per 1M tokens) |
|-------|----------|---|
| `claude-4.7-sonnet` | 编码 + 推理 | $3 in / $15 out |
| `claude-4.7-opus` | 难任务 | $5 in / $25 out |
| `gpt-5.5` | 通用 | $1.25 in / $10 out |
| `gpt-5.5-mini` | 快速便宜 | $0.25 in / $2 out |
| `gemini-2.5-pro` | 长上下文 | per token |
| ... |

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
```

## Implementation order（建议）

1. **Backend**: bucket 表 + cron + auth 验证码 + chat proxy 模式锁
2. **Backend**: usage_log 加 event_type
3. **Frontend**: Landing + Auth（去密码）
4. **Frontend**: Onboarding 4 屏（一行咒语）
5. **Backend**: skill.md 静态 + /api/catalog.json
6. **Frontend**: 控制台（主屏 + 内嵌区）
7. **Frontend**: 套餐定价页 + 使用历史子页 + 账户设置 + manual-config-pc
8. **Backend**: chat proxy 双事件 cron 任务
9. **集成测试**：full E2E 用户流程

## Acceptance · v1.0 上线 checklist

详见 [v1-features-scope spec](./2026-04-25-v1-features-scope-design.md#acceptance--v10-上线-checklist)。

## Open questions

1. **skill.md 静态 vs 动态生成**：v1.0 静态最简；如果想给登录用户显示具体当前套餐 cap，需要动态。当前定 v1.0 静态。
2. **Super ×4 vs ×3 marketing 倍数**：实际 ¥688/$2,240 = 3.26x，pill 标 ×4 是 marketing 上调（×3 也对）。需要 PM 决定诚实精确还是 marketing 整数。
3. **skill.md 文件名 vs 路径**：`/skill.md` vs `/install.md` vs `/.well-known/tokenboss.md`。skillboss 用 `/skill.md`，简洁。沿用。
4. **桌面 landing 完整性**：当前桌面端只有 hero + placeholder（pricing/payg 在 mobile 才有）。需要补全 desktop landing 还是 click "套餐" 跳走？

## Non-goals (v1.0)

- ❌ Skills 市场 / Sell API marketplace（v2 路线锁定第一方 Skills + 第三方 SaaS 集成）
- ❌ Agent OEM / 预装合作（永久不做）
- ❌ ⚡ Model footer in chat reply（聊天 hook 不可注入）
- ❌ Pairing code TB-XXX 流程（被 skill.md 替代）
- ❌ 客户案例 / Skills nav 入口（v1.0+ launch 后补）
- ❌ Cursor / Windsurf 等 IDE 兼容
- ❌ 自助修改邮箱 / 删除账户（联系客服）
- ❌ Google OAuth（v1.1 加）
- ❌ 通知偏好 / 双因素 / 暗色主题（v1.1+）
