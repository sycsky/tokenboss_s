## ADDED Requirements

### Requirement: 三档会员制套餐进入售罄态
后端 `PLANS.plus.soldOut`、`PLANS.super.soldOut`、`PLANS.ultra.soldOut` SHALL 全部为 `true`。前端 `TIERS[].soldOut` SHALL 跟后端同步保持一致。

#### Scenario: 后端拒收 sold-out 档新单
- **WHEN** 任意未持有该档订阅的用户向 `/v1/billing/checkout`（或同等下单端点）提交 `plan_plus` / `plan_super` / `plan_ultra` 类订单
- **THEN** 后端返回 `410 plan_sold_out`
- **AND** 不创建订单记录、不联系支付网关

#### Scenario: 数据层一致性
- **WHEN** 前端在任意页面读取 `TIERS[i].soldOut`
- **THEN** 三档的值都是 `true`，跟后端 `PLANS[i].soldOut` 一致

---

### Requirement: sold-out 期间无续费豁免（API 层全员拦截）
sold-out 检查在后端 SHALL 一律返回 `410 plan_sold_out`，**不区分**用户是否持有同档活跃订阅。续费走前端「联系客服」路径，admin 手动处理。

> **Why no API exemption（codex review 抓到的根因）**：webhook 的 `applyPlanToUser` 在绑新订阅前会 invalidate 全部活跃订阅（防 Trial+Plus 同时活跃 / 重复扣费）。如果允许同档续费走自助路径，用户付完款后旧订阅被清空，剩余时长归零——明亏。所以 sold-out 期间锁死所有自助路径，让 admin 走手动流程避开 `applyPlanToUser`。等以后 webhook 改成「同档累加而非替换」后，再开放续费豁免（届时把豁免分支加回来即可）。

#### Scenario: 已持有 Ultra 用户提交 Ultra 下单 → 仍然 410
- **WHEN** 一个 `paidSku=plan_ultra` 用户提交 `plan_ultra` 下单
- **THEN** 后端返回 `410 plan_sold_out`
- **AND** 不创建订单
- **AND** 用户必须走「联系客服」路径才能续费

#### Scenario: 跨档下单仍 410
- **WHEN** 一个 `paidSku=plan_plus` 用户提交 `plan_super` 或 `plan_ultra`
- **THEN** 后端返回 `410 plan_sold_out`

#### Scenario: 无订阅用户买任意 sold-out 档 → 410
- **WHEN** 一个 `paidSku=null` 用户提交 `plan_plus` / `plan_super` / `plan_ultra`
- **THEN** 后端返回 `410 plan_sold_out`

---

### Requirement: 访客（未登录）视感无变化
对未登录访客，前端 SHALL **不展示**任何「售罄」相关的视觉、文案或行为：
- Plans 页面顶部不显示售罄 banner
- 三档 tier card 不应用 dimmed 视觉
- tier card 的 CTA 文案、链接、行为跟改动前一致（"免费开始 →" 引到 `/register`）
- Landing 页 tier 区段同上，跟改动前一致

#### Scenario: 访客打开 Plans 页面
- **WHEN** `useAuth().user` 为 `null` 的访客打开 `/pricing`
- **THEN** 顶部不出现「会员制暂停」之类的 banner
- **AND** 三档 tier card 不带 dimmed 样式
- **AND** 三档 tier card 的 CTA 都是 "免费开始 →" 跳转 `/register`

#### Scenario: 访客打开 Landing 页面
- **WHEN** 未登录访客打开 `/`
- **THEN** tier 卡片区段视觉跟改动前一致
- **AND** 不出现售罄相关字样

---

### Requirement: 登录用户的售罄态展示
对登录用户，前端 SHALL 把会员制三档表达为售罄态，**核心信息**：
1. 一条页面级提示（banner / 文案块）说明会员制暂停 + 续费不受影响
2. 每张 sold-out 卡片视觉上 dimmed
3. 卡片 CTA 替换为引导按量付费
4. 售罄解释文案：「上游变动频繁，临时售罄，不是永久下架」（或措辞等价的表述）

#### Scenario: 登录用户打开 Plans 页面
- **WHEN** `useAuth().user` 不为 null 的用户打开 `/pricing`
- **THEN** 页面顶部出现 banner，文案包含「会员制订阅暂时售罄」+「续费不受影响」语义
- **AND** Plus / Super / Ultra 三张卡片都呈 dimmed 样式
- **AND** 三张卡片的 CTA 文案变成 "改用按量付费 →" 类表述
- **AND** 点击该 CTA 跳到 `/billing/topup`

