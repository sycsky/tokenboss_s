## Context

会员制三档（Plus/Super/Ultra）按 4 周固定价预售一段调用配额，但**上游模型供应商定价波动剧烈**——按当前定价继续接新单可能整笔亏损。同时按量付费产品本身健康（按调用计费 + 内置 spread）。

数据 / 逻辑层面，软关闭机制已经早期就在了：
- `backend/src/lib/plans.ts` 有 `PLANS[].soldOut` 字段
- `backend/src/handlers/paymentHandlers.ts:209` 见到 sold-out=true 直接返 `410 plan_sold_out`
- `frontend/src/screens/Payment.tsx:153` 也有直链拦截
- `frontend/src/lib/pricing.ts` 的 `TIERS[].soldOut` 是后端镜像
- `frontend/src/screens/Plans.tsx:124` 的 `tierCta` 在 sold-out 分支返「下次开放 {ultraCountdown}」（拿 ULTRA_DROP 倒计时做稀缺感）

Ultra 已经长期 `soldOut=true` 跑这套。本次本质是把 Plus/Super 也接进来，**但要重新定义「sold out」期间的 UX 文案和行为**——因为 Ultra 的「下次开放」语义不适合 Plus/Super（它们是无限期暂停，不是每天放票）。

## Goals / Non-Goals

**Goals**
- 把 Plus/Super 的 `soldOut` 翻 true，跟 Ultra 一起进入售罄态
- 续费豁免：现有该档订阅者能正常续费同档，不被拦
- 访客视感零变化：未登录用户看到的 Plans/Landing 跟改动前一致
- 登录用户在「打算购买」的位置看到统一的售罄表达：banner + dimmed 卡片 + 「改用按量付费 →」CTA + 「上游变动频繁，临时售罄」解释
- ULTRA_DROP 倒计时在售罄期间不展示给用户、cron 不放票
- 恢复零成本：上游回稳后，仅翻 boolean 即可恢复

**Non-Goals**
- 不重构 Landing 视觉权重（按量付费 hero 上位、tier 区块整体下沉等）—— 访客视感保持原样后这事不必做
- 不删 ULTRA_DROP 模块代码 —— 只暂停触发
- 不下架会员制路由 / 文案
- 不改价 / 改 quota / 改档位结构
- 不接受售罄期间还跑稀缺感倒计时这种混搭

## Decisions

### D1: 续费豁免——最终决定不做（codex 三轮 review 收敛）

**最终选定：sold-out 期间无任何续费豁免。所有自助下单一律 410。**

演化路径（这次踩了三个坑，记录在这里给后人参考）：

1. **第一版**：后端用 `user.plan === planId` 做续费豁免。
   - **codex 抓到**：V3 newapi-as-truth 之后 `setUserPlan` 在 store.ts 定义但无调用方，`user.plan` 是空字段。这条豁免会把所有合法续费误杀。
2. **第二版**：把判断改成查 newapi `listUserSubscriptions`，跟 `/v1/buckets` 同源。
   - **codex 抓到**：webhook 的 `applyPlanToUser` 在绑新订阅前会 invalidate 全部活跃订阅（防 Trial+Plus 同时活跃 / 重复扣费）。同档续费走自助路径 = 用户付完款剩余时长归零，明亏。
3. **第三版（最终）**：完全砍掉续费豁免分支，sold-out 期间所有自助下单一律 410。续费走前端「联系客服」路径，admin 走手动流程避开 `applyPlanToUser` 陷阱。

副作用：
- 删掉了第二版引入的 `backend/src/lib/subscriptions.ts`（它是为豁免分支专门写的，没有其他用途）
- 删掉了 `getActivePaidPlanId` helper
- 测试改成「sold-out 期间所有用户都 410，包括同档持有者」

**等什么时候启用续费豁免？** 当且仅当 `applyPlanToUser` 改成「同档不 invalidate / 时长累加」之后。届时：
1. 重新加回后端续费豁免分支（参第二版）
2. 重新引入 `getActivePaidPlanId` helper（newapi listUserSubscriptions 真相通道，**不要**用 `user.plan`）
3. 改 `Payment.tsx` 的 lockout 让同档续费跳过
4. 加测试确认续费走完支付流程后剩余时长被保留

### D2: ULTRA_DROP 怎么暂停？

