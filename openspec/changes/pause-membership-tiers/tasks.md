## 1. 准备 / 摸底

- [x] 1.1 sold-out 检查在 `paymentHandlers.ts:209`；`auth.userId` 在 174 行已就绪
- [x] 1.2 现有助手够用——`store.ts` 的 `getUser(userId)` 返回的 `UserRecord.plan: UserPlan` 字段就是「当前订阅 tier」的本地真相（受 cron / payment webhook 维护，比 newapi 直查更省 RTT）
- [x] 1.3 ULTRA_DROP **没有** cron——是纯前端 `frontend/src/lib/dropSchedule.ts` 的展示常量。spec/design 已修正为「Plans/Landing 的 sold-out 分支不引用 ULTRA_DROP 即可」

## 2. 后端：续费豁免 — **最终砍掉**（codex 三轮 review 收敛）

> 三版演化见 design.md D1。最终决定：sold-out 期间所有自助下单一律 410，续费走「联系客服」路径让 admin 手动处理，避开 webhook applyPlanToUser invalidate 旧订阅的陷阱。等以后修了 webhook 才启用续费豁免。

- [x] 2.1 ~~豁免分支~~ → 砍掉。`paymentHandlers.ts:209` sold-out 检查仍是无条件 410
- [x] 2.2 测试改成「sold-out 期间所有用户都 410，包括同档持有者」（3 个 case）
- [x] 2.3 backend 全套 169/169 测试通过

## 3. 后端：ULTRA_DROP 暂停 — **N/A**

> 摸底确认 ULTRA_DROP 是纯前端展示常量。「不再展示倒计时」在 Plans/Landing tierCta 重写时自然完成。

- [x] 3.1 ~~ULTRA_DROP cron 短路~~ → 不存在 cron
- [x] 3.2 ~~ULTRA_DROP cron 单测~~ → 不存在 cron

## 4. 后端：翻 sold-out boolean

- [x] 4.1 `PLANS.plus.soldOut = true`
- [x] 4.2 `PLANS.super.soldOut = true`
- [x] 4.3 `plans.ts` 文件加注释说明恢复方式（PLANS 上方）
- [x] 4.4 旧测试「Plus/Super 不 410」已更新为反向断言

## 5. 前端：共享常量 + 数据同步

- [x] 5.1 新建 `frontend/src/lib/membership.ts` · `MEMBERSHIP_PAUSED_COPY` (bannerTitle / bannerBody / ctaText / paymentDirectBlocked / shortHint)
- [x] 5.2 `frontend/src/lib/pricing.ts` plus + super 加 `soldOut: true`

## 6. 前端：Plans 页

- [x] 6.1 顶部条件 banner（`anyPaused = isLoggedIn && (plus.soldOut || sup.soldOut || ultra.soldOut)`）— ink-stamped 短条
- [x] 6.2 重写 `tierCta` sold-out 分支：
  - [x] 6.2.1 删除「下次开放 {ultraCountdown}」分支 + 不再 import `useDailyCountdown`
  - [x] 6.2.2 持有同档 → 「续费 →」（contact sales）
  - [x] 6.2.3 未持有 / 持有跨档（更高档）→ `MEMBERSHIP_PAUSED_COPY.ctaText` → `/billing/topup`
  - [x] 6.2.4 持有更高档看更低档 → null（沿用现有）
- [x] 6.3 `dimmed` / `ctaVariant` / `featured` / `banner` / `ctaHelper` 全部 gate 在 paused flag 上
- [x] 6.4 eyebrow 保持不变（banner 已经把语义说清楚）

## 7. 前端：Landing 页

- [x] 7.1 找到 tier 区段（约 160-180 行 + 275-326 行）
- [x] 7.2 改写 `ctaFor(paused)`：访客 → 免费开始；登录+暂停 → 改用按量付费；登录+未暂停 → 联系客服购买
- [x] 7.3 卡片视觉 `dimmed` / `featured` / `banner` / `ctaHelper` 全部 gate 在 paused flag 上
- [x] 7.4 顶部条件 banner（同 Plans 风格）
- [x] 7.5 build 通过 · 访客分支表达保持原样

## 8. 前端：Payment.tsx 直链拦截

- [x] 8.1 ~~引入 isRenewal 例外~~ → **codex review 第二轮否决**：webhook applyPlanToUser 会清空旧订阅，直链续费 = 损失剩余时长。改成无条件 lockout（跟改动前一致）
- [x] 8.2 写新组件 `MembershipPausedPage`：标题「{plan} 套餐暂时售罄」+ `paymentDirectBlocked` 文案 + 「改用按量付费 →」按钮
- [x] 8.3 路径覆盖：
  - [x] 8.3.1 paidSku=null 用户直链 sold-out plan → MembershipPausedPage
  - [x] 8.3.2 已订阅用户直链同档/跨档 → AlreadyPaidNotice（跟改动前一致，避开 applyPlanToUser 陷阱）

## 9. 验收

- [x] 9.1 backend `pnpm test` 21 files / 170 tests 全绿；frontend `pnpm test` 17 files / 84 tests 全绿；frontend `pnpm vite build` 干净通过（399 modules）
- [ ] 9.2 本地 `pnpm dev` 浏览器手测：
  - [ ] 9.2.1 未登录访客 `/` `/pricing` —— 应当跟改动前一致（无 banner / 无 dimmed / CTA「免费开始」）
  - [ ] 9.2.2 新注册用户 `/pricing` —— banner + 三卡 dimmed + CTA「改用按量付费」
  - [ ] 9.2.3 paidSku=plan_X 用户 —— 自己档「续费 →」，其他档「改用按量付费」/null
  - [ ] 9.2.4 直链 `/billing/pay?plan=plus`（无订阅）→ MembershipPausedPage
  - [ ] 9.2.5 直链 `/billing/pay?plan=plus`（已订阅 Plus）→ 正常支付流程
- [ ] 9.3 `gstack browse` 截图三状态留底（合并前做）

## 10. 部署 / 收尾

- [ ] 10.1 提交 commit（按 design.md Migration Plan 也可以拆两次；当前实现是单 commit）
- [ ] 10.2 commit / PR 描述里写清楚：恢复方式 = 把 PLANS.{plus,super,ultra}.soldOut 改回 false（plans.ts 顶部已经放注释）
