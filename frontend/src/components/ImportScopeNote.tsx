/**
 * Static descriptive note that sets expectations for what happens when
 * the user clicks PrimaryImportButton — "you're about to import 5
 * providers; here's what each one means; here's what CC Switch will
 * show next".
 *
 * Sourced from the CLI_APPS catalog (single source of truth) so the
 * count and names stay correct if the list ever grows or shrinks.
 *
 * 参考: openspec/changes/gh-3-tokenboss-cc-switch-integration/design.md §7
 */

import { CLI_APPS } from "../lib/agentDefs";

export function ImportScopeNote() {
  const directApps = CLI_APPS.filter((a) => a.protocolFamily === "openai-compat")
    .map((a) => a.displayName)
    .join(" · ");
  const claudeApp = CLI_APPS.find((a) => a.id === "claude");
  const totalCount = CLI_APPS.length;

  return (
    <p className="text-[13px] text-text-secondary mt-3 leading-relaxed max-w-[640px]">
      本次会同时导入：<strong className="text-ink">{directApps}</strong>
      （OpenAI-compat 直连）
      {claudeApp && (
        <>
          {" + "}
          <strong className="text-ink">{claudeApp.displayName}</strong>
          （经 TokenBoss Anthropic 转换层）
        </>
      )}
      。CC Switch 会弹 <strong className="text-ink">{totalCount}</strong> 张确认卡片，逐个接受即可。
    </p>
  );
}
