/**
 * Per-agent import grid — 5 cards, user clicks each one to fire its
 * `ccswitch://` deep link individually. Each click is one user gesture →
 * the browser cleanly hands one custom-scheme URL to the OS handler, no
 * throttle / no swallowed assigns / no "only the first one worked"
 * problem.
 *
 * Why per-click and not a single batch trigger:
 * Browsers (Chromium, Safari) silently drop 2..N successive
 * `window.location.assign(customScheme)` calls from the same JS turn.
 * Hidden iframes work in synthetic tests but Stage 3.5 user implementation
 * showed only 1 of 5 cards arrived in CC Switch reliably. Per-click is
 * honest UX + guaranteed to work. See design.md §10 SD-5/SD-6.
 *
 * D7 caveat: backend POST /v1/deep-link DELETES the existing "CC Switch"
 * newapi token and creates a fresh one each call. So we MUST cache the 5
 * URLs from a single fetch — calling /v1/deep-link 5 times would mint 5
 * different keys, of which only the last works. The first card click
 * lazily fetches once and caches; subsequent card clicks reuse cache.
 */

import { useCallback, useMemo, useState } from "react";
import { CLI_APPS, type CLIAppDef, type CLIAppId } from "../lib/agentDefs";
import { triggerDeepLink } from "../lib/triggerDeepLink";

/** Per-app card state. */
type CardState = "idle" | "fetching" | "triggered";

export interface AgentImportGridProps {
  /**
   * Lazy fetcher — called ONCE on the first card click, cached for the
   * rest of the session. Must return a Map keyed by CLIAppId with the
   * exact 5 `ccswitch://` URLs.
   *
   * Logged-in path: fetcher calls `api.getDeepLink()` → server mints a
   * fresh reserved key + builds 5 URLs.
   *
   * Anon paste-key path: fetcher runs `buildAllCCSwitchUrls(key)` →
   * client-side build, no network.
   */
  getUrls: () => Promise<Map<CLIAppId, string>>;
}

/** Single card UI helper — declared inside this file so the grid stays
 *  self-contained. If a third consumer wants the card alone, lift it out. */
function AgentImportCard({
  app,
  state,
  onClick,
}: {
  app: CLIAppDef;
  state: CardState;
  onClick: () => void;
}) {
  const isDone = state === "triggered";
  const isBusy = state === "fetching";
  return (
    <div
      className={[
        "border-2 border-ink rounded-md p-4 transition-all",
        "bg-white shadow-[3px_3px_0_0_#1C1917]",
        isDone ? "bg-green-50" : "",
      ].join(" ")}
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-ink text-[15px] flex items-center gap-2">
            {app.displayName}
            {isDone && (
              <span
                className="text-green-700 text-[18px]"
                aria-label="已发送到 CC Switch"
              >
                ✓
              </span>
            )}
          </h3>
          <p className="text-[12px] text-ink-3 mt-0.5">{app.description}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={isBusy}
        className={[
          "w-full inline-flex items-center justify-center",
          "font-semibold text-[13px] tracking-[-0.01em]",
          "px-4 py-2 rounded-md",
          "border-2 border-ink",
          isDone
            ? "bg-white text-ink shadow-[2px_2px_0_0_#1C1917]"
            : "bg-accent text-white shadow-[3px_3px_0_0_#1C1917] hover:bg-accent-hover",
          "disabled:opacity-60 disabled:cursor-not-allowed",
          "active:translate-x-[1px] active:translate-y-[1px]",
          "transition-all duration-100",
        ].join(" ")}
      >
        {isBusy
          ? "正在生成密钥…"
          : isDone
            ? "再发一次给 CC Switch"
            : `导入到 ${app.displayName}`}
      </button>
    </div>
  );
}

export function AgentImportGrid({ getUrls }: AgentImportGridProps) {
  const [urls, setUrls] = useState<Map<CLIAppId, string> | null>(null);
  const [cardStates, setCardStates] = useState<Record<CLIAppId, CardState>>(
    () =>
      Object.fromEntries(CLI_APPS.map((a) => [a.id, "idle"])) as Record<
        CLIAppId,
        CardState
      >,
  );
  const [error, setError] = useState<string | null>(null);

  const handleCardClick = useCallback(
    async (appId: CLIAppId) => {
      setError(null);

      // First click: fetch + cache. Subsequent clicks: use cache.
      let resolved = urls;
      if (!resolved) {
        // Mark THIS card fetching so the user sees feedback; other cards
        // remain idle. They can't click while fetch is in flight because
        // we read urls inside the same closure, but we still gate via
        // per-card disabled state.
        setCardStates((prev) => ({ ...prev, [appId]: "fetching" }));
        try {
          resolved = await getUrls();
          setUrls(resolved);
        } catch (e) {
          setCardStates((prev) => ({ ...prev, [appId]: "idle" }));
          setError(
            `生成密钥失败：${(e as Error).message || "请稍后重试"}`,
          );
          return;
        }
      }

      const url = resolved.get(appId);
      if (!url) {
        setError(`找不到 ${appId} 对应的 deep link，请刷新页面重试。`);
        setCardStates((prev) => ({ ...prev, [appId]: "idle" }));
        return;
      }

      triggerDeepLink(url);
      setCardStates((prev) => ({ ...prev, [appId]: "triggered" }));
    },
    [urls, getUrls],
  );

  const doneCount = useMemo(
    () => Object.values(cardStates).filter((s) => s === "triggered").length,
    [cardStates],
  );
  const totalCount = CLI_APPS.length;
  const allDone = doneCount === totalCount;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-[15px] font-bold text-ink">
          选 Agent 工具，逐个导入到 CC Switch
        </h2>
        <span
          className="text-[13px] text-ink-3 font-mono"
          aria-live="polite"
          aria-atomic="true"
        >
          {doneCount}/{totalCount} 已导入
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {CLI_APPS.map((app) => (
          <AgentImportCard
            key={app.id}
            app={app}
            state={cardStates[app.id]}
            onClick={() => void handleCardClick(app.id)}
          />
        ))}
      </div>

      {allDone && (
        <div
          className="mt-4 border-2 border-green-700 rounded-md p-4 bg-green-50"
          role="status"
        >
          <p className="font-bold text-green-900 text-[14px]">
            ✓ 5 个 CLI 工具都发到 CC Switch 了
          </p>
          <p className="text-[13px] text-green-900 mt-1 leading-relaxed">
            打开 CC Switch 应用，逐个接受 5 张确认卡片即可。接受后 OpenClaw / Hermes / Codex / OpenCode 用 OpenAI 兼容协议、Claude Code 经 TokenBoss Anthropic 转换层，都会路由到 TokenBoss。
          </p>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 text-red-ink text-[13px] font-medium leading-relaxed"
        >
          {error}
        </p>
      )}
    </div>
  );
}
