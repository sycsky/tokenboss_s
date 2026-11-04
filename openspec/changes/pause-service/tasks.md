# Service Pause Frontend Implementation Plan

用户已确认第二版原型，并进一步限定本次只改前端。此前后端任务已撤回，不再作为执行要求。

**Goal:** 顶部公告、公开停服说明与退款联系；隐藏业务入口。
**Architecture:** 前端共享日期/邮箱常量、公告/页脚组件、公开说明页；路由层替换旧认证与付款页面，不更改后端。
**Spec:** `specs/service-pause/spec.md`、`ui-proposal.md`、`mock/index.html`。

## 全局约束与检查重点

- `2026-12-01T00:00:00+08:00`；`shawn@tokenboss.co`。
- 首页仅顶部公告；其他入口为“停服说明”。不增加状态卡片或 slogan 下停服段落。
- 保留旧会话查看能力；不更改后端，不实际暂停 API，不发送邮件或退款。
- 重点检查：旧 OAuth 回调、已登录用户充值/兑换入口、后端请求挂起、日期切换、手机邮箱换行。

## Task 1: 公告与说明页

- [x] `src/lib/servicePause.ts`：前端日期/邮箱常量及跨截止时态更新。
- [x] `ServicePauseBanner.tsx`、`ServicePauseFooter.tsx`、`ServiceNotice.tsx`：公告、邮箱、邮件链接、复制反馈。
- [x] `App.tsx`：在认证守卫之外显示公告，旧登录/注册/验证/OAuth/付款路由直接呈现说明。
- [x] `ServicePause.test.tsx`：先观察失败，实施后通过；验证链接无认证/支付表单、无后端依赖。

## Task 2: 业务入口

- [x] TopNav、AppNav、Landing、Plans：移除注册/登录/付款 CTA，统一停服说明。
- [x] Dashboard、Settings：保留读取，隐藏充值/续费/兑换操作。
- [x] AnonKeyPasteInput、KeyInjectionFlow：移除新用户入口；不主动触碰后端 Key。
- [x] Legal：本次停服退款专项说明覆盖常规条款；首页和页脚保持同一邮箱。

## Task 3: 验证与交接

- [x] 前端全量测试、类型检查与生产构建。
- [x] 本地前端浏览器验收：375/1440px、原入口、无后端、既有会话。
- [x] `git diff -- backend` 及后端未跟踪文件检查为空。
- [x] 更新验证记录，不推送、不部署，不声称已迁移。

完成记录见 `validation.md`。未提交、推送或部署；迁移另行落实。
