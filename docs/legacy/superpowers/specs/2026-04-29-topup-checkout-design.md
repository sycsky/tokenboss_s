# 充值 self-checkout (topup) 设计

**Date:** 2026-04-29
**Status:** Approved (brainstorm), pending implementation plan
**Topic:** 通过支付宝（xunhupay）+ USDT-TRC20（epusdt）两条已有渠道，开放一次性充值 (topup) 的自助下单 / 支付 / 落账流程
**Builds on:** `docs/superpowers/specs/2026-04-25-credits-economy-design.md`（充值产品规则的 source of truth）

## Context

当前 `POST /v1/billing/orders` 强制 `planId`，仅支持套餐购买（plus / super / ultra）。一次性充值在 v1.0 是 placeholder：spec credits-economy § 4 锁定了产品规则（¥1=$1、永不过期、解锁全模型），但 self-checkout 通道留空，CTA 走客服微信兜底。

底层支付能力已就位（xunhupay + epusdt 已经在 plan 订单上跑通），所以这次的工作是**复用现有支付管道**承载新的"充值"订单类型，而不是接新渠道。

## Decisions

### 1. 范围

**做：**
- 用户能通过 **支付宝（xunhupay）** 或 **USDT-TRC20（epusdt）** 自助充值
- 整数金额，最低 ¥1 / $1，预设档位 `¥50 · ¥100 · ¥500 · 自定义`，自定义上限 99999（防误输）
- webhook 落账后 → newapi 用户 quota 增加对应 USD 等额（¥1=$1）
- 充值后额度永不过期、解锁全模型（spec credits-economy § 4 + § 7）
- 活跃订阅者（Plus / Super / Ultra）也能充值——这正是 spec § 7 "Plus 用户加买充值解锁 Claude" 的前提
- 充值页同时承载兑换码入口（复用现有 `RedeemCodeModal`）

**不做：**
- 不动 Payment.tsx 套餐下单路径（仅做共享组件抽取）
- 不动 redeemHandler 兑换码 API（兑换码与自助充值并行存在）
- 不开放微信支付（spec credits-economy § 10 已锁延后）
- 不启用本地 `credit_bucket` 表（V3 newapi-as-truth migration 已 drop，topup 直接落到 newapi.user.quota）
- 不做发票流程
- 不支持充值退款（充值页底部明确写出）—— 套餐页"24h 全额退款"copy 不动

### 2. API 契约

同一个 `POST /v1/billing/orders`，body 加 `type` 字段做显式分支：

```jsonc
// 套餐（现状不变）
{ "type": "plan",  "planId": "plus|super|ultra", "channel": "xunhupay|epusdt" }

// 充值（新增）
{ "type": "topup", "amount": 100, "channel": "xunhupay|epusdt" }
```

向前兼容：未传 `type` 字段时默认 `"plan"`，老客户端 / 集成不需要改。

币种由 channel 单方面派生（xunhupay→CNY、epusdt→USD），客户端不能传 currency——堵住"声明 ¥10 实际付 $10"那种攻击。

`GET /v1/billing/orders` 与 `GET /v1/billing/orders/{id}` 返回值新增 `skuType` + `topupAmountUsd`，前端订单历史页能区分套餐与充值。

### 3. 数据模型 delta

`OrderRecord` 调整：

| 字段 | 旧 | 新 |
|---|---|---|
| `planId` | `'plus' \| 'super' \| 'ultra'`（必填）| 删除（被 skuType 替代）|
| `skuType` | — | `'plan_plus' \| 'plan_super' \| 'plan_ultra' \| 'topup'`（必填，新增）|
| `topupAmountUsd` | — | `number` 可选，仅 topup 订单填，记到账 USD 等额 |
| `settleStatus` | — | `'settled' \| 'failed'` 可选，仅 topup 用；webhook 落账前为 undefined |
| 其余字段（amount / currency / channel / status / upstream* 等）| 保留 | 保留 |

`skuType` 跟 spec credits-economy 的 bucket 类型术语对齐（`plan_plus / plan_super / plan_ultra / topup`），两个领域共用一套词汇。

`settleStatus` 与 `status` 解耦的理由：`status` 是"网关支付结果"（pending/paid/expired/failed），`settleStatus` 是"我方落账到 newapi 的结果"。订单可以"已 paid 但 settle 失败"——这种 case 必须能查得到。

**SQLite 迁移：** 加列 `skuType TEXT NOT NULL DEFAULT 'plan_<id>'`（用 `planId` 历史值回填）、`topupAmountUsd REAL`、`settleStatus TEXT`；`planId` 列保留一段时间作为冗余（rollback 安全垫），下个 release 再删。

### 4. Webhook → newapi 落账

充值订单复用 `processWebhook` 公共流（按 channel 分 epusdt / xunhupay 不变），在 settle 完成后按 `order.skuType` 分支：

