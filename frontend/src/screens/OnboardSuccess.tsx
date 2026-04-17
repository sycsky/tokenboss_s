import { PhoneFrame } from "../components/PhoneFrame.js";
import { LinkButton } from "../components/Button.js";
import { ProgressDots } from "../components/ProgressDots.js";

/**
 * Screen 7 — Onboarding 3/3. Binding success confirmation.
 */
export default function OnboardSuccess() {
  const checks = [
    { label: "Telegram 已绑定", sub: "@yourname · 已验证" },
    { label: "$5 试用额度已到账", sub: "约 150 万 token" },
    { label: "智能路由已启用", sub: "自动挑选最省模型" },
    { label: "支付方式待设置", sub: "余额耗尽前再提醒你", muted: true },
  ];

  return (
    <PhoneFrame>
      <div className="flex-1 px-6 py-8 flex flex-col">
        <ProgressDots current={3} />

        <div className="flex-1 flex flex-col items-center text-center pt-4">
          <div className="w-20 h-20 rounded-full bg-success-subtle flex items-center justify-center mb-4">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 13L9 17L19 7"
                stroke="#16A34A"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h1 className="text-h2 mb-2">绑定成功！</h1>
          <p className="text-body text-text-secondary mb-6">
            你可以直接在 Telegram 开始对话
          </p>

          <div className="w-full space-y-2 text-left mb-6">
            {checks.map((c) => (
              <div
                key={c.label}
                className="flex items-start gap-3 bg-surface border border-border-subtle rounded-sm px-4 py-3"
              >
                <div
                  className={`mt-0.5 flex-shrink-0 ${c.muted ? "text-text-muted" : "text-success"}`}
                >
                  {c.muted ? "○" : "✓"}
                </div>
                <div>
                  <div
                    className={`text-body font-medium ${c.muted ? "text-text-muted" : "text-text-primary"}`}
                  >
                    {c.label}
                  </div>
                  <div className="text-caption text-text-secondary">{c.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <LinkButton to="/chat/balance" fullWidth>
            完成，去 Telegram 试试
          </LinkButton>
          <LinkButton to="/dashboard" variant="secondary" fullWidth>
            去网页后台
          </LinkButton>
        </div>
      </div>
    </PhoneFrame>
  );
}
