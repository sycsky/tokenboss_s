# Credits 经济模型 v1

**Date:** 2026-04-25 (revised 2026-04-26)
**Status:** Approved, pending implementation
**Topic:** TokenBoss v1 的付费 / 计价 / 扣费 / 套餐 / 试用 模型

**2026-04-26 修订**：Super 涨价 ¥588 → ¥688；周期单位 28 天 → 4 周（展示）；扣费优先级反转（套餐 → 充值）；日 cap 重置改 **作废 + 重置** 双事件；模型命名（GPT 池 → Codex 系列，全模型 → Claude + Codex）；top-up 5 档 ladder 删除（改纯 ¥1=$1 baseline）；onboarding 改 `set up tokenboss.com/skill.md` 一行咒语（替代 pairing code TB-XXX 流程）。

## Context

当前 TokenBoss 代码（基于 SQLite + newapi）的扣费模型停留在抽象的 "credits 单位"，没有清晰的 RMB→USD 杠杆叙事，套餐结构（basic/standard/pro 三档）跟原 SPEC v1 不一致，且不支持反薅羊毛 / 模式锁等关键机制。

本 spec 把面向用户的经济模型完全锁定，作为后续 Dashboard / Billing / 使用历史 / Onboarding / Agent 内 in-chat 文案 等所有用户面设计的根。

