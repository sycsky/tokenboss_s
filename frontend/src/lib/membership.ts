/**
 * 会员制订阅暂停期文案。
 *
 * 由于上游模型供应商定价波动，会员制三档（Plus / Super / Ultra）暂时
 * 软关闭——后端 PLANS[].soldOut=true 拒收所有自助下单（包括同档续费，
 * 因为 webhook applyPlanToUser 会清空旧订阅导致续费用户损失剩余时长）。
 * 现有订阅者的续费走前端「联系客服」路径，admin 手动处理避开陷阱。
 *
 * 恢复方式（**必须两处一起翻**）：
 *   1. backend/src/lib/plans.ts: PLANS.{plus,super,ultra}.soldOut → false
 *   2. frontend/src/lib/pricing.ts: TIERS[].soldOut → false（plus / super
 *      / ultra 三处）
 * 单独翻后端不够——前端 TIERS 是后端的镜像，UI 通过 isLoggedIn && tier.soldOut
 * 决定渲染，前端不翻就一直留在售罄态。
 */
export const MEMBERSHIP_PAUSED_COPY = {
  /** 横幅标题（Plans 页顶部 / Landing 登录态） */
  bannerTitle: '会员制订阅暂时售罄',
  /** 横幅正文（带"上游变动频繁，临时售罄"解释 + 现有订阅者续费指引） */
  bannerBody:
    '上游模型供应商定价变动频繁，目前临时关闭新订阅入口（不是永久下架）。已订阅用户的续费请联系客服处理。同期可使用按量付费——按调用计费、永久可用。',
  /** sold-out tier 卡片的 CTA 文案 */
  ctaText: '改用按量付费 →',
  /** Payment.tsx 直链拦截页的解释文案 */
  paymentDirectBlocked:
    '此档会员暂时售罄（上游变动频繁，临时关闭，不是永久下架）。可改用按量付费继续使用。',
  /** 售罄 hint 短文案（卡片上简短提示，详细解释靠 banner） */
  shortHint: '上游变动频繁，临时售罄',
} as const;