**摸底修正**：`grep` 后端发现 ULTRA_DROP **不存在 cron**——它纯粹是前端 `frontend/src/lib/dropSchedule.ts` 里的展示常量，被 Plans/Landing 的 sold-out 分支拿来生成「下次开放 12:34:56」文案。

所以「ULTRA_DROP 暂停」简化成：**Plans/Landing 的 sold-out CTA 不再引用 ULTRA_DROP 倒计时**——这件事在 D4 的 `tierCta` 重写里直接完成，不需要单独的 cron 短路。

ULTRA_DROP 模块代码保留（用作未来恢复 Ultra 售罄稀缺感的素材），但本次的 sold-out 路径不再调用它。

### D3: 前端「访客 vs 登录」的渲染分支放哪？

**选定：在 `tierCta` 函数顶部判断 `isLoggedIn`**——这是现有结构，已经天然处理了访客分支（`if (!isLoggedIn) return { text: '免费开始 →' }` 早返）。本次只需**把视觉 dimmed、banner 展示、explanation 文案这些渲染层副作用同样 gate 住 `isLoggedIn`**。

```
Plans.tsx 渲染层伪代码：

  const isPaused = isLoggedIn && (plus.soldOut || sup.soldOut || ultra.soldOut)
  
  return (
    <main>
      {isPaused && <PausedBanner />}
      <TierCard 
        dimmed={isLoggedIn && plus.soldOut}    // 关键：访客永远 false
        cta={...}                              // 内部已有 isLoggedIn 早返
      />
      ...
    </main>
  )
```

**为什么 dimmed 也要 gate**：如果只把 CTA 文案 gate 住、卡片视觉仍然 dimmed，访客会看到三张灰扑扑的卡 + 一个亮闪闪的「免费开始 →」按钮，错位、引导力弱。dimmed 视觉本身就是「售罄态」的语言，必须跟其他售罄信号一致 gate。

### D4: 售罄态的 CTA 替换策略

登录用户看 sold-out 卡片时，按当前 tier 关系决定 CTA：

| 用户当前订阅状态 | 看 plan A 卡（sold-out） | CTA 行为 |
|------|------|------|
| 未持有任何订阅 | 任意 sold-out 档 | 「改用按量付费 →」→ `/billing/topup` |
| 持有 plan A | plan A（同档） | 「续费 →」→ 现有续费流程（后端豁免） |
| 持有 plan B（B≠A） | plan A | 「改用按量付费 →」→ `/billing/topup` |
| 持有 plan B | plan A 是更低档 | 不显示 CTA（沿用现有逻辑） |

**关键改动**：原 `tierCta` 在 sold-out 分支返「下次开放 {ultraCountdown}」拿 ULTRA_DROP 倒计时——本次把这条分支整体替换成上面的逻辑。倒计时引用直接删除（ULTRA_DROP 模块还在但不再被 tierCta 引用）。

### D5: 售罄解释文案抽到哪里？

**选定：新建 `frontend/src/lib/membership.ts` 共享常量**，供 Plans / Landing / Payment 三个文件统一引用：

```ts
export const MEMBERSHIP_PAUSED_COPY = {
  bannerTitle: '会员制订阅暂时售罄',
  bannerBody: '上游变动频繁，临时售罄，不是永久下架。已订阅用户续费不受影响。目前可使用按量付费。',
  ctaText: '改用按量付费 →',
  paymentDirectBlocked: '此档会员暂时售罄。可改用按量付费继续使用。',
};
```

**为什么不内联**：售罄文案大概率会被产品 / 客服反复打磨，集中一处避免后续要改三个文件。

### D6: 售罄 banner 的视觉风格

**选定：跟 Plans 页现有「PRICING · 套餐」eyebrow 同行级别的提示，比如 ink-stamped 的小条**——与 page hero 平衡，不抢戏，但比纯灰色文字明显。

不做：
- ~~浮动 toast / 弹窗~~（侵入太重）
- ~~右上角小红点 / 通知数字~~（不严肃）
- ~~首屏遮罩 + 强制确认~~（破坏页面节奏）

具体颜色 / 边框由执行阶段照 Slock-pixel 风格走（`bg-bg-soft` + `border-2 border-ink` + 短句），照 Plans 页其他模块的视觉语言。

### D7: Landing 怎么处理？

