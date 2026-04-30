/**
 * Backend stores model identifiers as the lowercase canonical form upstream
 * APIs expect (e.g. `gpt-5.4-mini`, `claude-sonnet-4-7`). Those strings are
 * great for routing and bad for users — display surfaces should render the
 * brand-cased version (`GPT-5.4 Mini`, `Claude Sonnet 4.7`).
 *
 * Pure transform; no side effects. Unknown patterns pass through unchanged
 * so we never silently lose a model name we didn't anticipate.
 */

const FAMILY_DISPLAY: Record<string, string> = {
  claude: 'Claude',
  gemini: 'Gemini',
  qwen: 'Qwen',
  deepseek: 'DeepSeek',
  doubao: 'Doubao',
  glm: 'GLM',
  yi: 'Yi',
  kimi: 'Kimi',
};

const TIER_DISPLAY: Record<string, string> = {
  mini: 'Mini',
  nano: 'Nano',
  pro: 'Pro',
  ultra: 'Ultra',
  flash: 'Flash',
  haiku: 'Haiku',
  sonnet: 'Sonnet',
  opus: 'Opus',
  codex: 'Codex',
  thinking: 'Thinking',
  preview: 'Preview',
  turbo: 'Turbo',
  plus: 'Plus',
  max: 'Max',
};

function titlecase(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/** Join trailing version-like fragments with dots: ["4","7"] → "4.7". */
function joinVersionParts(parts: string[]): string {
  return parts.join('.');
}

export function formatModelName(raw: string | null | undefined): string {
  if (!raw) return '—';
  const trimmed = raw.trim();
  if (!trimmed) return '—';

  // OpenAI o-series — lowercase 'o' is intentional brand styling
  // (e.g. o1, o3, o4-mini). Preserve the prefix.
  const oSeries = trimmed.match(/^(o\d+)(?:-(.+))?$/i);
  if (oSeries) {
    const head = oSeries[1]!.toLowerCase();
    const tail = oSeries[2];
    if (!tail) return head;
    const tierKey = tail.toLowerCase();
    const tierLabel = TIER_DISPLAY[tierKey] ?? titlecase(tail);
    return `${head} ${tierLabel}`;
  }

  // GPT family — gpt-5.4-mini → GPT-5.4 Mini
  const gpt = trimmed.match(/^gpt[-_]?([\d.]+(?:[-_]\d+)*)(?:[-_](.+))?$/i);
  if (gpt) {
    const versionRaw = gpt[1]!;
    const tail = gpt[2];
    // Backend sometimes stores '5-4' instead of '5.4' — normalize.
    const version = versionRaw.replace(/[-_]/g, '.');
    if (!tail) return `GPT-${version}`;
    const tierKey = tail.toLowerCase();
    const tierLabel = TIER_DISPLAY[tierKey] ?? titlecase(tail);
    return `GPT-${version} ${tierLabel}`;
  }

  // Family-prefix forms (claude / gemini / qwen / deepseek / etc.)
  // Patterns: <family>-<tier>(-<version>)?  OR  <family>-<version>(-<tier>)?
  // Examples: claude-sonnet-4-7, claude-opus-4, gemini-2.0-pro,
  //           gemini-2-5-flash, deepseek-v3, qwen-3-72b
  const family = trimmed.match(/^([a-z]+)[-_](.+)$/i);
  if (family) {
    const familyKey = family[1]!.toLowerCase();
    const familyLabel = FAMILY_DISPLAY[familyKey];
    if (familyLabel) {
      const rest = family[2]!;
      const parts = rest.split(/[-_]/).filter(Boolean);
      // Walk through parts and classify each as tier (Sonnet / Pro / etc.) or
      // version fragment (4 / 7 / 2.0 / v3). Group consecutive version-fragments
      // and join with dots.
      const out: string[] = [];
      let versionBuf: string[] = [];
      const flushVersion = () => {
        if (versionBuf.length > 0) {
          out.push(joinVersionParts(versionBuf));
          versionBuf = [];
        }
      };
      for (const part of parts) {
        const lower = part.toLowerCase();
        const tierLabel = TIER_DISPLAY[lower];
        if (tierLabel) {
          flushVersion();
          out.push(tierLabel);
        } else if (/^v?[\d.]+[a-z]?$/i.test(part)) {
          // Version-like: '4', '7', '2.0', 'v3', '72b'
          versionBuf.push(part.replace(/^v/i, ''));
        } else {
          // Unknown token — title-case it and emit as-is
          flushVersion();
          out.push(titlecase(part));
        }
      }
      flushVersion();
      return [familyLabel, ...out].join(' ');
    }
  }

  // Fallback: return the raw string unchanged so we never lose info.
  return trimmed;
}
