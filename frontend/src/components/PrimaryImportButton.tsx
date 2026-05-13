/**
 * One-click CC Switch import button — primary CTA for logged-in users on
 * `/install/manual`.
 *
 * Click flow (gh-3 design.md §7 state machine):
 *   idle ──click──▶ fetching ──POST /v1/deep-link──▶ triggering
 *     ▲                                                  │
 *     └──── reset (success or error) ◀──── 5 × window.location.assign ──┘
 *
 * The 200ms gap between assigns is empirical: browsers (esp. Chromium on
 * macOS) silently drop URL-scheme handoffs that arrive faster than
 * ~50–150ms apart, so we space them out generously. CC Switch displays a
 * confirmation card per import — the user accepts the 5 cards in
 * sequence and ends up with 5 provider profiles.
 *
 * Error UX: rather than a toast (no existing toast infra), we render a
 * `role="alert"` paragraph below the button. The button itself stays
 * disabled only during the active flight — on failure it re-enables so
 * the user can retry. Backend D7 means each retry mints a fresh key, so
 * retrying is safe.
 */

import { useState } from "react";
import { ApiError } from "../lib/api";
import { api } from "../lib/api";
import { triggerDeepLinkBatch } from "../lib/triggerDeepLink";

type FlowState = "idle" | "fetching" | "triggering";

const STATE_LABEL: Record<FlowState, string> = {
  idle: "一键导入到 CC Switch（5 个 CLI 全部）",
  fetching: "正在生成密钥…",
  triggering: "正在发送到 CC Switch…",
};

export function PrimaryImportButton() {
  const [state, setState] = useState<FlowState>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setState("fetching");
    try {
      const { deep_links } = await api.getDeepLink();
      setState("triggering");
      // Fire 5 ccswitch:// URLs via per-URL hidden iframes (not
      // window.location.assign, which silently drops 2..N successive
      // custom-scheme handoffs — see lib/triggerDeepLink.ts header for
      // the gory details). All 5 CC Switch confirmation cards now
      // reliably appear.
      await triggerDeepLinkBatch(deep_links.map((dl) => dl.url));
    } catch (err) {
      // ApiError carries a friendly Chinese-tilted message; raw Errors
      // fall back to their .message. Either way we phrase the failure
      // so the user understands "click again to retry".
      const base = err instanceof ApiError ? err.message : (err as Error).message;
      setError(`导入失败：${base || "请稍后重试"}`);
    } finally {
      setState("idle");
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={state !== "idle"}
        className={[
          "inline-flex items-center justify-center",
          "bg-accent text-white font-semibold text-[15px] tracking-[-0.01em]",
          "px-6 py-3 rounded-md",
          "border-2 border-ink shadow-[3px_3px_0_0_#1C1917]",
          "hover:bg-accent-hover active:translate-x-[1px] active:translate-y-[1px] active:shadow-[2px_2px_0_0_#1C1917]",
          "disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-[3px_3px_0_0_#1C1917]",
          "transition-all duration-100",
        ].join(" ")}
      >
        {STATE_LABEL[state]}
      </button>
      {error && (
        <p
          role="alert"
          className="text-red-ink text-[13px] mt-3 font-medium leading-relaxed"
        >
          {error}
        </p>
      )}
    </div>
  );
}
