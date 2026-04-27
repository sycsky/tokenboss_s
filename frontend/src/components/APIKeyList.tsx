import { useEffect, useState } from 'react';
import { api, ApiError, type ProxyKeySummary } from '../lib/api';

/**
 * Slock-pixel list of the user's TokenBoss proxy keys (`tb_live_...`). Each
 * key sits in its own bordered card; the "+ 创建新 Key" affordance is a
 * dashed-border slot at the bottom that depresses on hover/active so it
 * feels like the rest of the system.
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
    if (label === null) return; // user cancelled
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

  if (loading) return <div className="text-[#A89A8D] text-sm">加载中…</div>;
  if (error) return <div className="text-[13px] text-red-ink font-medium">{error}</div>;

  return (
    <div className="space-y-2.5">
      {keys.map((k) => (
        <div
          key={k.keyId}
          className="bg-white border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917] p-3"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12.5px] font-bold text-ink flex items-center gap-1.5">
              <span
                className={`w-2 h-2 border-2 border-ink rounded-full ${k.disabled ? 'bg-red-ink' : 'bg-[#16A34A]'}`}
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
          <div className="font-mono text-[10px] text-[#A89A8D] mt-1.5">
            创建于 {new Date(k.createdAt).toLocaleDateString('zh-CN')}
          </div>
        </div>
      ))}
      <button
        onClick={handleCreate}
        className={
          'w-full px-4 py-2.5 bg-white border-2 border-dashed border-ink rounded-md ' +
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
