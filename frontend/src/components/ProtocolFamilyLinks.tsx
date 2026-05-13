/**
 * Three "protocol family" cards pointing at protocol-specific docs
 * pages — meant for users who need deeper integration info than the
 * one-click CC Switch flow covers.
 *
 *   1. OpenAI-compat — covers OpenClaw / Hermes / Codex / OpenCode and
 *      anything else that takes a custom OpenAI endpoint.
 *   2. Anthropic-shim — Claude Code via TokenBoss's Messages-API ↔
 *      Chat-Completions conversion layer.
 *   3. Gemini-proxy — the one protocol still requiring CC Switch's
 *      local proxy (not part of the 5-CLI deep-link list).
 *
 * Renders 3 card-shaped <Link>s in a responsive grid. The target
 * routes are placeholders today; they'll resolve when the docs/*
 * subtree lands later in the gh-3 plan.
 *
 * 参考: openspec/changes/gh-3-tokenboss-cc-switch-integration/design.md §2
 */

import { Link } from "react-router-dom";

interface ProtocolFamily {
  id: string;
  title: string;
  desc: string;
  to: string;
}

const PROTOCOLS: ProtocolFamily[] = [
  {
    id: "openai-compat",
    title: "OpenAI-compat 协议",
    desc: "OpenClaw / Hermes / Codex / OpenCode / Cursor 等工具用",
    to: "/docs/protocols/openai-compat",
  },
  {
    id: "anthropic-shim",
    title: "Claude 协议接入",
    desc: "Claude Code via TokenBoss Anthropic 转换层",
    to: "/docs/protocols/anthropic-shim",
  },
  {
    id: "gemini-proxy",
    title: "Gemini 协议接入",
    desc: "Gemini CLI via CC Switch local proxy（唯一手动配置的）",
    to: "/docs/protocols/gemini-proxy",
  },
];

export function ProtocolFamilyLinks() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {PROTOCOLS.map((p) => (
        <Link
          key={p.id}
          to={p.to}
          className={[
            "block border-2 border-ink rounded-md p-4 bg-white",
            "shadow-[3px_3px_0_0_#1C1917]",
            "hover:bg-bg-alt active:translate-x-[1px] active:translate-y-[1px] active:shadow-[2px_2px_0_0_#1C1917]",
            "transition-all duration-100",
          ].join(" ")}
        >
          <h4 className="text-[14px] font-bold text-ink mb-1">{p.title}</h4>
          <p className="text-[12.5px] text-text-secondary leading-relaxed">{p.desc}</p>
        </Link>
      ))}
    </div>
  );
}
