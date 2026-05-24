/**
 * Footer-tier links to protocol-specific docs pages. Reference material
 * for power users; not part of the core install flow.
 *
 *   1. OpenAI-compat — OpenClaw / Hermes / Codex / OpenCode etc.
 *   2. Anthropic-shim — Claude Code via TokenBoss's Messages-API shim.
 *   3. Gemini-proxy — CC Switch local proxy fallback.
 *
 * Compact inline link list (was previously a 3-column equal-card grid —
 * dropped that on /design-review F4: 3-column card grids are an AI-slop
 * pattern and gave reference material more visual weight than the core
 * Step 1/Step 2 flow above).
 */

import { Link } from "react-router-dom";

interface ProtocolFamily {
  id: string;
  title: string;
  to: string;
}

const PROTOCOLS: ProtocolFamily[] = [
  { id: "openai-compat",  title: "OpenAI-compat 协议",  to: "/docs/protocols/openai-compat" },
  { id: "anthropic-shim", title: "Claude 协议接入",     to: "/docs/protocols/anthropic-shim" },
  { id: "gemini-proxy",   title: "Gemini 协议接入",     to: "/docs/protocols/gemini-proxy" },
];

export function ProtocolFamilyLinks() {
  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 text-[13px]">
      <span className="text-text-secondary font-mono text-[11.5px]">
        深入了解协议接入 ·
      </span>
      {PROTOCOLS.map((p, i) => (
        <span key={p.id} className="inline-flex items-baseline">
          <Link
            to={p.to}
            className="text-accent font-medium hover:underline"
          >
            {p.title} →
          </Link>
          {i < PROTOCOLS.length - 1 && (
            <span aria-hidden="true" className="text-ink/25 ml-5">·</span>
          )}
        </span>
      ))}
    </div>
  );
}
