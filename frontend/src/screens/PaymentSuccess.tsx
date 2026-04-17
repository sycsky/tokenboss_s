import { useSearchParams } from "react-router-dom";
import { PhoneFrame } from "../components/PhoneFrame.js";
import { LinkButton } from "../components/Button.js";

const PLAN_NAMES: Record<string, { name: string; price: string; tokens: string }> = {
  basic: { name: "基础版", price: "¥39", tokens: "500 万" },
  standard: { name: "标准版", price: "¥129", tokens: "2000 万" },
  pro: { name: "专业版", price: "¥429", tokens: "8000 万" },
};

/**
 * Screen 12 — Payment success confirmation.
 */
export default function PaymentSuccess() {
  const [params] = useSearchParams();
  const plan = PLAN_NAMES[params.get("plan") ?? "standard"] ?? PLAN_NAMES.standard;

  return (
    <PhoneFrame>
      <div className="flex-1 px-6 py-10 flex flex-col items-center text-center">
        <div className="w-24 h-24 rounded-full bg-success-subtle flex items-center justify-center mb-6">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 13L9 17L19 7"
              stroke="#16A34A"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h1 className="text-h2 mb-2">支付成功</h1>
        <p className="text-body text-text-secondary mb-6">
          已扣款 <span className="font-mono font-semibold">{plan.price}</span>
        </p>

        <div className="w-full bg-surface border border-border rounded-[14px] p-5 mb-6 text-left">
          <div className="flex items-center justify-between mb-3 pb-3 border-b border-border-subtle">
            <div>
              <div className="text-label text-text-secondary">套餐</div>
              <div className="text-h3">{plan.name}</div>
            </div>
            <span className="bg-success-subtle text-success-text text-caption font-semibold px-3 py-1 rounded-sm">
              已激活
            </span>
          </div>
          <ul className="space-y-2 text-caption">
            <li className="flex items-start gap-2">
              <span className="text-success mt-0.5">✓</span>
              <span>
                <span className="font-mono">{plan.tokens}</span> token 已到账
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-success mt-0.5">✓</span>
              <span>智能路由恢复，可继续对话</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-success mt-0.5">✓</span>
              <span>电子发票已发送至绑定邮箱</span>
            </li>
          </ul>
        </div>

        <div className="w-full space-y-2 mt-auto">
          <LinkButton to="/chat/balance" fullWidth>
            回到对话
          </LinkButton>
          <LinkButton to="/dashboard" variant="secondary" fullWidth>
            查看账户
          </LinkButton>
        </div>
      </div>
    </PhoneFrame>
  );
}
