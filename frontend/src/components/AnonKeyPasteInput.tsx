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
        {/* Cold-start affordances for users without a key handy. Both open
            in a new tab so the current paste flow context isn't lost. The
            console route only shows masked key metadata — by policy we
            don't re-reveal plaintext for previously-issued keys, so users
            who lost their key must "快速生成" a new one. */}
        <p className="text-[12px] text-ink-3 leading-relaxed">
          还没有 Key？
          <a
            href="/register"
            target="_blank"
            rel="noreferrer"
            className="text-accent font-semibold hover:underline mx-1"
          >
            注册免费拿（送 $10） ↗
          </a>
          <span className="text-ink/30 mx-1.5">·</span>
          已有账户？
          <a
            href="/login"
            target="_blank"
            rel="noreferrer"
            className="text-accent font-semibold hover:underline mx-1"
          >
            登录看我的 Keys ↗
          </a>
        </p>
      </div>

      {/* Grid is always visible so users see the 5 target CLIs up front
          (Step 2 framing). When the key isn't a valid TokenBoss key yet,
          we disable card clicks and show a hint above the grid. Re-mount
          on transition between disabled/enabled so the cached-URL state
          inside the grid resets cleanly when a fresh key arrives. */}
      <div className="pt-2 border-t-2 border-stone-200">
        <AgentImportGrid
          key={isValid ? trimmed : "anon-pending"}
          getUrls={getUrls}
          disabled={!isValid}
          disabledReason="先在上面粘贴你的 TokenBoss API Key，下面 5 张就能点了。"
        />
      </div>
    </div>
  );
}
