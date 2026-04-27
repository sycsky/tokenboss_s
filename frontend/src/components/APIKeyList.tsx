import { api, ApiError, type ProxyKeySummary } from '../lib/api';

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
  /** Map of last-4-chars-of-key → derived stats, computed from /v1/usage. */
  keyStats: Map<string, KeyStats>;
  /** Called after create/revoke so the parent can refetch. */
  onChanged: () => void;
}

/**
 * Renders the user's TokenBoss proxy keys as flat rows. Each key now
 * shows a small "last used 5m ago · 142 次" footer when usage stats are
 * present, attributing real Agent activity to the specific key. Designed
 * to live inside a parent Slock-pixel card.
 */
export function APIKeyList({ keys, loadError, keyStats, onChanged }: APIKeyListProps) {
  async function handleCreate() {
    const label = prompt('Key 名称（可选）');
    if (label === null) return;
    try {
      const newKey = await api.createKey({ label: label.trim() || undefined });
      alert(`新 key（仅显示一次）:\n${newKey.key}`);
      onChanged();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : `创建失败: ${(e as Error).message}`);
    }
  }

  async function handleRevoke(keyId: string) {
    if (!confirm('吊销后该 key 立即失效，且无法恢复。确认吗？')) return;
    try {
      await api.deleteKey(keyId);
      onChanged();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : `吊销失败: ${(e as Error).message}`);
    }
  }

  if (loadError) return <div className="text-[12px] text-red-ink font-medium py-1">{loadError}</div>;

  return (
    <div>
      {keys.length === 0 && (
        <div className="font-mono text-[11px] text-[#A89A8D] py-2">还没有 Key</div>
      )}
      {keys.map((k, i) => {
        const last4 = k.key.slice(-4);
        const stats = keyStats.get(last4);
        return (
          <div
            key={k.keyId}
            className={`py-2.5 ${i < keys.length - 1 ? 'border-b border-ink/10' : ''}`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[12.5px] font-bold text-ink flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 border-2 border-ink rounded-full ${k.disabled ? 'bg-red-ink' : 'bg-lime-stamp'}`}
                />
                {k.label || 'default'}
              </span>
              {!k.disabled ? (
                <button
                  onClick={() => handleRevoke(k.keyId)}
                  className="font-mono text-[10px] font-bold tracking-wider uppercase px-1.5 py-0.5 border-2 border-ink rounded text-ink hover:bg-red-soft hover:text-red-ink transition-colors"
                >
                  吊销
                </button>
              ) : (
                <span className="font-mono text-[10px] font-bold tracking-wider uppercase px-1.5 py-0.5 border-2 border-[#D9CEC2] rounded text-[#A89A8D]">
                  已吊销
                </span>
              )}
            </div>
            <div className="font-mono text-[11px] text-ink bg-bg border-2 border-ink px-2 py-1.5 rounded truncate">
              {k.key}
            </div>
            <div className="font-mono text-[10px] text-[#A89A8D] mt-1 flex items-center justify-between gap-2">
              <span>创建于 {new Date(k.createdAt).toLocaleDateString('zh-CN')}</span>
              {stats ? (
                <span className="text-ink-2">
                  {timeAgo(stats.lastUsedAt)} · {stats.callCount} 次 · ${stats.totalSpent.toFixed(3)}
                </span>
              ) : (
                <span>未使用</span>
              )}
            </div>
          </div>
        );
      })}
      <button
        onClick={handleCreate}
        className={
          'w-full mt-3 px-4 py-2 bg-white border-2 border-dashed border-ink rounded ' +
          'text-[12.5px] font-bold tracking-tight text-ink ' +
          'shadow-[3px_3px_0_0_#1C1917] ' +
          'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
          'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
          'transition-all'
        }
      >
        + 创建新 Key
      </button>
    </div>
  );
}

function timeAgo(iso: string): string {
  const diffSec = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s 前`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m 前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h 前`;
  return `${Math.floor(diffSec / 86400)}d 前`;
}