#### Scenario: 登录用户打开 Landing 页面
- **WHEN** 已登录用户打开 `/`
- **THEN** tier 卡片区呈现售罄态（视觉 dimmed + CTA 引导按量付费）
- **AND** 跟 Plans 页面的售罄表达保持一致语气

#### Scenario: 现有订阅者看自己已购档
- **WHEN** `paidSku=plan_super` 的用户打开 `/pricing`
- **THEN** Super 卡片 CTA 仍然是 "续费 →"（不变成 "改用按量付费"），点击进入续费流程
- **AND** Plus 和 Ultra 卡片对该用户仍呈售罄态（按当前 tier 比较逻辑：Plus 低档不显示 CTA、Ultra 高档显示 "改用按量付费 →"）

#### Scenario: 售罄解释文案出现位置
- **WHEN** 登录用户处于任何能看到售罄态的位置（Plans 页 banner、tier card 的 CTA 区域、Payment.tsx 直链拦截页）
- **THEN** 至少一处显示「上游变动频繁，临时售罄」语义的解释（不要求三处都重复，但用户的视线路径上必须能看到）

---

### Requirement: ULTRA_DROP 倒计时不再展示给售罄态用户
> 摸底确认：ULTRA_DROP **是纯前端的展示常量**（`frontend/src/lib/dropSchedule.ts`），后端没有任何 cron / 定时放票逻辑——ULTRA_DROP 只是给「下次开放」CTA 文案提供倒计时数字。所以「ULTRA_DROP 暂停」实质就是前端 sold-out 分支里**不再引用** ULTRA_DROP 倒计时。

售罄态下，Plans / Landing 的 sold-out CTA 文案 SHALL **不**出现 ULTRA_DROP 倒计时数字。改用统一的「改用按量付费 →」或「续费 →」表述。

#### Scenario: 登录用户打开 Plans 页 Ultra 卡
- **WHEN** 登录用户看 Ultra 卡的 CTA
- **THEN** 文案不出现倒计时格式（如 `12:34:56` / `下次开放 ...`）
- **AND** 文案是「改用按量付费 →」或「续费 →」（如果用户持有 Ultra）

#### Scenario: 恢复机制
- **WHEN** 运维把 sold-out 翻回 false（例如 PLANS.plus.soldOut=false）
- **THEN** 该档恢复正常下单
- **AND** Plans / Landing 的 tierCta 走非 sold-out 分支，UI 自动恢复
- **AND** 不需要数据库迁移、不需要重启服务以外的额外操作

---

### Requirement: Payment.tsx 直链拦截的售罄文案
用户直接访问 `/billing/pay/:planId`（绕过 Plans 页），如果该 plan sold-out 且用户不持有任何会员订阅，前端 Payment 组件 SHALL 阻止流程并显示售罄解释 + 改用按量付费的引导。

> **注意：直链自助续费明确不支持。** webhook 的 `applyPlanToUser` 在绑新订阅前会 invalidate 全部活跃订阅（避免 Trial+Plus 同时活跃），同档续费走自助路径 = 用户损失剩余时长。已订阅用户访问 `/billing/pay` 一律走 v1 现有的「联系客服」lockout，避免触发陷阱。后端 `paymentHandlers` 的续费豁免保留作防御深度，但当前 UI 路径不触发它。

#### Scenario: 登录无订阅用户直链 sold-out 档
- **WHEN** 一个 `paidSku=null` 用户访问 `/billing/pay?plan=plus`
- **THEN** 页面不显示支付二维码 / 渠道选择
- **AND** 显示「Plus 套餐暂时售罄」+「上游变动频繁，临时售罄」+「改用按量付费」按钮跳 `/billing/topup`

#### Scenario: 已订阅用户直链同档（续费意图）→ lockout
- **WHEN** 一个 `paidSku=plan_plus` 的用户访问 `/billing/pay?plan=plus`
- **THEN** 走 v1 现有的「你已经订阅了 PLUS」lockout 页（不触发支付流程）
- **AND** 提供「联系客服 →」按钮，admin 通过手动流程处理续费（避开 applyPlanToUser 清空剩余时长的陷阱）

#### Scenario: 已订阅用户直链跨档
- **WHEN** 一个 `paidSku=plan_plus` 的用户访问 `/billing/pay?plan=ultra`
- **THEN** 同样走 lockout 页（v1 没自助升级，跟改动前一致）