由于访客视感不变，Landing 主要面对的是访客（登录用户更可能在 /console 而非 Landing）——**不需要做结构性重排**。

只在 Landing 现有的 tier 卡片渲染处加 isLoggedIn 分支：
- 访客：现状不动
- 登录用户：CTA 改成「改用按量付费 →」+ 卡片 dimmed

## Risks / Trade-offs

**[R1] 续费豁免逻辑写错，老用户被错杀** → Mitigate：单元测试覆盖三种路径——`未持有 → 拒`、`持有同档 → 放行`、`持有跨档 → 拒`、`已过期 → 拒`。

**[R2] ULTRA_DROP cron 偷跑放票** → Mitigate：在 cron 入口加上 `MEMBERSHIP_PAUSED` 短路 + 日志输出。部署后跑一次手动检查（看日志 / DB 状态）。

**[R3] 登录用户在多个页面看到不一致的售罄文案** → Mitigate：D5 的 membership.ts 共享常量。

**[R4] 上游回稳后忘了切回 false** → 流程性问题，没法用代码完全防住。Mitigate：commit message + PR description 写清楚「恢复方式：把这两行 boolean 改回 false」+ 在 plans.ts 里加注释。

**[R5] 现有的 Payment.tsx 拦截 + 后端 410 + 续费豁免三方互动** → codex review 第二轮揭示 `applyPlanToUser` 会清空旧订阅，自助续费有真实损失。Mitigate：
- Payment.tsx 仍然**无条件 lockout** 已订阅用户（包括同档想续费的）
- 后端续费豁免保留作防御深度，但 v1 的 UI 路径不触发
- 续费走 contact sales modal，admin 手动操作避开 applyPlanToUser 陷阱
- 测试：未订阅用户直链 sold-out plan → 看到 MembershipPausedPage；已订阅用户直链 → AlreadyPaidNotice，跟改动前一致

**[R7] webhook applyPlanToUser invalidate 行为是潜在债** → 这是 pre-existing bug（不是本次引入），但本次让它变得 user-facing（如果 admin 误把直链 URL 给现有订阅者）。修法不在本次范围，留作 followup。

**[R6] 切回 sold-out=false 后，已经被显示「售罄」的 SSR / 缓存页可能滞后** → 当前是 SPA 没有 SSR，无影响；将来若加预渲染（add-seo-prerender），sold-out 状态变化要考虑触发重新构建。

## Migration Plan

部署顺序（每一步独立可回滚）：

1. **后端先上**
   - `paymentHandlers` 加续费豁免分支
   - 单测覆盖
   - **暂时还不翻 boolean**，部署 + 验证测试通过
2. **前端跟上**
   - `TIERS[].soldOut` 同步为 true
   - `tierCta` 替换 sold-out 文案 + 行为
   - PausedBanner 接入
   - membership.ts 文案常量
   - 部署到 preview，登录用户视角 / 访客视角各 walkthrough 一次
3. **后端翻 boolean**
   - `PLANS.plus.soldOut = true`、`PLANS.super.soldOut = true`
   - 部署 → 真正进入售罄态
4. **ULTRA_DROP 验证**
   - 等到下个 ULTRA_DROP 触发时间窗口，确认日志「skipped due to pause」
   - 或代码中增加恒等触发的 dev hook 提前验证

回滚：把 `PLANS.{plus,super}.soldOut` 改回 false 即可恢复（前端的售罄 UI 自动消失，因为渲染条件是 `isLoggedIn && tier.soldOut`）。

## Open Questions

- **Q1: 后端有没有 `getActiveSubscriptionSku(userId)` 这种 helper？** 还是要现写？执行阶段第一步先确认（grep `paidSku` / `getUserPaidSku` / 类似名字）。
- **Q2: ULTRA_DROP 在哪个 cron 入口注册？** Lambda EventBridge schedule？还是某个 admin endpoint？需要在执行阶段定位，确保暂停判断加在最早的入口。
- **Q3: Payment.tsx 现在的 `plan.soldOut` 拦截需要细化** —— 当前是无条件拦截 sold-out plan，本次要改成「持有同档则放行」。要确认 Payment 组件里能拿到当前用户的 `paidSku`。
- **Q4: 售罄 banner 是否要带「订阅时通知我」表单（邮件订阅恢复通知）？** 默认不做（v1 阶段简化），但执行阶段如果发现成本极低也可以顺手做。
