/**
 * Single source of truth for which payment channels are visible to users.
 *
 * Every user-facing "supported payment methods" surface — the Topup page's
 * method picker AND the Plans page's PayBadge readout — imports these, so a
 * channel can never be advertised on one screen while the checkout on another
 * refuses to offer it (the class of bug codex kept surfacing when each screen
 * hard-coded its own flag).
 *
 * The backend mirrors these for its agent-facing 402 copy via the
 * SHOW_DODO_TOPUP / SHOW_A2M_TOPUP env vars — flip both sides together when a
 * channel goes live.
 */

/** 支付宝 AI 收款（A2M）因商户风控暂时对用户下线；解封后改回 true。
 *  后端对应 env：SHOW_A2M_TOPUP=1。 */
export const SHOW_ALIPAY_A2M = false;

/** Dodo（卡 / 微信）网关：Dodo 商户审核通过 + 正式 DODO_* 变量配齐前保持
 *  false，避免宣传了却拿到 503。上线时改回 true，并在后端设 SHOW_DODO_TOPUP=1、
 *  同步 skill.md 的 Web topup 文案。 */
export const SHOW_DODO = true;
