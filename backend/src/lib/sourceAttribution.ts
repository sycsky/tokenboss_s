/**
 * Per-call source attribution: resolve which Agent (OpenClaw / Hermes /
 * Claude Code / Codex / third-party / other) made a chat completion
 * request, given its incoming HTTP headers.
 *
 * Resolution chain (first match wins):
 *   1. Explicit `X-Source: <slug>` header (validated against [a-z0-9-]{1,32})
 *   2. `User-Agent` regex match against the four canonical agent patterns
 *   3. Fallback to `'other'`
 *
 * The chat-completions line guarantees a non-null source by always
 * falling through to 'other' — downstream / frontend never has to
 * handle null for chat traffic.
 */

import type { SourceMethod } from './store.js';

export interface ResolvedSource {
  slug: string;
  method: SourceMethod;
}

const MAX_SLUG_LEN = 32;
const SLUG_RE = /^[a-z0-9-]+$/;

/** Normalize + validate an X-Source header value.
 *  Returns null when the input is missing, empty, or contains illegal chars. */
export function parseSourceHeader(raw: string | undefined): ResolvedSource | null {
  if (!raw) return null;
  const lowered = raw.trim().toLowerCase();
  if (!lowered) return null;
  const truncated = lowered.slice(0, MAX_SLUG_LEN);
  if (!SLUG_RE.test(truncated)) return null;
  return { slug: truncated, method: 'header' };
}

// UA → slug mapping. First match wins. Patterns are intentionally loose —
// SDKs may include version suffixes, platform info, etc.
const UA_PATTERNS: Array<[RegExp, string]> = [
  [/openclaw/i, 'openclaw'],
  [/hermes/i, 'hermes'],
  [/claude.?code/i, 'claude-code'],  // matches 'claude-code', 'claude_code', 'claudecode'
  [/codex/i, 'codex'],
];

/** Match incoming User-Agent against the 4 canonical agent patterns. */
export function parseUaSource(ua: string | undefined): ResolvedSource | null {
  if (!ua) return null;
  for (const [re, slug] of UA_PATTERNS) {
    if (re.test(ua)) return { slug, method: 'ua' };
  }
  return null;
}

/** Headers map (case-insensitive lookup tolerated). Falls back to 'other'
 *  so chat-completions source is never null. */
export function resolveSource(headers: Record<string, string | undefined>): ResolvedSource {
  // Lambda lowercases header names, but be defensive about case-mixed inputs.
  const get = (name: string): string | undefined => {
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === lower) return v;
    }
    return undefined;
  };

  return (
    parseSourceHeader(get('x-source')) ??
    parseUaSource(get('user-agent')) ??
    { slug: 'other', method: 'fallback' }
  );
}
