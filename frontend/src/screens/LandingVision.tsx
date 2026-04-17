import { PhoneFrame } from "../components/PhoneFrame.js";
import { LinkButton } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { BackButton } from "../components/BackButton.js";

/**
 * Screen 1b — Landing (vision version).
 * Longer-term strategic framing rather than immediate value-prop.
 */
export default function LandingVision() {
  return (
    <PhoneFrame>
      <div className="flex-1 px-6 py-8 flex flex-col">
        <div className="mb-6">
          <BackButton to="/" label="首页" />
        </div>

        <div className="text-caption text-accent font-semibold tracking-widest mb-2">
          VISION · 2026
        </div>
        <h1 className="text-hero mb-4">
          连接你与
          <br />
          一切 <span className="text-accent">AI 能力</span>
        </h1>
        <p className="text-body text-text-secondary mb-8">
          TokenBoss 不是第十家 API 代理。我们希望做成 AI
          时代的「水电燃气总闸」：
          <br />
          一张卡通往所有能力，按你真实消耗计费。
        </p>

        <div className="space-y-3 mb-8">
          <Card>
            <div className="text-h3 mb-1">🧭 智能路由</div>
            <div className="text-caption text-text-secondary">
              同一 prompt 自动挑选最省、最快、最合适的模型
            </div>
          </Card>
          <Card>
            <div className="text-h3 mb-1">🧩 Skills 市场</div>
            <div className="text-caption text-text-secondary">
              把 agent 能力打包成可购买的 Skill，像 App Store 一样
            </div>
          </Card>
          <Card>
            <div className="text-h3 mb-1">🔌 SaaS 集成</div>
            <div className="text-caption text-text-secondary">
              一键把 AI 能力接入 Notion / Lark / 企业微信
            </div>
          </Card>
          <Card>
            <div className="text-h3 mb-1">🌐 统一 API</div>
            <div className="text-caption text-text-secondary">
              一个接口说话，底层跨厂商自动切换
            </div>
          </Card>
        </div>

        <LinkButton to="/onboard/welcome" fullWidth>
          开始使用 →
        </LinkButton>
      </div>
    </PhoneFrame>
  );
}