```
order.skuType startsWith "plan_" → applyPlanToUser  (现状, bindSubscription)
order.skuType === "topup"        → applyTopupToUser (新增)
```

**`applyTopupToUser` 实现路径：admin 铸币 → 后端代用户兑换**

1. 调 newapi admin `POST /api/redemption` 铸一枚一次性 redemption code，面值 = `topupAmountUsd × 500_000`（newapi 内部 quota 单位，redeemHandler 已用过这个换算）
2. `newapi.loginUser` 拿当前用户 session（已有 cache）
3. `POST /api/user/topup` 把刚铸的 code 兑给该用户（**复用 redeemHandler 已跑通的路径**）
4. 成功 → set `OrderRecord.settleStatus = 'settled'`；失败 → set `'failed'` 并 console.error

**为什么不走 admin `updateUser` 直接改 quota：** read-modify-write 之间用户可能正在调 API 消耗 quota，并发会丢账。webhook 频率虽低，但充值正好在用户活跃时发生，风险非零。铸币 + 兑换两步在 newapi 内部都是原子操作，且 newapi 兑换日志里有自然的审计记录。

**幂等：** `markOrderPaidIfPending` 是条件 UPDATE，重复 webhook 投递只有第一次成功 → `applyTopupToUser` 至多触发一次，钱不会重复加。

**失败兜底：** webhook 仍 200 ack（订单已 paid，不能让网关无限重投），但 `settleStatus=failed` 且 `console.error` 写出 `{ orderId, userId, topupAmountUsd, errorMessage, channel }`，运维 / 人工能用 orderId grep 出来。v1 阶段人工巡检 + `npx tsx backend/scripts/grant-topup.ts <email> <amountUsd>` 兜底（调用与 applyTopupToUser webhook 相同的 mint+redeem 流程，不依赖 deprecated credit_bucket 表）；v1.1 再考虑加自动 retry cron。

### 5. 前端 Topup 页

新页面 `frontend/src/screens/Topup.tsx`，路由 `/billing/topup`。

**布局（自上而下）：**

```
面包屑 控制台 / 充值
Eyebrow BILLING · 充值
H1     充值额度
Sub    永不过期 · 解锁全模型 · ¥1 = $1

▣ 支付方式  (ChannelOption × 2)
  ○ 支付宝               ○ USDT-TRC20
  PC 扫码 / 手机直跳       区块链稳定币 · TRON

▣ 充值金额
  [¥50] [¥100] [¥500] [自定义]
  自定义选中时：[输入框 integer 1-99999]
  → 到账 $X 美金

错误条（如有）

[去付款 · ¥X]               ← 重新选金额

· 充值后立即到账，永不过期，全模型可用
· 充值不支持退款
· 已有兑换码？ ← 弹 RedeemCodeModal
```

**币种 / 输入联动：** 渠道驱动币种，不引入第二个 currency toggle。
- 选支付宝 → 档位显 `¥50/¥100/¥500/自定义`，输入是 `¥`，副标 "→ 到账 $X (1:1)"
- 选 USDT → 档位显 `$50/$100/$500/自定义`，输入是 `$`，副标 "→ 收 USDT 等额"

**复用 / 抽取：**
- `ChannelOption` 从 `Payment.tsx` 抽到 `frontend/src/components/ChannelOption.tsx`
- 提交后的渠道分支跳转（PC 扫码 / 移动 H5 直跳 / USDT 新窗口）抽到 `frontend/src/lib/checkoutFlow.ts`
- `Payment.tsx` 同步重构消费这两个共享 —— 在现有代码基础上迭代，不另起炉灶
- `RedeemCodeModal` 实现不动，仅在 Topup 页底部加触发链接

**支付完成后跳转：** 复用 `OrderStatus.tsx`，根据 `skuType` 切换文案：
- plan → "套餐 1 分钟内激活"（现状）
- topup → "$X 已加到余额"

### 6. 入口

| 位置 | 现状 | 改成 |
|---|---|---|
| Dashboard 余额 hero 卡 | 无充值入口 | 卡片角加 `+ 充值额度` 链接 → `/billing/topup` |
| Pricing 页底部 | "按量充值 ¥50 起" 走客服微信 | 改 CTA 跳 `/billing/topup` |
| Payment.tsx 已订阅 lockout 页 | 仅 "联系客服" | 加副链接 `+ 加买充值额度` → `/billing/topup` |
| Settings 页 | RedeemCodeModal 入口 | 保留不动 |

### 7. 校验与错误处理

**输入校验（服务端必做，前端做镜像）：**

| 校验项 | 规则 | 错误响应 |
|---|---|---|
| `type` | `'plan' \| 'topup'` 或缺省（默认 `'plan'`）| 400 `invalid_request_error` |
| `topup.amount` | `Number.isInteger(amount) && 1 ≤ amount ≤ 99999` | 400 `invalid_amount` |
| `channel` | `'xunhupay' \| 'epusdt'` | 400 `invalid_request_error` |
| `topup` 时客户端传 planId | 服务端忽略 | — |
| `plan` 时客户端传 amount | 服务端忽略 | — |

