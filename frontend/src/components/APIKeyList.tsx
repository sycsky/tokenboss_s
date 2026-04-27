import { useEffect, useState } from 'react';
import { api, ApiError, type ProxyKeySummary } from '../lib/api';

/**
 * Renders the user's TokenBoss proxy keys as flat rows. Designed to live
 * inside a parent Slock-pixel card (e.g. the merged 接入 section on
 * Dashboard) — so each key is a row separated by hairlines, not its own
 * bordered card. The "+ 创建新 Key" CTA is a dashed-border pill that
 * matches the agent-add CTA above it.
 */
export function APIKeyList() {
  const [keys, setKeys] = useState<ProxyKeySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listKeys();
      setKeys(data.keys);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `加载失败: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCreate() {
    const label = prompt('Key 名称（可选）');
    if (label === null) return;
    try {
      const newKey = await api.createKey({ label: label.trim() || undefined });
      alert(`新 key（仅显示一次）:\n${newKey.key}`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `创建失败: ${(e as Error).message}`);
    }
  }

  async function handleRevoke(keyId: string) {
    if (!confirm('吊销后该 key 立即失效，且无法恢复。确认吗？')) return;
    try {
      await api.deleteKey(keyId);
      setKeys(keys.filter((k) => k.keyId !== keyId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `吊销失败: ${(e as Error).message}`);
    }
  }

  if (loading) return <div className="text-[#A89A8D] text-[12px] py-1">加载中…</div>;
  if (error) return <div className="text-[12px] text-red-ink font-medium py-1">{error}</div>;

  return (
    <div>
      {keys.length === 0 && (
        <div className="font-mono text-[11px] text-[#A89A8D] py-2">还没有 Key</div>
      )}
      {keys.map((k, i) => (
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
          <div className="font-mono text-[10px] text-[#A89A8D] mt-1">
            创建于 {new Date(k.createdAt).toLocaleDateString('zh-CN')}
          </div>
        </div>
      ))}
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
