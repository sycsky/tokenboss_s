# Credits 经济模型 v1

**Date:** 2026-04-25
**Status:** Approved, pending implementation
**Topic:** TokenBoss v1 的付费 / 计价 / 扣费 / 套餐 / 试用 模型

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

| SKU | 实付 | 日额度 | 28 天累计上限 | 模型池 | 状态 |
|---|---|---|---|---|---|
| **Plus** | `¥288 / 月` | `$30 / 天` | 最高 `$840` | 便宜模型池（GPT-5 / GPT-5-mini / Codex / Haiku） | ✅ v1 开放 |
| **Super** | `¥588 / 月` | `$80 / 天` | 最高 `$2,240` | 全模型（含 Claude Sonnet / Opus） | ✅ v1 开放 |
| **Ultra** | `¥1688 / 月` | `$720 / 天` | 最高 `$20,160` | 全模型 + 优先级 | 🔒 显示已售罄 |

**杠杆比递进设计（v16）**：3 档杠杆比刻意递进 — Plus `2.92×` → Super `3.81×` → Ultra `11.95×`。Super 比 Plus 多 ~30% 升档诱因，Ultra 是营销橱窗（"$20K 美金额度"），SOLD OUT 状态下不承担实际 margin。这跟"花得多比例更划算"的 SaaS 直觉对齐。

**Ultra 的 "已售罄" 显示策略**：让用户看到"还有更高档存在"，给将来留升级路径。**"已售罄"传递供不应求 + 稀缺感**，比"暂不开放"营销心理更强 —— 上线时一并展示，Phase 1.5 评估开放时机。

**关键差异化**：套餐区分不靠"能用多少"靠"能用什么"。Plus = TokenBoss Auto 替你选；Super = 你自己选 Opus / GPT-5 / 等。

### 3. 日 cap + 28 天周期

- 每日 0:00 重置当日额度（套餐日 cap 重新满血）
- **当日 24:00 未用完作废**（不结转到次日，不累积）
- 4 周共 28 天为一个完整周期，付款日为 D0
- D27 23:59 周期结束，套餐 bucket 清零并失效
- "28 天累计上限"是营销展示数字（= 日 cap × 28），不是真实可累积余额
- v1 不做更细的 rate limit / 并发限制（按上游 API 实际承载力决定，内部参数）

### 4. 一次性充值（top-up）

5 档心理价，**永不过期**，无折扣（已通过日 cap 给足实惠对比）：

| 档位 | 实付 | 到账 |
|---|---|---|
| 入门 | `¥9.9` | `$10` |
| 小补 | `¥29.9` | `$30` |
| 常用 | `¥58.8` | `$60` |
| 大量 | `¥98` | `$100` |
| 批量 | `¥288` | `$300` |

充值后所有模式（Auto + Manual 全模型）都解锁。Plus 套餐用户加买充值后可临时使用 Claude / Opus 等 Manual 模型。

**订阅 vs 按量对比清晰**：同样付 ¥288，订阅给最高 $840 美金额度（约 2.92×），按量给 $288（1×）。订阅是高频用户的明显更优解；按量是低频 / 多模型用户的灵活解。

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
1. 先扣 一次性充值余额  (永不过期)
2. 后扣 套餐当日额度    (24:00 作废)
```

**理由**：让用户感觉"我充的钱在被实实在在用"，套餐当日额度是基础保障；同时套餐每日作废能 incentive 用户用足，不会因优先扣套餐而觉得"我充的钱白放着"。

### 8. 使用历史 / 透明度

每次 API 调用在使用历史页显示：

| 字段 | 内容 |
|---|---|
| 时间 | 调用时间戳 |
| 类型 | 消耗 / 充值 / 退款 |
| 客户端 | OpenClaw / Hermes / 等 Agent 标识 + logo |
| 模式 | Auto / Manual |
| 模型 | `claude-sonnet-4` / `gpt-5.4-mini` / 等 |
| Tokens | 输入 + 输出 token 数 |
| 金额 | `−$X.XXXX` |

沿用现有 `frontend/src/screens/UsageHistory.tsx` 的结构（图表 + 表格），把"积分变化"列改为"金额（$）"+ 增加 Tokens 列 + 新增"模式"列区分 Auto / Manual。

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

**消耗顺序**（每次扣费时按以下排序）：

```sql
ORDER BY
  CASE
    WHEN expires_at IS NULL THEN 0   -- topup（永不过期）优先
    ELSE 1
  END,
  expires_at ASC,                     -- 套餐之间按到期早的优先
  created_at ASC
```

每日 0:00 cron 任务：所有 active 套餐 bucket 的 `daily_remaining_usd = daily_cap_usd`（重置当日额度，未用部分作废）。

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

- **Dashboard 主屏**：`$X.XX` 余额（Geist Mono 大数字，按当日剩余 + topup 余额合计） + 当前活跃 bucket 列表（Plus 还 N 天 / topup $X 不过期）+ 今日 / 累计消耗
- **Billing 页**：3 张套餐卡（Plus + Super + Ultra "SOLD OUT"）+ 5 档 topup table + 支付方式选择
- **使用历史页**：沿用现有 `UsageHistory.tsx` 结构，单位换 `$`
- **接入指引页**：试用 $10 礼物卡视觉 + 接入命令

### Agent 内 in-chat 文本（仅文本 + 链接，无 UI 元素）

所有摩擦时刻通过聊天回复承载：

| 触发 | 回复模板 |
|---|---|
| Plus 用户切 Claude 模型 | "此模型需 Super 套餐或加买额度。升级：tokenboss.co/billing" |
| 试用切付费模型 | "免费试用仅可用智能路由。升级：tokenboss.co/billing" |
| 当日额度耗尽 | "今日额度已用完。明日 0:00 自动刷新，或立即加买额度：tokenboss.co/billing" |
| 周期结束 | "本周期结束。续订：tokenboss.co/billing" |
| 服务异常 | "服务暂时不可用，已切到备用模型。详情：tokenboss.co/status" |

## Open questions

以下不影响经济模型骨架，但实施前需校准：

1. **¥ 价微调**：Plus ¥288 / Super ¥588 / Ultra ¥1688 是定稿。如需汇率调整可 ±5%。
2. **Auto 模式"省 X%"具体数字**：等 ClawRouter 部署后跑实测 benchmark 校准。
3. **并发 / RPM 限制**：内部参数，按上游 API 实际承载力决定。
4. **Ultra 何时实际开放**：v1 上线显示"已售罄"，Phase 1.5 看 Super 用户上限触顶频率决定开放时机。

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
