import { PhoneFrame } from "../components/PhoneFrame.js";
import { LinkButton } from "../components/Button.js";
import { Card } from "../components/Card.js";

/**
 * Screen 1a — Landing (current version).
 * Value-prop-forward: savings, agent-ready, open-source, supported models,
 * local payment badges.
 */
export default function Landing() {
  return (
    <PhoneFrame>
      <div className="flex-1 px-6 py-8 flex flex-col">
        {/* Nav row */}
        <div className="flex items-center justify-between mb-8">
          <div className="text-[18px] font-bold tracking-tight">TokenBoss</div>
          <a
            href="/landing/vision"
            className="text-label text-text-secondary hover:text-accent"
          >
            愿景
          </a>
        </div>

        {/* Hero */}
        <h1 className="text-hero mb-4">
          一张卡
          <br />
          用遍所有
          <br />
          <span className="text-accent">AI 工具</span>
        </h1>
        <p className="text-body text-text-secondary mb-8">
          面向非程序员的 AI API 中转站。支付宝 / 微信充值，
          <br />
          智能路由最多省 95% token。
        </p>

        {/* CTA */}
        <LinkButton to="/onboard/welcome" fullWidth className="mb-3">
          免费体验 →
        </LinkButton>
        <p className="text-caption text-text-muted text-center mb-8">
          注册即送 $5 · 无需信用卡
        </p>

        {/* Feature cards */}
        <div className="space-y-3 mb-8">
          <Card>
            <div className="flex items-start gap-3">
              <span className="text-[22px]">⚡</span>
              <div>
                <div className="text-h3">最多省 95% token</div>
                <div className="text-caption text-text-secondary mt-1">
                  智能路由到最合适的模型，不为轻问题付重价
                </div>
              </div>
            </div>
          </Card>
          <Card>
            <div className="flex items-start gap-3">
              <span className="text-[22px]">🤖</span>
              <div>
                <div className="text-h3">Agent-ready</div>
                <div className="text-caption text-text-secondary mt-1">
                  兼容 OpenAI / Anthropic / Claude Code 接口
                </div>
              </div>
            </div>
          </Card>
          <Card>
            <div className="flex items-start gap-3">
              <span className="text-[22px]">🔓</span>
              <div>
                <div className="text-h3">开源可审计</div>
                <div className="text-caption text-text-secondary mt-1">
                  基于 ClawRouter 开源构建，路由逻辑透明
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Model grid */}
        <div className="mb-8">
          <div className="text-label text-text-secondary mb-3">
            已接入模型
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { name: "Claude Opus", color: "badge-claude" },
              { name: "Claude Sonnet", color: "badge-claude" },
              { name: "GPT-5.4", color: "success" },
              { name: "GPT-5.3", color: "success" },
            ].map((m) => (
              <div
                key={m.name}
                className="bg-surface border border-border rounded-sm px-3 py-2 text-caption font-mono"
              >
                {m.name}
              </div>
            ))}
          </div>
        </div>

        {/* Payment badges */}
        <div className="mt-auto flex items-center justify-center gap-3 pt-4 border-t border-border">
          <div className="text-caption text-text-muted">支持支付方式</div>
          <div className="flex items-center gap-2">
            <span className="bg-info-subtle text-info-text rounded-sm px-2 py-1 text-caption font-medium">
              支付宝
            </span>
            <span className="bg-success-subtle text-success-text rounded-sm px-2 py-1 text-caption font-medium">
              微信支付
            </span>
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}