参考竞品：[aigocode.com](https://www.aigocode.com/)（套餐订阅 + 灵活额度双轨）、DragonCode（多 channel 分组 + 6 档月卡 + 折扣标号）、[v3.codesome.cn](https://v3.codesome.cn/)（按量 + 月卡）。我们的差异化定位：**$ 美金显示余额 + 日 cap 机制 + 模型池差异化**。

## Universal rule

**$ 美金显示，¥ 人民币结算。** Dashboard 和使用历史显 $ 美金；仅在支付页显 ¥ 人民币。

底层杠杆来自三个来源：
1. **Auto 路由智选便宜模型** —— 用户感知到 retail $ 价的调用能力，TokenBoss 实际向上游付远低于 retail 的批发价
2. **日 cap 当日作废** —— 大多数用户当日用不完，未用部分次日 0:00 作废 = 28 个 margin 收割机会
3. **模式锁** —— Plus 用户不能用 Claude，限制单次烧爆杠杆的可能

## Decisions

### 1. 计价单位

| 场景 | 单位 |
|---|---|
| Dashboard 余额 | `$` 美金 |
| 使用历史扣费 | `$` 美金（精度 4 位小数） |
| 支付页 | `¥` 人民币 |
| 套餐 / 充值数字 | 同时展示 `¥X 付` + `$X 到账` 对照 |

### 2. 套餐 SKU（v1 上线 2 档 + 1 档 "已售罄" 占位）

| SKU | 实付 | 日额度 | 4 周累计上限 | 模型池 | 状态 |
|---|---|---|---|---|---|
| **Plus** | `¥288 / 4 周` | `$30 / 天` | `≈ $840` | **Codex 系列**（GPT-5.5 / mini / Codex 等 OpenAI 模型） | ✅ v1 开放 |
| **Super** | `¥688 / 4 周` | `$80 / 天` | `≈ $2,240` | **Claude + Codex 系列**（含 Sonnet 4.7 / Opus 4.7） | ✅ v1 开放 |
| **Ultra** | `¥1688 / 4 周` | `$720 / 天` | `≈ $20,160` | Claude + Codex + reasoning（o1 / o3） | 🔒 显示已售罄 |

**杠杆比 ×N 视觉化**：套餐卡显橙色 `×N` pill —— Plus `×3` (2.92x), Super `×4` (3.26x, 取 marketing 整数), Ultra `×12` (11.95x)。"标准价"baseline ¥1=$1 抬到顶部当锚卡，套餐相对它显倍数优惠。访客视图（未登录）Ultra 也显"免费注册试用 →"先把人引进 /auth；登录视图才显示"名额已满"。

**关键差异化**：套餐区分**靠模型池**而不靠日 cap 数字。Plus = Codex（GPT 系列）；Super 起含 Claude；Ultra 含 reasoning。

**周期单位**：用户面统一显 **4 周**（更具象），后端实际仍按 28 天计。

### 3. 日 cap + 4 周周期 · 作废 + 重置 双事件

每日 0:00 触发**两个独立事件**（顺序：**作废 → 重置**）—— 显式分开记录，让用户看到"昨天没用完的部分作废了 + 今天 cap 重新满血"两件事。

| 事件 | 金额 | 触发条件 | 显示 |
|---|---|---|---|
| **作废** (`expire`) | `−daily_remaining_usd` | 仅在剩余 > 0 时记 | "昨日剩余作废 · 未用余额清零" 灰色 pill |
| **重置** (`reset`) | `+daily_cap_usd` | 永远固定 +$cap，无条件每日记 | "日 cap 重置 · Plus $30" 绿色 pill |

**三种实例**（Plus cap = $30）：
- 昨天用 $25.43，今天 0:00 → `+$30 重置` + `−$4.57 作废`（2 条记录）
- 昨天用满 $30，今天 0:00 → `+$30 重置`（仅 1 条，作废 = 0 不入账）
- 昨天没用，今天 0:00 → `+$30 重置` + `−$30 作废`（视觉对消，2 条都入账保审计）

**为什么分两条**：原方案是"净增量"单条记录（cap − 剩余），但用户看不出"昨天浪费了多少"。分开记账后审计清晰，每条事件都是确定性的。

- **4 周（28 天）** = 一个完整周期，付款日为 D0
- D27 23:59 周期结束，套餐 bucket 清零并失效
- "≈ $840 / $2,240 / $20,160" 是营销展示数字（= 日 cap × 28），不是真实可累积余额
- v1 不做更细的 rate limit / 并发限制（按上游 API 实际承载力决定，内部参数）

### 4. 一次性充值（pay-as-you-go）· ¥1 = $1 baseline

充值 = **标准价 baseline**，**¥1 = $1 美金额度**，**永不过期**，**全模型解锁**。

- 入门 ¥50（最小起充）
- 上不封顶，无 5 档预设 ladder
- 无 bonus 优惠（之前的 ¥9.9 / ¥29.9 / ¥58.8 / ¥98 / ¥288 5 档已废）

充值后**所有模式（Auto + Manual 全模型）都解锁**。Plus 套餐用户加买充值后可临时使用 Claude / Opus 等 Manual 模型。

**Pricing 页 baseline 对比**：充值 ¥1=$1（×1 baseline）vs Plus ¥288→$840（×3）vs Super ¥688→$2,240（×4）vs Ultra ¥1688→$20,160（×12）。订阅相对 baseline 的"几倍优惠"是营销主打。

**v1.0 阶段**：充值入口在 Dashboard 余额卡 + Pricing 页底部"按量充值 ¥50 起"。CTA 都走客服微信，等 v1.1 同事接虎皮椒后开放 self-checkout。

### 5. 试用

注册自动赠 `$10 美金额度 · 24 小时有效`。

**强制走 Auto 路由的 ECO 兜底档**（最便宜模型）。这一限制由路由层硬性强制，**用户面不显示**"ECO"字样 —— 用户只看到自己在用 Auto 模式。

24 小时不用完作废。试用账户尝试切到付费模型 → 路由层返回 in-chat 文本提示。

并发 / Rate limit 等内部限制延后定，不向用户解释。

### 6. 扣费模型

**Manual 单选模型**（仅 Super + Ultra + topup 用户可用）：按上游官方 $ 价扣（OpenAI / Anthropic / Google 等公开 token 单价）。涨跌跟随。新模型上架自动出现可选列表。

**Auto 路由模式**（所有用户共用一个用户面"Auto"）：基于 [ClawRouter](https://github.com/BlockRunAI/ClawRouter) 部署到云端 + 自定义模型表。系统按 prompt 复杂度自动选模型。对外标"省 ~X%"作为价值锚，X 来自 ClawRouter 已有 benchmark 数据反推。

不同 bucket 的 Auto 行为在路由层差异化（用户面统一显示 "Auto 模式"）：

- **Plus** 套餐：Auto 限制在便宜模型池（GPT-5 / mini / Codex / Haiku）
- **Super / Ultra** 套餐：Auto 全模型池可路由
- **Trial** 账户：Auto 强制走 ECO 兜底档（最便宜的几个），用户不感知 ECO 字样

**v1 不做**：多 channel 分组（DragonCode 那种"企业稳定/Kiro 逆向/反重力"）。单 channel 走 ClawRouter，复杂度推迟到 Phase 1.5。

### 7. 余额扣费优先级

用户既有套餐余额（日 cap，会过期）+ 一次性充值（永不过期）时：

```
1. 先扣 套餐当日额度    (24:00 作废 → 用不完就浪费，所以先用)
2. 后扣 一次性充值余额  (永不过期 → 备用)
```

**理由**（2026-04-26 修订）：套餐每日作废，先用 → 不浪费套餐 cap；充值永久，是备用 + 解锁全模型的工具。Plus 套餐用户加买充值能解锁 Claude，但只在套餐 cap 用完或选了非 Codex 模型时才动用充值。

**之前 v15 的反向优先级（先扣充值）已废**：那个逻辑会让套餐 cap 浪费率变高（用户感觉"我有充值就先用充值，套餐 cap 等等"），实际更违反用户直觉。

### 8. 使用历史 / 透明度

每次 API 调用在使用历史页显示：

| 字段 | 内容 |
|---|---|
| 时间 | 调用时间戳 (`2026/04/26 9:41` 完整 timestamp，无"今天/昨天"分组) |
| 类型 | **消耗** (橙) / **重置** (绿) / **作废** (灰) / **充值** (绿) / **退款** (灰) |
| 来源 | OpenClaw / Hermes / 等 Agent 标识 + logo |
| 模型 | `claude-sonnet-4` / `gpt-5.4-mini` / 等 |
| $ 变化 | `−$X.XXXX` (红) / `+$X.XX` (绿) / `−$X.XX` (灰，作废) |

页面顶部加 **24h 消耗柱状图**（峰值小时高亮 accent-deep）+ 当前余额 pill。**砍掉的**：搜索框 / CSV 导出 / 用量(tokens)列 / "今天/昨天"分组行（per less-is-more 原则 + 借鉴 UniVibe 信息架构）。

后端：SQLite `usage_log` 表已存在 → 加 `event_type` 字段（`consume` / `reset` / `expire` / `topup` / `refund`）。重置和作废不是 user-facing API 调用，由 cron 任务写入 log。

### 9. 套餐经济学（赚钱机制）

两个机制叠加：

| 机制 | 作用 | UX 摩擦 |
|---|---|---|
| **A · 日 cap 作废** | 每日 24:00 当日未用作废 → 28 个"用不完"机会归 TokenBoss | 几无 · 用户不察觉日浪费 |
| **B · 模式锁** | Plus 不能用 Claude → 防止单次烧爆杠杆 + 升级路径 | 仅 Plus 用户尝试 Manual Claude 时 JIT 提示 |

**v1 不做**：周限额（机制 C）。日 cap 已经是更细的回收机制；周限额会引入"等到周末才能用"的反直觉。

### 10. 支付

- v1 仅支付宝
- 移动端：H5 原生唤起
- PC 端：二维码 + 手机扫码完成
- 微信支付推迟 Phase 1.5

## Implementation hooks

### 后端数据模型

需要一个 `credit_bucket` 表，每条记录代表一笔购买（套餐 / 充值 / 试用）：

| 字段 | 说明 |
|---|---|
| `id` | uuid |
| `user_id` | 关联用户 |
| `sku_type` | `trial` / `topup` / `plan_plus` / `plan_super` / `plan_ultra` |
| `amount_usd` | 美金 credit 总额（套餐为日 cap 累积上限，topup 为永久额度） |
| `daily_cap_usd` | 套餐才有：每日额度（Plus=$30 / Super=$80 / Ultra=$720） |
| `daily_remaining_usd` | 当日剩余（每日 0:00 重置为 daily_cap_usd） |
| `total_remaining_usd` | topup 才用：永久剩余余额 |
| `started_at` | 起算时间 |
| `expires_at` | 周期结束时间（套餐为 +28 天，trial 为 +24h，topup 为 null） |
| `mode_lock` | `auto_only` / `auto_eco_only` / `none` |
| `model_pool` | `gpt_only` / `all` / null（即使用全模型） |
| `created_at` | 购买时间 |

**消耗顺序**（每次扣费时按以下排序，2026-04-26 翻转）：

```sql
ORDER BY
  CASE
    WHEN expires_at IS NULL THEN 1   -- topup（永不过期）后扣
    ELSE 0                            -- 套餐先扣（要趁今天用，0:00 会作废）
  END,
  expires_at ASC,                     -- 套餐之间按到期早的优先
  created_at ASC
```

**每日 0:00 cron 任务**（双事件原子操作）：
1. **作废 (expire)**：对每个 active 套餐 bucket，若 `daily_remaining_usd > 0` → 写一条 `usage_log` 记录 `event_type=expire, amount=−daily_remaining_usd`，并 set `daily_remaining_usd = 0`
2. **重置 (reset)**：对每个 active 套餐 bucket，写一条 `usage_log` 记录 `event_type=reset, amount=+daily_cap_usd`，并 set `daily_remaining_usd = daily_cap_usd`

两个动作必须在同一事务里完成（原子）。

### 模式锁 / 模型池实现

| Bucket 类型 | mode_lock | model_pool |
|---|---|---|
| `trial` | `auto_eco_only` | 路由层硬绑 ECO tier |
| `plan_plus` | `auto_only` | `gpt_only` |
| `plan_super` | `none` | `all` |
| `plan_ultra` | `none` | `all` + 优先级 |
| `topup` | `none` | `all` |

扣费时检查 incoming request：
- Manual 模式 + 用户当前 active bucket 全是 `auto_only` / `auto_eco_only` → 返回 in-chat 文本提示，引导升级 / 加 topup
- Auto 模式 + 模型不在 `model_pool` 内 → 路由层重新选 pool 内的合适模型
- 试用 ECO 强制：路由层只走 ECO tier，无视 prompt 复杂度

### 前端展示

- **控制台主屏**（dashboard-v1）：`$X.XX` 余额橙色 hero + 今日 cap 进度条 + 活跃 bucket 列表（套餐 / 充值 + 优先扣套餐 → 充值的提示） + 黑底"最近调用"strip + **接入中心卡** + 内嵌"最近使用历史"4 行 + 内嵌"API Key"列表 + 快捷链接。控制台 = 账号一切的入口，使用历史 / API Key 都收纳在内不再单独占顶导。
- **套餐定价页**（pricing-v8）：顶部 baseline 锚卡 ¥1=$1 + 编号小节 01 标准价 / 02 套餐 + 3 张卡（Plus / Super 推荐 / Ultra 售罄） · 每卡 ×N 优惠 pill + ≈$X 总额度 + 仅 4 个关键数据（日 cap · 总额 · 倍数 · 模型） · "i" hover tooltip 露其余 + 编辑式克制（无销售感分隔条）
- **使用历史页**（history-v1.2）：当前余额 pill + 24h 消耗柱状图 + 类型列（消耗/重置/作废/充值，颜色编码） + $变化列（红/绿/灰） + 完整 timestamp + 筛选 selects + 首/末页分页。删 CSV 导出 / 用量列 / 搜索框 / 日期分组
- **账户设置页**（settings-v1）：仅邮箱 + 当前套餐 + 注册时间（无头像 / 显示名 / 最常用模型）+ 用量摘要（消耗 + 调用 2 项，无最常用模型）+ 操作（联系客服 + 退出登录）
- **接入指引页**（manual-config-pc）：v1.0 改为 `set up tokenboss.com/skill.md` 一行咒语主路径 + 传统 4 步 fallback（折叠在二级 tab）

### Agent 内 in-chat 文本（仅文本 + 链接，无 UI 元素）

所有摩擦时刻通过聊天回复承载：

| 触发 | 回复模板 |
|---|---|
| Plus 用户切 Claude 模型 | "此模型需 Super 套餐或加买充值额度。升级：tokenboss.com/pricing" |
| 试用切付费模型 | "免费试用仅可用智能路由。升级：tokenboss.com/pricing" |
| 当日额度耗尽 | "今日额度已用完。明日 0:00 自动刷新，或立即加买额度：tokenboss.com/pricing" |
| 周期结束 | "本周期结束。续订：tokenboss.com/pricing" |
| 服务异常 | "服务暂时不可用，已切到备用模型。详情：tokenboss.com/status" |

## Open questions

以下不影响经济模型骨架，但实施前需校准：

1. **¥ 价微调**：Plus ¥288 / Super ¥688 / Ultra ¥1688 是 2026-04-26 定稿。如需汇率调整可 ±5%。
2. **Super ×4 vs ×3 marketing 倍数**：实际是 ¥688/$2,240 = 3.26x，pill 标 ×4 是 marketing 上调（×3 也对）。如需诚实精确，pricing 页改 ×3.3 或 ×3+。
3. **Auto 模式"省 X%"具体数字**：等内置路由跑实测 benchmark 校准。
4. **并发 / RPM 限制**：内部参数，按上游 API 实际承载力决定。
5. **Ultra 何时实际开放**：v1 上线显示"已售罄"（已登录视图），未登录访客视图露 Ultra 卡 + "免费注册试用 →" CTA → 引到 /auth；用户登录后才告知名额已满。Phase 1.5 看 Super 上限触顶频率决定开放时机。

## Non-goals

- ❌ **多 channel 分组定价**（DragonCode 模式）—— v1 单 channel 跑通，复杂度推迟
- ❌ **周/月限额**（aigocode 等竞品在做）—— 日 cap 已足够细，跟"礼物亮 / 规则藏"调性兼容
- ❌ **¥/$ 汇率游戏** —— 不展示"按 1:7 折算"那种透明对比，统一 $ 美金体感
- ❌ **试用规则前置教育** —— 用户面不解释"必须 Auto / 必须 ECO"，撞墙时 JIT in-chat
- ❌ **微信支付** —— Phase 1.5 接入
- ❌ **Ultra 实际开放** —— v1 显示已售罄即可；Phase 1.5 评估

## Risk & rollback

- **如果实际数据显示套餐用户日均消耗 > 80% credit**（margin 不够）→ 缩减日 cap（Plus $30 → $25 / Super $80 → $60）。预计 Phase 1.5 之前不需要。
- **如果上游 API 价格大幅下跌**（如 Anthropic 降价 50%）→ ¥/$ 数字保持，杠杆变得更宽松，对我们更有利。
- **如果上游 API 价格大幅上涨** → 缩减日 cap 数字（cheapest first response），或调整 ¥ 价。
- **试用 $10 / 24h 如果薅羊毛严重**（机制 B 被绕过）→ 缩减到 $5 / 24h 或加手机号验证。
- **Ultra "已售罄"如果引发用户反感（误以为骗局）** → 改为"敬请期待"或"内测中"。

## Acceptance

- 所有 10 项 Decisions 在前端 / 后端实现并跑通
- Dashboard 显示 `$X.XX` 余额（不显示积分单位）
- 使用历史每条记录带 `−$X.XXXX` 金额 + 模型 + 客户端 + 模式 + tokens
- Plus 用户尝试 `claude-opus-4` → 收到 in-chat 文本提示
- 试用账户尝试 `gpt-5` Manual → 收到 in-chat 文本提示
- 套餐每日 0:00 重置 daily_remaining_usd
- 套餐 D27 24:00 周期结束，total bucket 清零
- Topup 余额 → 永不过期
- 多 bucket 共存时，扣费按优先级（topup 先 → 套餐当日次之）
- 支付宝 H5 移动端 + 二维码 PC 端 跑通
- Billing 页 Ultra 显示"SOLD OUT"，无法下单
