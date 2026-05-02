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
 *
 * SECURITY: this is observability-grade attribution, not authentication.
 * Any client can set `X-Source` or forge a `User-Agent`. Do NOT gate
 * billing, quota, or access control on the resolved slug.
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

// Match the slug only as the major UA token name, potentially with a short
// dash-separated qualifier (e.g., openclaw-cli, hermes-sdk), then version.
// Prevents 'hermesjs/2.0' → 'hermes' or 'codex-archive-bot' → 'codex'.
// Pattern: (start|space) + slug + (optional -qualifier) + (space|slash|end)
const UA_PATTERNS: Array<[RegExp, string]> = [
  [/(?:^|\s)openclaw(?:-[a-z]+)?(?:\s|\/|$)/i, 'openclaw'],
  [/(?:^|\s)hermes(?:-[a-z]+)?(?:\s|\/|$)/i,   'hermes'],
  [/(?:^|\s)claude[-_]?code(?:-[a-z]+)?(?:\s|\/|$)/i, 'claude-code'],
  [/(?:^|\s)codex(?:-[a-z]+)?(?:\s|\/|$)/i,    'codex'],
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

  const fromHeader = parseSourceHeader(get('x-source'));
  if (fromHeader) return fromHeader;

  const fromUa = parseUaSource(get('user-agent'));
  if (fromUa) return fromUa;

  // Diagnostic log — when attribution falls through to 'other', record
  // the User-Agent so missing patterns are visible in the Zeabur logs.
  // Sample the first 200 chars to avoid log spam from giant UAs.
  // Drop when we've solidified UA coverage across all major Agent clients.
  const ua = get('user-agent');
  if (ua) {
    console.info('[source-attribution] fallback=other', {
      ua: ua.slice(0, 200),
    });
  }
  return { slug: 'other', method: 'fallback' };
}
