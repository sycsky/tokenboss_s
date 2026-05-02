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
  /** Click on `+ 创建` — parent opens CreateKeyModal. */
  onCreateClick: () => void;
  /** Click on the trash icon — parent opens DeleteKeyModal pre-loaded with `target`. */
  onDeleteClick: (target: ProxyKeySummary) => void;
}

/**
 * Inline list of the user's TokenBoss proxy keys. Each row shows label,
 * masked key, expiry label, usage stats, and a delete button.
 *
 * NOTE: there is no "copy" affordance here on purpose. The plaintext
 * is shown exactly once (at create time, in RevealKeyModal); after that
 * the only place it survives is the per-device localStorage cache, used
 * by Dashboard's install spell. If a user needs the plaintext on a new
 * device, they create a new key.
 */
export function APIKeyList({ keys, loadError, keyStats, onCreateClick, onDeleteClick }: APIKeyListProps) {
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

      {keys.map((k, i) => {
        const stats = keyStats.get(k.label || 'default');
        const expired = isExpired(k);
        const dotClass = k.disabled || expired ? 'bg-[#A89A8D]' : 'bg-lime-stamp';
        return (
          <div
            key={k.keyId}
            className={`py-2.5 ${i < keys.length - 1 ? 'border-b border-ink/10' : ''}`}
          >
            <div className="flex items-center justify-between mb-1.5 gap-2">
              <span className="text-[12.5px] font-bold text-ink flex items-center gap-1.5 min-w-0">
                <span
                  className={`w-2 h-2 border-2 border-ink rounded-full flex-shrink-0 ${dotClass}`}
                />
                <span className="truncate">{k.label || 'default'}</span>
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
              <span className="flex-1 min-w-0 font-mono text-[11px] text-ink bg-bg border-2 border-ink px-2 py-1.5 rounded truncate">
                {k.key}
              </span>
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
      })}
    </div>
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
