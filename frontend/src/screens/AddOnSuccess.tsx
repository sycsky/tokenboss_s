import { useSearchParams } from "react-router-dom";
import { PhoneFrame } from "../components/PhoneFrame.js";
import { LinkButton } from "../components/Button.js";

const PACKS: Record<string, { name: string; price: string; tokens: string }> = {
  small: { name: "小包", price: "¥10", tokens: "100 万" },
  medium: { name: "中包", price: "¥49", tokens: "600 万" },
  large: { name: "大包", price: "¥199", tokens: "3000 万" },
};

/**
 * Screen 14 — Add-on pack purchase confirmation.
 */
export default function AddOnSuccess() {
  const [params] = useSearchParams();
  const pack = PACKS[params.get("pack") ?? "medium"] ?? PACKS.medium;

  return (
    <PhoneFrame>
      <div className="flex-1 px-6 py-10 flex flex-col items-center text-center">
        <div className="w-24 h-24 rounded-full bg-accent-subtle flex items-center justify-center mb-6">
          <span className="text-[52px]">⚡</span>
        </div>
        <h1 className="text-h2 mb-2">加量成功</h1>
        <p className="text-body text-text-secondary mb-6">
          已扣款 <span className="font-mono font-semibold">{pack.price}</span>
        </p>

        <div className="w-full bg-text-primary text-white rounded-[14px] p-5 mb-6 text-left">
          <div className="text-caption text-white/60 mb-1">当前余额</div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="font-mono text-[34px] font-semibold">
              {pack.tokens}
            </span>
            <span className="text-caption text-white/60">token · 新增</span>
          </div>
          <div className="h-px bg-white/10 my-3" />
          <ul className="space-y-1.5 text-caption">
            <li className="flex items-center gap-2">
              <span className="text-accent">✓</span>
              <span>加量包已生效</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-accent">✓</span>
              <span>不影响原有订阅周期</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-accent">✓</span>
              <span>按旧规则 30 天有效</span>
            </li>
          </ul>
        </div>

        <LinkButton to="/chat/balance" fullWidth className="mt-auto">
          返回对话
        </LinkButton>
      </div>
    </PhoneFrame>
  );
}
