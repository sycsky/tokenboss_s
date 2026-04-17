import { PhoneFrame } from "../components/PhoneFrame.js";
import { LinkButton } from "../components/Button.js";
import { ProgressDots } from "../components/ProgressDots.js";

/**
 * Screen 2 — Onboarding 1/3. Welcome + free credit activation.
 */
export default function OnboardWelcome() {
  return (
    <PhoneFrame>
      <div className="flex-1 px-6 py-8 flex flex-col">
        <ProgressDots current={1} />

        <div className="flex-1 flex flex-col items-center text-center pt-4">
          <div className="text-[60px] mb-4">🎉</div>
          <h1 className="text-h2 mb-2">欢迎来到 TokenBoss</h1>
          <p className="text-body text-text-secondary mb-6">
            完成三步接入，立刻开始使用
          </p>

          <div className="bg-accent-subtle border border-accent/30 rounded-[14px] px-6 py-4 mb-6">
            <div className="text-caption text-accent font-semibold tracking-widest mb-1">
              注册送
            </div>
            <div className="text-hero text-accent">$5</div>
            <div className="text-caption text-text-secondary">
              约 150 万 token · 无需信用卡
            </div>
          </div>

          <div className="w-full space-y-2 text-left mb-6">
            <div className="text-label text-text-secondary">已支持模型</div>
            {[
              "Claude Opus 4.6 · Sonnet 4.6 · Haiku 4.5",
              "GPT-5.4 / 5.3 / 4o / 4o-mini",
              "Gemini 2.5 Pro · Gemini Flash",
            ].map((line) => (
              <div
                key={line}
                className="font-mono text-caption text-text-primary bg-surface-warm border border-border-subtle rounded-sm px-3 py-2"
              >
                {line}
              </div>
            ))}
          </div>
        </div>

        <LinkButton to="/onboard/install" fullWidth>
          下一步：接入 OpenClaw
        </LinkButton>
      </div>
    </PhoneFrame>
  );
}
