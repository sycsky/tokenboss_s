import { useState } from 'react';
import type { ProxyKeySummary } from '../lib/api';
import { isExpired, expiryLabel } from '../lib/keyExpiry';

export interface KeyStats {
  callCount: number;
  totalSpent: number;
  lastUsedAt: string;  // ISO
}

export interface APIKeyListProps {
  /** Keys passed in from the parent (Dashboard owns the list now). */
  keys: ProxyKeySummary[];
  /** Error string from the parent's load attempt, if any. */
  loadError: string | null;
  /** Map of key label → derived stats, computed from /v1/usage. */
  keyStats: Map<string, KeyStats>;
  /**
   * Per-keyId plaintext from the local cache (set by parent via
   * `getCachedKey`). Rows whose keyId is in this map render the full
   * plaintext value + a copy button. Rows NOT in the map render the
   * masked value with no copy affordance — there is no way for the
   * platform to surface plaintext on those rows.
   */
  cachedPlaintexts: Map<string, string>;
  /** Cap on rows rendered inline. Default 3. Anything beyond surfaces
   *  via the "see all" button which opens AllKeysModal. */
  maxInline?: number;
  /** Click on `+ 创建` — parent opens CreateKeyModal. */
  onCreateClick: () => void;
  /** Click on the trash icon — parent opens DeleteKeyModal pre-loaded with `target`. */
  onDeleteClick: (target: ProxyKeySummary) => void;
  /** Click on "查看全部 N 把 Key" — parent opens AllKeysModal. */
  onShowAllClick: () => void;
}

/**
 * Inline list of the user's TokenBoss proxy keys. Capped at `maxInline`
 * rows; anything more shows up via "查看全部 N 把 Key →" which opens
 * AllKeysModal.
 *
 * Plaintext + copy button only appear for rows whose keyId is in
 * `cachedPlaintexts` AND that are still usable (not expired, not disabled).
 * For everything else the platform shows a masked value and offers no
 * way to retrieve the plaintext — the only way to use a key on a new
 * device is to create a new one.
 */
export function APIKeyList({
  keys,
  loadError,
  keyStats,
  cachedPlaintexts,
  maxInline = 3,
  onCreateClick,
  onDeleteClick,
  onShowAllClick,
}: APIKeyListProps) {
  const visible = keys.slice(0, maxInline);
  const hidden = keys.length - visible.length;

  return (
    <div>
      {loadError && (
        <div className="text-[12px] text-red-ink font-medium py-1 mb-2">{loadError}</div>
      )}

      <button
        type="button"
        onClick={onCreateClick}
        className={
          'block text-center w-full mb-3 px-4 py-2 bg-white border-2 border-dashed border-ink rounded ' +
          'text-[12.5px] font-bold tracking-tight text-ink ' +
          'shadow-[3px_3px_0_0_#1C1917] ' +
          'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
          'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
          'transition-all'
        }
      >
        + 创建 API Key
      </button>

      {keys.length === 0 && (
        <div className="font-mono text-[11px] text-[#A89A8D] py-2 text-center">
          还没有 Key · 点上面 + 创建 一个
        </div>
      )}

      {visible.map((k, i) => (
        <KeyRow
          key={k.keyId}
          k={k}
          stats={keyStats.get(k.label || 'default')}
          plaintext={cachedPlaintexts.get(String(k.keyId))}
          onDeleteClick={onDeleteClick}
          isLast={i === visible.length - 1}
        />
      ))}

      {hidden > 0 && (
        <button
          type="button"
          onClick={onShowAllClick}
          className={
            'block w-full mt-2.5 px-3 py-2 font-mono text-[11px] tracking-tight text-ink ' +
            'bg-white border-2 border-ink rounded ' +
            'shadow-[2px_2px_0_0_#1C1917] ' +
            'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
            'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
            'transition-all'
          }
        >
          查看全部 {keys.length} 把 Key →
        </button>
      )}
    </div>
  );
}

/**
 * One row in the key list. Shared between the inline `APIKeyList` (above)
 * and the modal that lists everything (`AllKeysModal` in KeyModals.tsx).
 *
 * Visual treatment for "dead" rows (expired or disabled): the whole row
 * is dimmed via opacity-60, and the label + value get a strikethrough.
 * Combined with the gray status dot and the badge, you can spot them at
 * a glance.
 */
export interface KeyRowProps {
  k: ProxyKeySummary;
  stats: KeyStats | undefined;
  plaintext: string | undefined;
  isLast: boolean;
  onDeleteClick: (target: ProxyKeySummary) => void;
}

