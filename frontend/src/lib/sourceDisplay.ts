/**
 * Display layer for `usage.records[*].source`. Backend ships normalized
 * lowercase slugs (per spec § 2 — `[a-z0-9-]{1,32}`); the frontend
 * maps known slugs to their brand-correct display names and titlecases
 * everything else.
 *
 * Mirrors the design of `formatModelName` — known list gets explicit
 * pretty names; unknown patterns are passed through with light cleanup
 * so we never lose information.
 */

const KNOWN_DISPLAY: Record<string, string> = {
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
  'claude-code': 'Claude Code',
  codex: 'Codex',
  other: 'Other',
};

export function formatSource(slug: string | null | undefined): string {
  if (!slug) return '—';
  const cleaned = slug.trim().toLowerCase();
  if (!cleaned) return '—';

  const known = KNOWN_DISPLAY[cleaned];
  if (known) return known;

  // Unknown slug — split by '-', titlecase each word.
  const parts = cleaned.split('-').filter(Boolean);
  if (parts.length === 0) return '—';
  return parts.map((p) => p[0]!.toUpperCase() + p.slice(1)).join(' ');
}
