import { useEffect, useState } from 'react';
import { api, ApiError, type ProxyKeySummary } from '../lib/api';

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
      setKeys(keys.filter(k => k.keyId !== keyId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `吊销失败: ${(e as Error).message}`);
    }
  }

  if (loading) return <div className="text-ink-3 text-sm">加载中…</div>;
  if (error) return <div className="text-sm text-red-500">{error}</div>;

  return (
    <div className="space-y-2">
      {keys.map(k => (
        <div key={k.keyId} className="bg-surface border border-border rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12.5px] font-bold flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${k.disabled ? 'bg-red-400' : 'bg-green-400'}`} />
              {k.label || 'default'}
            </span>
            {!k.disabled && (
              <button
                onClick={() => handleRevoke(k.keyId)}
                className="font-mono text-[10px] px-1.5 py-0.5 border border-border rounded text-ink-2 hover:text-red-500 hover:border-red-400"
              >
                吊销
              </button>
            )}
            {k.disabled && (
              <span className="font-mono text-[10px] px-1.5 py-0.5 border border-border rounded text-ink-3">
                已吊销
              </span>
            )}
          </div>
          <div className="font-mono text-[11px] text-ink-2 bg-surface-2 px-2 py-1.5 rounded border border-border truncate">
            {k.key}
          </div>
          <div className="font-mono text-[10px] text-ink-3 mt-1.5">
            创建于 {new Date(k.createdAt).toLocaleDateString('zh-CN')}
          </div>
        </div>
      ))}
      <button
        onClick={handleCreate}
        className="w-full p-2.5 bg-surface border border-dashed border-border-2 rounded-lg text-[12px] font-semibold text-ink-2"
      >
        + 创建新 Key
      </button>
    </div>
  );
}
