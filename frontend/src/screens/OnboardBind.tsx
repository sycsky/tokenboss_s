import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PhoneFrame } from "../components/PhoneFrame.js";
import { Button } from "../components/Button.js";
import { BackButton } from "../components/BackButton.js";

/**
 * Screen 6 — Enter pair code into segmented input fields.
 * The design shows 6 boxes: `T B - 8 4 7 2` — so 4 alphanumeric slots with
 * a fixed `TB-` prefix label in front. We model this as 4 input cells.
 */
export default function OnboardBind() {
  const navigate = useNavigate();
  const [digits, setDigits] = useState(["", "", "", ""]);
  const refs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  const setDigit = (idx: number, value: string) => {
    const clean = value.toUpperCase().slice(-1);
    const next = [...digits];
    next[idx] = clean;
    setDigits(next);
    if (clean && idx < 3) refs[idx + 1].current?.focus();
  };

  const handleSubmit = () => {
    // For the mocked flow we don't actually verify anything — any 4
    // non-empty digits pass through to the success screen.
    if (digits.every((d) => d.length > 0)) {
      navigate("/onboard/success");
    }
  };

  const allFilled = digits.every((d) => d.length > 0);

  return (
    <PhoneFrame>
      <div className="flex-1 px-6 py-8 flex flex-col">
        <div className="mb-6">
          <BackButton />
        </div>

        <h1 className="text-h2 mb-2">输入配对码</h1>
        <p className="text-body text-text-secondary mb-8">
          在 Telegram 收到的 TB-XXXX 配对码
        </p>

        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="font-mono text-[24px] font-semibold text-text-secondary">
            TB
          </div>
          <div className="font-mono text-[24px] text-text-muted">-</div>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={refs[i]}
              value={d}
              onChange={(e) => setDigit(i, e.target.value)}
              maxLength={1}
              inputMode="numeric"
              className={[
                "w-11 h-14 text-center font-mono text-[24px] font-semibold rounded-sm",
                "border-[1.5px] transition-colors outline-none",
                d
                  ? "bg-accent-light border-accent text-accent"
                  : "bg-surface border-border text-text-primary focus:border-accent",
              ].join(" ")}
            />
          ))}
        </div>

        <Button
          variant="primary"
          fullWidth
          disabled={!allFilled}
          onClick={handleSubmit}
          className={allFilled ? "" : "opacity-50 cursor-not-allowed"}
        >
          确认绑定
        </Button>

        <div className="text-caption text-text-muted text-center mt-4">
          没收到配对码？
          <button
            onClick={() => navigate("/onboard/install")}
            className="text-accent hover:text-accent-hover ml-1"
          >
            重新运行安装命令
          </button>
        </div>
      </div>
    </PhoneFrame>
  );
}
