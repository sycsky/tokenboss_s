import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PhoneFrame } from "../components/PhoneFrame.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { BackButton } from "../components/BackButton.js";

interface Plan {
  id: "basic" | "standard" | "pro";
  name: string;
  price: string;
  priceLabel: string;
  tokens: string;
  features: string[];
  popular?: boolean;
}

const PLANS: Plan[] = [
  {
    id: "basic",
    name: "基础版",
    price: "¥39",
    priceLabel: "/月",
    tokens: "约 500 万 token",
    features: ["日上限 ¥5", "全部模型", "智能路由"],
  },
  {
    id: "standard",
    name: "标准版",
    price: "¥129",
    priceLabel: "/月",
    tokens: "约 2000 万 token",
    features: ["日上限 ¥15", "全部模型", "智能路由", "优先通道"],
    popular: true,
  },
  {
    id: "pro",
    name: "专业版",
    price: "¥429",
    priceLabel: "/月",
    tokens: "约 8000 万 token",
    features: ["日上限 ¥50", "全部模型", "智能路由", "优先通道", "专属支持"],
  },
];

/**
 * Screen 10 — Plan selection. Entered from the low-balance alert (screen 9)
 * or from the dashboard upgrade CTA.
 */
export default function Plans() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Plan["id"]>("standard");

  return (
    <PhoneFrame>
      <div className="flex-1 px-6 py-6 flex flex-col">
        <div className="mb-4">
          <BackButton />
        </div>

        <div className="bg-danger-subtle border border-danger-border rounded-sm px-4 py-3 mb-6">
          <div className="text-label text-danger-text font-semibold">
            ⚠ 当前余额不足以完成下一次对话
          </div>
          <div className="text-caption text-danger-text/80 mt-1">
            选一个套餐继续，或买单次加量包
          </div>
        </div>

        <h1 className="text-h2 mb-4">选择套餐</h1>

        <div className="space-y-3 mb-6">
          {PLANS.map((p) => (
            <Card
              key={p.id}
              tone={selected === p.id ? "active" : "default"}
              onClick={() => setSelected(p.id)}
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="text-h3">{p.name}</div>
                    {p.popular && (
                      <span className="bg-accent text-white text-caption font-semibold px-2 py-0.5 rounded-sm">
                        最受欢迎
                      </span>
                    )}
                  </div>
                  <div className="text-caption text-text-secondary mt-1">
                    {p.tokens}
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-baseline">
                    <span className="text-h2 font-bold">{p.price}</span>
                    <span className="text-caption text-text-secondary">
                      {p.priceLabel}
                    </span>
                  </div>
                </div>
              </div>
              <ul className="space-y-1">
                {p.features.map((f) => (
                  <li
                    key={f}
                    className="text-caption text-text-secondary flex items-center gap-1.5"
                  >
                    <span className="text-success">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>

        <Button
          variant="primary"
          fullWidth
          onClick={() => navigate(`/billing/pay?plan=${selected}`)}
          className="mt-auto"
        >
          选择 {PLANS.find((p) => p.id === selected)?.name} · 去支付
        </Button>
      </div>
    </PhoneFrame>
  );
}
