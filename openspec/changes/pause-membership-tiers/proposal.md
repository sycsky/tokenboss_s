## Why

当前会员制三档（Plus / Super / Ultra）以固定 4 周价格预售一段配额，但**上游模型供应商定价波动剧烈**，按现价继续接单可能造成单笔订单亏损。同时按量付费产品本身健康（按调用计费 + 内置 spread），不需要冻结。

不想直接把会员制下架——一是产品页面已经投入大量营销叙事不愿弃，二是上游一旦稳定还要恢复。所以走「暂时售罄」这条软关闭路径：**关掉新订阅入口，老用户不动，访客视感无变化，上游回稳后翻一行 boolean 即可恢复**。

## What Changes

- **后端 `PLANS.{plus,super}.soldOut` 翻成 `true`**（Ultra 已经是 true）。下单接口对这三档新单返 `410 plan_sold_out`
- **续费豁免**：`paymentHandlers` 在 sold-out 检查里加例外——如果当前下单的用户已经是该档活跃订阅者，放行续费（不影响现有订阅生命周期）
- **Ultra daily-drop 暂停**：相关 cron / 定时事件冻结，避免「售罄」期间还跑稀缺感倒计时戏码
- **前端把所有「售罄态」表达 gate 在 `isLoggedIn`**：
  - 访客（未登录）→ 看到的 Plans / Landing 跟改动前一致，CTA 仍是 "免费开始 →" 引到 /register
  - 登录用户 → 看到三档卡片转售罄态 + 解释文案 + 引导按量付费
- **「售罄解释」文案**：在售罄触发点附近显示「上游变动频繁，临时售罄，不是永久下架」（具体出现位置见 design.md）
- **登录用户的 sold-out 卡片 CTA**：从现有的 "下次开放 {countdown}"（基于 ULTRA_DROP）替换为 "改用按量付费 →" 直接跳 `/billing/topup`
- **登录用户的 /pricing 顶部加一条 banner**：「会员制订阅暂时售罄。已订阅用户续费不受影响。」+ 解释链接 / icon
- **现有订阅者看自己已购档的 CTA 保持「续费 →」**（依赖续费豁免后端逻辑生效）

不在本次范围：
- ~~改 Landing 整体视觉重排（hero / 推按量付费上位）~~ — 因为访客视感不变，Landing 不需要结构性大改；登录用户在 Landing 看到的 sold-out 处理跟 Plans 一致即可
- ~~砍掉 Ultra 的 ULTRA_DROP 模块~~ — 只是暂停触发，模块本身保留以便恢复
- ~~下架会员制相关页面 / 路由~~ — 不下架，只是软关
- ~~改价 / 调整 quota / 重定义档位~~ — 等上游稳定后另议

## Capabilities

### New Capabilities
- `membership-paused`: 会员制三档「软暂停」状态的语义 + 渲染规则，包括登录态售罄、访客零变化、续费豁免、临时性文案、ULTRA_DROP 冻结

### Modified Capabilities

（无现有 spec 受影响——`openspec/specs/` 目前为空；`add-seo-baseline` 引入的 `seo-meta` 跟本次正交不冲突）

## Impact

**改动文件**
- `backend/src/lib/plans.ts` — `PLANS.plus.soldOut` 和 `PLANS.super.soldOut` 翻 true
- `backend/src/handlers/paymentHandlers.ts` — sold-out 检查处加续费豁免分支
- `backend/src/lib/dropSchedule.ts` 或 ULTRA_DROP 相关 cron 入口 — 暂停触发
- `frontend/src/lib/pricing.ts` — `TIERS[].soldOut` 跟后端同步
- `frontend/src/screens/Plans.tsx`：
  - `tierCta` 函数 sold-out 分支文案 / 行为重写
  - 顶部 banner 组件接入
  - 视觉 dimmed 仍由 soldOut 控制，但要确保只对登录用户展开
- `frontend/src/screens/Landing.tsx`：
  - 登录态 tier CTA 接入 sold-out 处理
  - 访客态严格保留现状
- 文案：在 Plans / Landing / 售罄 toast / Payment 拒单提示几个点统一「上游变动频繁，临时售罄」表述

**不影响**
- 现有订阅者的订阅生命周期（dailyCron 仍正常回收 / 续期）
- 按量付费产品（topup / billing 走原路径）
- 数据库 schema
- newapi 相关绑定 / 发放逻辑
- /verify-email、/login、/onboard 等无关流程

**风险**
- 续费豁免逻辑写错 → 真有支付意愿的老用户被错误拒单。Mitigate：加单元测试覆盖「现有订阅者续本档放行」+「现有订阅者跨档升级仍被拒」+「无订阅用户买 sold-out 仍被拒」三条路径
- ULTRA_DROP 暂停后忘了恢复 → 上游回稳时遗漏。Mitigate：把暂停做成可配置（环境变量 / 单一 boolean），恢复方式跟 sold-out boolean 同处
- 登录态的 sold-out 文案在 Plans 和 Landing 散落 → 后续改文案要改两处。Mitigate：把核心文案抽到 `frontend/src/lib/membership.ts` 共享常量
