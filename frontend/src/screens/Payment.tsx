import { useNavigate, useSearchParams } from "react-router-dom";
import { PhoneFrame } from "../components/PhoneFrame.js";
import { Card } from "../components/Card.js";
import { BackButton } from "../components/BackButton.js";

const PLAN_SUMMARY: Record<string, { name: string; price: string; tokens: string }> = {
  basic: { name: "基础版", price: "¥39", tokens: "500 万 token" },
  standard: { name: "标准版", price: "¥129", tokens: "2000 万 token" },
  pro: { name: "专业版", price: "¥429", tokens: "8000 万 token" },
};

/**
 * Screen 11 — Payment. Pick Alipay or WeChat Pay. Both buttons navigate to
 * the mock success screen since no real gateway is wired up.
 */
export default function Payment() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const planId = params.get("plan") ?? "standard";
  const plan = PLAN_SUMMARY[planId] ?? PLAN_SUMMARY.standard;

  const pay = (method: "alipay" | "wechat") => {
    navigate(`/billing/success?plan=${planId}&method=${method}`);
  };

  return (
    <PhoneFrame>
      <div className="flex-1 px-6 py-6 flex flex-col">
        <div className="mb-4">
          <BackButton />
        </div>

        <h1 className="text-h2 mb-6">确认订单</h1>

        <Card className="mb-6">
          <div className="space-y-3">
            <div className="flex justify-between">
              <div className="text-caption text-text-secondary">套餐</div>
              <div className="font-medium">{plan.name}</div>
            </div>
            <div className="flex justify-between">
              <div className="text-caption text-text-secondary">包含</div>
              <div className="font-mono text-caption">{plan.tokens}</div>
            </div>
            <div className="flex justify-between">
              <div className="text-caption text-text-secondary">订阅周期</div>
              <div className="font-medium">1 个月</div>
            </div>
            <div className="border-t border-border-subtle pt-3 flex justify-between items-baseline">
              <div className="text-caption text-text-secondary">应付</div>
              <div className="text-h2 font-bold text-accent">{plan.price}</div>
            </div>
          </div>
        </Card>

        <div className="text-label text-text-secondary mb-3">选择支付方式</div>
        <div className="space-y-3 mb-6">
          <button
            onClick={() => pay("alipay")}
            className="w-full bg-info text-white rounded-sm py-4 font-semibold text-body flex items-center justify-center gap-3 hover:opacity-90 transition-opacity"
          >
            <span className="text-[20px]">支</span>
            支付宝支付
          </button>
          <button
            onClick={() => pay("wechat")}
            className="w-full bg-success text-white rounded-sm py-4 font-semibold text-body flex items-center justify-center gap-3 hover:opacity-90 transition-opacity"
          >
            <span className="text-[20px]">微</span>
            微信支付
          </button>
        </div>

        <p className="text-caption text-text-muted text-center mt-auto">
          支付即表示同意 TokenBoss 的
          <a href="#" className="text-accent ml-1">
            服务条款
          </a>
        </p>
      </div>
    </PhoneFrame>
  );
}