export function KeyRow({ k, stats, plaintext, isLast, onDeleteClick }: KeyRowProps) {
  const [copied, setCopied] = useState(false);
  const expired = isExpired(k);
  const dead = expired || !!k.disabled;
  const canCopy = !!plaintext && !dead;
  const dotClass = dead ? 'bg-[#A89A8D]' : 'bg-lime-stamp';
  // Visual: dim everything in a dead row, strikethrough on the label
  // + value box so it's unmistakable at a glance that the key is gone.
  const labelClass = dead
    ? 'truncate line-through text-[#A89A8D]'
    : 'truncate text-ink';
  const valueClass = dead
    ? 'flex-1 min-w-0 font-mono text-[11px] line-through text-[#A89A8D] bg-bg border-2 border-[#D9CEC2] px-2 py-1.5 rounded truncate'
    : 'flex-1 min-w-0 font-mono text-[11px] text-ink bg-bg border-2 border-ink px-2 py-1.5 rounded truncate';

  async function handleCopy() {
    if (!plaintext) return;
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can long-press to select on mobile */
    }
  }

  return (
    <div
      className={
        `py-2.5 ${isLast ? '' : 'border-b border-ink/10'} ` +
        (dead ? 'opacity-60' : '')
      }
    >
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <span className="text-[12.5px] font-bold flex items-center gap-1.5 min-w-0">
          <span
            className={`w-2 h-2 border-2 border-ink rounded-full flex-shrink-0 ${dotClass}`}
          />
          <span className={labelClass}>{k.label || 'default'}</span>
        </span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {expired && (
            <span className="font-mono text-[10px] font-bold tracking-wider uppercase px-1.5 py-0.5 border-2 border-[#D9CEC2] rounded text-[#A89A8D]">
              已过期
            </span>
          )}
          {!expired && k.disabled && (
            <span className="font-mono text-[10px] font-bold tracking-wider uppercase px-1.5 py-0.5 border-2 border-[#D9CEC2] rounded text-[#A89A8D]">
              已吊销
            </span>
          )}
          <button
            type="button"
            onClick={() => onDeleteClick(k)}
            aria-label={`删除 ${k.label || 'default'}`}
            className={
              'flex-shrink-0 w-6 h-6 inline-flex items-center justify-center border-2 border-ink rounded ' +
              'text-ink hover:bg-red-soft hover:text-red-ink transition-colors'
            }
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <span className={valueClass}>
          {/* Show plaintext only when cached AND usable. Dead rows fall
              back to the mask even if cache still has them — there's no
              point leaking a dead value into the DOM. */}
          {canCopy ? plaintext : k.key}
        </span>
        {canCopy && (
          <button
            type="button"
            onClick={handleCopy}
            aria-label={`复制 ${k.label || 'default'}`}
            className={
              'flex-shrink-0 px-2 py-1.5 border-2 rounded font-mono text-[10px] font-bold tracking-[0.14em] uppercase ' +
              'shadow-[2px_2px_0_0_#1C1917] ' +
              'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
              'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
              'transition-all ' +
              (copied
                ? 'bg-accent border-accent text-white'
                : 'bg-white border-ink text-ink')
            }
          >
            {copied ? '✓' : <CopyIcon />}
          </button>
        )}
      </div>

      <div className="font-mono text-[10px] text-[#A89A8D] mt-1 flex items-center justify-between gap-2">
        <span>
          创建于 {new Date(k.createdAt).toLocaleDateString('zh-CN')} · {expiryLabel(k)}
        </span>
        {stats ? (
          <span className="text-ink-2">
            {timeAgo(stats.lastUsedAt)} · {stats.callCount} 次 · ${stats.totalSpent.toFixed(6)}
          </span>
        ) : (
          <span>未使用</span>
        )}
      </div>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="3.5" y="3.5" width="6" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 7.5V2.5C2 2.22 2.22 2 2.5 2H7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2.5 3.5H9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4.5 3.5V2.5C4.5 2.22 4.72 2 5 2H7C7.28 2 7.5 2.22 7.5 2.5V3.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3.5 3.5L4 9.5C4 9.78 4.22 10 4.5 10H7.5C7.78 10 8 9.78 8 9.5L8.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function timeAgo(iso: string): string {
  const diffSec = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s 前`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m 前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h 前`;
  return `${Math.floor(diffSec / 86400)}d 前`;
}
