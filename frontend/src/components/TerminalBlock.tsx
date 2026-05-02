import { useState, type ReactNode } from 'react';

export interface TerminalBlockProps {
  /** Primary line — rendered with a leading `$` prompt. Goes into copy. */
  cmd: string;
  /** Optional second line — env-var continuation rendered without a `$`
   * prefix. Long content (e.g. an API key) wraps inside the dark block
   * instead of being truncated. Joined into the copy payload after `\n`. */
  extra?: string;
  size?: 'sm' | 'lg';
  className?: string;
  /** Directional prompt rendered ABOVE the command lines, inside the same
   * dark card. Used on funnel surfaces where "what to do with this" needs
   * to land before the command itself. */
  prompt?: ReactNode;
  /** Async-load placeholder shown in place of `extra` while the key is
   * being fetched. Keeps the layout stable on /onboard/install. */
  loading?: boolean;
  /** Lazy-reveal hook. When provided, the visible `extra` line shows
   * whatever the parent passes (typically a masked key), but COPY first
   * runs this resolver to swap in the unmasked plaintext before writing
   * to the clipboard. Result is cached in component state so subsequent
   * COPY clicks skip the network. The visible `extra` also updates to
   * the resolved value once it arrives, so the user sees the plaintext
   * appear after their first copy.
   *
   * Used on /console (recurring page) to avoid eager-revealing on every
   * mount — newapi has rate-limits and the user usually doesn't need
   * the plaintext until they actually click copy. */
  extraResolver?: () => Promise<string>;
}

/**
 * Slock-pixel "copyable spell" block. Ink fill + 2px ink border + 4px hard
 * accent-colored offset shadow. Multi-line aware: when `extra` is set, the
 * COPY button moves to the bottom-right corner so the second line (often a
 * long API key) can wrap freely instead of truncating.
 */
export function TerminalBlock({
  cmd,
  extra,
  size = 'sm',
  className = '',
  prompt,
  loading = false,
  extraResolver,
}: TerminalBlockProps) {
  const [copied, setCopied] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolvedExtra, setResolvedExtra] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState(false);

  // What the user actually sees as the second line — masked input until
  // the resolver returns plaintext, then the plaintext sticks.
  const visibleExtra = resolvedExtra ?? extra;
  const copyExtra = resolvedExtra ?? extra;
  const copyText = copyExtra ? `${cmd}\n${copyExtra}` : cmd;

  async function handleCopy() {
    if (extraResolver && resolvedExtra === null) {
      setResolving(true);
      setResolveError(false);
      try {
        const resolved = await extraResolver();
        setResolvedExtra(resolved);
        await navigator.clipboard.writeText(`${cmd}\n${resolved}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        // Fall back to writing whatever we already had — the masked key
        // is still useful for users who only need to recognize/find their
        // key, and the error state surfaces a small visual cue.
        setResolveError(true);
        await navigator.clipboard.writeText(copyText);
      } finally {
        setResolving(false);
      }
      return;
    }
    await navigator.clipboard.writeText(copyText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const padding = size === 'lg' ? 'px-3.5 py-3 sm:px-5 sm:py-4' : 'px-3 py-2.5 sm:px-4 sm:py-3.5';
  const fontSize = size === 'lg' ? 'text-[11.5px] sm:text-[14px]' : 'text-[10.5px] sm:text-[12.5px]';

  // Multi-line layout: COPY at bottom-right corner, lines wrap freely.
  const isMulti = visibleExtra !== undefined || loading;

  const copyBtn = (
    <button
      onClick={handleCopy}
      aria-label="copy command"
      className={
        'font-mono text-[9.5px] sm:text-[10px] font-bold tracking-[0.14em] uppercase ' +
        'border-2 rounded ' +
        'px-2 py-0.5 sm:px-2.5 sm:py-1 ' +
        'shadow-[2px_2px_0_0_#E8692A] ' +
        'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#E8692A] ' +
        'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#E8692A] ' +
        'transition-all flex-shrink-0 ' +
        (copied
          ? 'bg-accent border-accent text-white shadow-[2px_2px_0_0_#1C1917] hover:shadow-[1px_1px_0_0_#1C1917] active:shadow-[0_0_0_0_#1C1917]'
          : 'bg-bg border-bg text-ink')
      }
    >
      {resolving ? '…' : copied ? '✓ 已复制' : resolveError ? '重试' : 'COPY'}
    </button>
  );

  // Long no-space tokens (API keys) wrap with word-break:break-all so each
  // line fills to the column edge and breaks uniformly at character
  // boundaries — matches the SkillBoss-style mobile reference. Without
  // this the browser prefers breaking at hyphens, leaving short visual
  // lines mid-token.
  const lineWrap = '[word-break:break-all]';

  const cmdRow = isMulti ? (
    <div className={`${padding} ${fontSize} font-mono leading-snug pr-3`}>
      <div className={`text-[#FFF8F0] ${lineWrap}`}>{cmd}</div>
      {loading ? (
        <div className={`mt-1.5 ${lineWrap} text-[#A89A8D] italic`}>
          正在为你生成 default key…
        </div>
      ) : (
        visibleExtra && (
          <div className={`mt-1.5 ${lineWrap} text-[#FFF8F0]`}>{visibleExtra}</div>
        )
      )}
      <div className="mt-2.5 flex justify-end">{copyBtn}</div>
    </div>
  ) : (
    <div className={`flex items-center gap-2.5 ${padding} ${fontSize} font-mono leading-snug`}>
      <span className={`text-[#FFF8F0] flex-1 ${lineWrap}`}>{cmd}</span>
      {copyBtn}
    </div>
  );

  if (!prompt) {
    return (
      <div
        className={`bg-ink rounded-md border-2 border-ink shadow-[4px_4px_0_0_#E8692A] ${className}`}
      >
        {cmdRow}
      </div>
    );
  }

  return (
    <div
      className={`bg-ink rounded-md border-2 border-ink shadow-[4px_4px_0_0_#E8692A] ${className}`}
    >
      <div
        className={`${padding} ${fontSize} font-mono leading-relaxed text-accent border-b border-white/10`}
      >
        {prompt}
      </div>
      {cmdRow}
    </div>
  );
}
