/**
 * Anonymous "paste your key" fallback for users who land on
 * `/install/manual` without a TokenBoss session.
 *
 * Flow: user pastes a `sk-` + 48-char key → after validation, the
 * AgentImportGrid renders below with a client-side URL builder
 * (buildAllCCSwitchUrls — no backend call). User then clicks each agent
 * card individually to trigger that CLI's `ccswitch://` import (one
 * gesture per URL → browser cleanly hands off to OS handler).
 *
 * Validation: TokenBoss keys are `sk-` + 48 alphanumeric chars (see
 * `backend/src/lib/newapi.ts` where the prefix is force-prepended on
 * reveal). We don't try to validate against the backend — the cost of a
 * wrong key is just "CC Switch imports a profile that won't work until
 * you fix it", which is recoverable.
 *
 * 参考: openspec/changes/gh-3-tokenboss-cc-switch-integration/design.md §7
 */

import { useCallback, useId, useMemo, useState } from "react";
import { buildAllCCSwitchUrls } from "../lib/ccSwitchUrl";
import { AgentImportGrid } from "./AgentImportGrid";
import type { CLIAppId } from "../lib/agentDefs";

/** Strict shape: `sk-` + exactly 48 case-insensitive alphanumeric chars.
 *  Trailing whitespace would slip past a `.trim()` skip, so we anchor at
 *  both ends. */
const KEY_REGEX = /^sk-[A-Za-z0-9]{48}$/;

export function AnonKeyPasteInput() {
  const [key, setKey] = useState("");
  const inputId = useId();
  const helpId = useId();

  const trimmed = key.trim();
  const isValid = useMemo(() => KEY_REGEX.test(trimmed), [trimmed]);
  // Don't show the format error until the user has typed something — an
  // empty input is "not yet started", not "format wrong".
  const showError = trimmed.length > 0 && !isValid;

  const getUrls = useCallback(async (): Promise<Map<CLIAppId, string>> => {
    const urls = buildAllCCSwitchUrls(trimmed);
    return new Map(urls.map((u) => [u.app, u.url]));
  }, [trimmed]);

  return (
    <div className="space-y-4">
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
            : "Key 不会发到我们的服务器；浏览器直接把 5 张 CC Switch 卡片交给桌面 App。"}
        </p>
      </div>

      {isValid && (
        // Re-mount the grid on key change so cached URLs don't go stale
        // (the cache lives inside AgentImportGrid state).
        <div className="pt-2 border-t-2 border-stone-200">
          <AgentImportGrid key={trimmed} getUrls={getUrls} />
        </div>
      )}
    </div>
  );
}
