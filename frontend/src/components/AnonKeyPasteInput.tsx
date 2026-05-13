/**
 * Anonymous "paste your key" fallback for users who land on
 * `/install/manual` without a TokenBoss session.
 *
 * The logged-in flow (LoggedInKeyPicker → PrimaryImportButton) mints a
 * fresh "CC Switch" key server-side and ships back 5 deep-link URLs.
 * Anon users can't hit that endpoint, so we accept a key they already
 * have (e.g. they're on a friend's laptop with their key on a clipboard)
 * and build the same 5 `ccswitch://` URLs in the browser.
 *
 * Validation: TokenBoss keys are `sk-` + 48 alphanumeric chars (see
 * `backend/src/lib/newapi.ts` where the prefix is force-prepended on
 * reveal). We don't try to validate against the backend — the cost of
 * a wrong key is just "CC Switch imports a profile that won't work
 * until you fix it", which is recoverable.
 *
 * 参考: openspec/changes/gh-3-tokenboss-cc-switch-integration/design.md §7
 */

import { useId, useMemo, useState } from "react";
import { buildAllCCSwitchUrls } from "../lib/ccSwitchUrl";
import { triggerDeepLinkBatch } from "../lib/triggerDeepLink";

/** Strict shape: `sk-` + exactly 48 case-insensitive alphanumeric chars.
 *  Trailing whitespace would slip past a `.trim()` skip, so we anchor at
 *  both ends. */
const KEY_REGEX = /^sk-[A-Za-z0-9]{48}$/;

type FlowState = "idle" | "triggering";

export function AnonKeyPasteInput() {
  const [key, setKey] = useState("");
  const [state, setState] = useState<FlowState>("idle");
  const inputId = useId();
  const helpId = useId();

  const trimmed = key.trim();
  const isValid = useMemo(() => KEY_REGEX.test(trimmed), [trimmed]);
  // Don't show the format error until the user has typed something — an
  // empty input is "not yet started", not "format wrong".
  const showError = trimmed.length > 0 && !isValid;

  async function handleSubmit() {
    if (!isValid || state !== "idle") return;
    setState("triggering");
    try {
      const urls = buildAllCCSwitchUrls(trimmed);
      // Fire via hidden iframes per URL — successive window.location.assign
      // is silently dropped after the 1st. See lib/triggerDeepLink.ts.
      await triggerDeepLinkBatch(urls.map((u) => u.url));
    } finally {
      setState("idle");
    }
  }

  return (
    <div className="space-y-3">
      <label htmlFor={inputId} className="block text-[13px] font-bold text-ink">
        粘贴你的 TokenBoss API Key
      </label>
      <input
        id={inputId}
        type="text"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="sk-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
        aria-invalid={showError}
        aria-describedby={helpId}
        autoComplete="off"
        spellCheck={false}
        className={[
          "w-full font-mono text-[13px] text-ink bg-white",
          "border-2 rounded-md px-3 py-2.5",
          "focus:outline-none focus:ring-0",
          showError ? "border-red-ink" : "border-ink focus:border-accent",
        ].join(" ")}
      />
      <p id={helpId} className="text-[12px] text-ink-3 font-mono leading-relaxed">
        {showError
          ? "格式不对：Key 应该是 sk- 开头 + 48 位字母/数字（共 51 字符）。"
          : "Key 不会发到我们的服务器；点按钮后浏览器会把 5 张 CC Switch 卡片直接交给桌面 App。"}
      </p>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!isValid || state !== "idle"}
        className={[
          "inline-flex items-center justify-center",
          "bg-accent text-white font-semibold text-[15px] tracking-[-0.01em]",
          "px-6 py-3 rounded-md",
          "border-2 border-ink shadow-[3px_3px_0_0_#1C1917]",
          "hover:bg-accent-hover active:translate-x-[1px] active:translate-y-[1px] active:shadow-[2px_2px_0_0_#1C1917]",
          "disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-[3px_3px_0_0_#1C1917]",
          "transition-all duration-100",
        ].join(" ")}
      >
        {state === "triggering" ? "正在发送到 CC Switch…" : "导入到 CC Switch（5 个 CLI 全部）"}
      </button>
    </div>
  );
}
