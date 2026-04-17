import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PhoneFrame } from "../components/PhoneFrame.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { BackButton } from "../components/BackButton.js";

interface Pack {
  id: "small" | "medium" | "large";
  name: string;
  price: string;
  tokens: string;
  perMillion: string;
  bestValue?: boolean;
}

const PACKS: Pack[] = [
  { id: "small", name: "小包", price: "¥10", tokens: "100 万 token", perMillion: "¥10.0 / 100 万" },
  {
    id: "medium",
    name: "中包",
    price: "¥49",
    tokens: "600 万 token",
    perMillion: "¥8.2 / 100 万",
    bestValue: true,
  },
  { id: "large", name: "大包", price: "¥199", tokens: "3000 万 token", perMillion: "¥6.6 / 100 万" },
];

/**
 * Screen 13 — One-shot add-on packs. Alternative to subscribing.
 */
export default function AddOns() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Pack["id"]>("medium");

  return (
    <PhoneFrame>
      <div className="flex-1 px-6 py-6 flex flex-col">
        <div className="mb-4">
          <BackButton />
        </div>

        <div className="bg-warning-subtle border border-warning/30 rounded-sm px-4 py-3 mb-6">
          <div className="text-label text-warning font-semibold">
            ⏱ 临时补量
          </div>
          <div className="text-caption text-text-secondary mt-1">
            不想升级套餐？买个加量包先顶着
          </div>
        </div>

        <h1 className="text-h2 mb-4">选择加量包</h1>

        <div className="space-y-3 mb-6">
          {PACKS.map((p) => (
            <Card
              key={p.id}
              tone={selected === p.id ? "active" : "default"}
              onClick={() => setSelected(p.id)}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="text-h3">{p.name}</div>
                    {p.bestValue && (
                      <span className="bg-accent text-white text-caption font-semibold px-2 py-0.5 rounded-sm">
                        性价比最高
                      </span>
                    )}
                  </div>
                  <div className="text-caption text-text-secondary mt-1">
                    {p.tokens}
                  </div>
                  <div className="text-caption text-text-muted font-mono mt-0.5">
                    {p.perMillion}
                  </div>
                </div>
                <div className="text-h2 font-bold">{p.price}</div>
              </div>
            </Card>
          ))}
        </div>

        <Button
          variant="primary"
          fullWidth
          onClick={() => navigate(`/billing/addon-success?pack=${selected}`)}
          className="mt-auto"
        >
          购买 {PACKS.find((p) => p.id === selected)?.name}
        </Button>
      </div>
    </PhoneFrame>
  );
}
