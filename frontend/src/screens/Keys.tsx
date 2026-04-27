import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type CreatedProxyKey, type ProxyKeySummary } from '../lib/api';
import { AppNav } from '../components/AppNav';

const card = 'bg-white border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917]';

/**
 * API key management — the dedicated page that 老代码 had.
 *
 * Lists the user's existing keys, exposes create / reveal / copy / revoke,
 * and shows the one-shot "just created — copy now" banner. Replaces the
 * `prompt()` flow that the embedded Dashboard widget had been falling
 * back to.
 *
 * Slock-pixel restyle of the original Keys.tsx (commit 6171ff3): same
 * logic, dropped PhoneFrame + raw-form inputs in favor of 2px-ink cards
 * + hard offset shadows + saturated stamp pills.
 */
export default function Keys() {
  const [keys, setKeys] = useState<ProxyKeySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [justCreated, setJustCreated] = useState<CreatedProxyKey | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealingId, setRevealingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await api.listKeys();
      setKeys(r.keys);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `加载失败: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const created = await api.createKey({ label: newLabel.trim() || undefined });
      setJustCreated(created);
      setNewLabel('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `创建失败: ${(err as Error).message}`);
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(keyId: string) {
    if (!confirm('吊销后该 key 立即失效，且无法恢复。确认吗？')) return;
    try {
      await api.deleteKey(keyId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `吊销失败: ${(err as Error).message}`);
    }
  }

  async function handleReveal(keyId: string) {
    if (revealed[keyId]) {
      setRevealed((r) => {
        const n = { ...r };
        delete n[keyId];
        return n;
      });
      return;
    }
    setRevealingId(keyId);
    try {
      const { key } = await api.revealKey(keyId);
      setRevealed((r) => ({ ...r, [keyId]: key }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `显示失败: ${(err as Error).message}`);
    } finally {
      setRevealingId(null);
    }
  }

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  }

  return (
    <div className="min-h-screen bg-bg pb-12">
      <AppNav current="account" />

      <main className="max-w-[820px] mx-auto px-5 sm:px-9 pt-6">
        <div className="font-mono text-[11px] tracking-[0.06em] text-[#A89A8D] mb-4">
          <Link to="/console" className="hover:text-ink transition-colors">控制台</Link>
          <span className="mx-2 text-[#D9CEC2]">/</span>
          <span className="text-ink-2">API Keys</span>
        </div>

        <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[#A89A8D] mb-2 font-bold">
          API KEYS · 接入凭证
        </div>
        <h1 className="text-[40px] md:text-[48px] font-bold tracking-tight leading-none mb-3">
          一把 Key 一个 Agent。
        </h1>
        <p className="text-[14px] text-text-secondary mb-9 max-w-[540px]">
          用这些 Key 调用 OpenAI 兼容的 <span className="font-mono text-ink">/v1/chat/completions</span>。
          建议每个 Agent 用独立 Key —— 出问题时单独吊销，不影响其它接入。
        </p>

        {/* Just-created banner */}
        {justCreated && (
          <div className="bg-yellow-stamp border-2 border-ink rounded-md shadow-[4px_4px_0_0_#1C1917] p-5 mb-6">
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] font-bold text-yellow-stamp-ink mb-1.5">
              已创建 · 请立即复制
            </div>
            <div className="text-[12.5px] text-yellow-stamp-ink mb-3 leading-snug">
              离开这个页面后将无法再看到完整 key。请现在保存到密码管理器、`.env` 文件，或粘到你的 Agent 配置里。
            </div>
            <div className="font-mono text-[12px] text-ink bg-white border-2 border-ink rounded p-2.5 break-all mb-3">
              {justCreated.key}
            </div>
            <div className="flex gap-2.5">
              <button
                onClick={() => handleCopy(justCreated.key)}
                className={
                  'px-4 py-2 bg-ink text-bg border-2 border-ink rounded text-[13px] font-bold ' +
                  'shadow-[2px_2px_0_0_#1C1917] ' +
                  'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
                  'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
                  'transition-all'
                }
              >
                {copyState === 'copied' ? '已复制 ✓' : '复制'}
              </button>
              <button
                onClick={() => setJustCreated(null)}
                className={
                  'px-4 py-2 bg-white text-ink border-2 border-ink rounded text-[13px] font-bold ' +
                  'shadow-[2px_2px_0_0_#1C1917] ' +
                  'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
                  'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
                  'transition-all'
                }
              >
                我已保存
              </button>
            </div>
          </div>
        )}

        {/* Create form */}
        <section className={`${card} p-5 mb-6`}>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-3">
            新建 Key
          </div>
          <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="备注（可选，如 my-laptop · openclaw · hermes）"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              maxLength={64}
              className={
                'flex-1 px-3.5 py-2.5 bg-white border-2 border-ink rounded text-[13.5px] text-ink ' +
                'shadow-[2px_2px_0_0_#1C1917] ' +
                'focus:outline-none focus:translate-x-[1px] focus:translate-y-[1px] focus:shadow-[1px_1px_0_0_#1C1917] ' +
                'transition-all placeholder:text-[#A89A8D]'
              }
            />
            <button
              type="submit"
              disabled={creating}
              className={
                'px-5 py-2.5 bg-accent text-white border-2 border-ink rounded text-[13.5px] font-bold whitespace-nowrap ' +
                'shadow-[3px_3px_0_0_#1C1917] ' +
                'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
                'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
                'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-[3px_3px_0_0_#1C1917] ' +
                'transition-all'
              }
            >
              {creating ? '创建中…' : '+ 创建'}
            </button>
          </form>
        </section>

        {error && (
          <div className="font-mono text-[12px] bg-red-soft text-red-ink border-2 border-ink rounded px-3 py-2 mb-5">
            {error}
          </div>
        )}

        {/* Existing keys */}
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-3">
          现有 Key
        </div>
        {loading && (
          <div className="font-mono text-[12px] text-[#A89A8D] py-3">加载中…</div>
        )}
        {!loading && keys && keys.length === 0 && (
          <div className={`${card} p-6 text-center font-mono text-[12.5px] text-[#A89A8D]`}>
            还没有 Key · 在上面 + 创建 一个开始
          </div>
        )}
        <div className="space-y-3">
          {keys?.map((k) => {
            const display = revealed[k.keyId] ?? k.key;
            return (
              <div key={k.keyId} className={`${card} p-4`}>
                <div className="flex items-start justify-between gap-3 mb-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-2.5 h-2.5 border-2 border-ink rounded-full flex-shrink-0 ${k.disabled ? 'bg-red-ink' : 'bg-lime-stamp'}`}
                    />
                    <span className="text-[14px] font-bold text-ink truncate">
                      {k.label || 'default'}
                    </span>
                    {k.disabled && (
                      <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-bg-alt text-[#A89A8D] border-2 border-[#D9CEC2] rounded flex-shrink-0">
                        已吊销
                      </span>
                    )}
                  </div>
                  {!k.disabled && (
                    <button
                      onClick={() => handleRevoke(k.keyId)}
                      className="font-mono text-[10.5px] font-bold tracking-wider uppercase px-2 py-0.5 border-2 border-ink rounded text-ink hover:bg-red-soft hover:text-red-ink transition-colors flex-shrink-0"
                    >
                      吊销
                    </button>
                  )}
                </div>
                <div className="font-mono text-[12px] text-ink bg-bg border-2 border-ink rounded p-2.5 break-all mb-2">
                  {display}
                </div>
                <div className="flex items-center gap-3 mb-1.5">
                  <button
                    onClick={() => handleReveal(k.keyId)}
                    disabled={revealingId === k.keyId}
                    className="font-mono text-[11px] font-bold text-accent hover:underline underline-offset-2 disabled:opacity-50"
                  >
                    {revealingId === k.keyId ? '加载中…' : revealed[k.keyId] ? '隐藏' : '显示完整 Key'}
                  </button>
                  {revealed[k.keyId] && (
                    <button
                      onClick={() => handleCopy(revealed[k.keyId])}
                      className="font-mono text-[11px] font-bold text-accent hover:underline underline-offset-2"
                    >
                      复制
                    </button>
                  )}
                </div>
                <div className="font-mono text-[10.5px] text-[#A89A8D]">
                  创建于 {new Date(k.createdAt).toLocaleDateString('zh-CN')}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