**错误处理矩阵：**

| 场景 | 状态 | 文案 |
|---|---|---|
| 网关创建订单失败 | 502 `upstream_error` | "下单失败，稍后再试"|
| 网关 min 不足（如 xunhupay 拒 ¥1）| 502 `upstream_error` 携带原因 | "金额低于支付渠道下限，请增加金额" |
| webhook 签名错 | 403 `bad_signature` 不 ack | 现有逻辑不动 |
| webhook unknown order | 200 ack | 现有逻辑不动 |
| `applyTopupToUser` 失败 | webhook 仍 200 ack | `settleStatus=failed` + console.error，cron 巡检兜底 |
| 用户在 quota 刷新前查 dashboard | OrderStatus 页 "$X 即将到账，刷新可见" | 60s 内一定到账 |

### 8. 测试策略

**单元测试（扩充 `paymentHandlers.test.ts`）：**
- body 校验：`type` 缺省 / `type=plan` / `type=topup` 三种 happy path
- amount 边界：`0 / 1 / 99999 / 100000 / 1.5 / "1" / null / NaN`
- currency 派生：channel=xunhupay → CNY，channel=epusdt → USD，客户端 currency 被无视

**新增 `paymentWebhookTopup.test.ts`：**
- mock newapi `redemption mint` + `user/topup` → 验证 quota delta 正确
- 幂等：重复 webhook → 仅一次 mint+redeem
- mint 成功、redeem 失败 → `settleStatus=failed`

**手工 e2e（追加到 `docs/订阅测试指南.md`）：**
1. ¥1 + 支付宝 → newapi quota +500_000 → dashboard 余额 +$1
2. $1 + USDT-TRC20 → 同上
3. 二次投递 webhook → quota 不重复加
4. 模拟 newapi 失败 → `settleStatus=failed`，log 出现

## Open questions

进 plan 阶段需要砸钉子的：

1. **xunhupay 网关最小金额阈值**：需跑 `probe-xunhupay.mjs` 真测 ¥1 / ¥2 / ¥5 / ¥10，找出真实下限。如果 ¥1 被网关拒，要么调整 UI 最小值，要么前置友好文案。
2. **newapi `POST /api/redemption` 请求体形状**：现 `newapi.ts` 没封装这个 endpoint。plan 阶段读 newapi 源码 (`new-api/controller/redemption.go`) 确认字段，然后扩 `newapi.ts`。
3. **`settleStatus=failed` 的人工兜底**：v1 仅 log + 暴露问题，不做自动 retry。v1.1 再决定要不要 cron job。

## Non-goals

- ❌ 微信支付（spec credits-economy § 10）
- ❌ 充值退款 / 发票
- ❌ 重启用本地 `credit_bucket` 表（newapi-as-truth）
- ❌ 充值积分 / bonus / 阶梯优惠（spec § 4 已删 5 档 ladder）
- ❌ 自动 retry 失败的 settle（v1 仅人工兜底）
- ❌ 套餐 24h 退款条款修改

## Risk & rollback

- **xunhupay 网关 min > ¥1**：UI 起充自动调高，现有订单不受影响。
- **newapi 兑换 endpoint 字段变化（newapi 升级）**：mint 失败 → `settleStatus=failed`，钱已收但额度未到 → 走人工兜底脚本 (`npx tsx backend/scripts/grant-topup.ts <email> <amountUsd>`，调用与 applyTopupToUser webhook 相同的 mint+redeem 流程，不依赖 deprecated credit_bucket 表)。
- **充值后 quota 立即被用户耗尽**：spec credits-economy § 6 的扣费优先级（套餐先扣 → 充值后扣）已规划，无新增风险。
- **rollback 路径**：`type` 字段缺省默认 `'plan'`，删掉前端 Topup 入口 + 服务端拒 `type=topup` 即可回到当前状态；`OrderRecord` 新字段都可空，老订单不受影响。

## Acceptance

- `POST /v1/billing/orders` 同时接受 `type=plan` 与 `type=topup`，校验全覆盖
- 充值订单完成后 newapi user.quota 增加 `topupAmountUsd × 500_000`
- 重复 webhook 投递不重复加额度
- newapi 失败时 `OrderRecord.settleStatus='failed'` 且 console.error 可查
- `/billing/topup` 页面：金额档位 + 自定义 + 渠道选择 + 兑换码入口齐全
- Dashboard 余额卡 / Pricing 底部 / Payment 已订阅锁定页 三处入口跳通
- 活跃订阅者能进 /billing/topup 完成充值（无 lockout）
- `OrderStatus.tsx` 根据 skuType 显示正确文案
- 单元 + e2e 测试通过
