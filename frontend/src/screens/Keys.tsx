import { useEffect, useState, type FormEvent } from "react";

import { PhoneFrame } from "../components/PhoneFrame.js";
import { BackButton } from "../components/BackButton.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import {
  api,
  ApiError,
  type CreatedProxyKey,
  type ProxyKeySummary,
} from "../lib/api.js";

/**
 * API key management. Lists the user's current keys (masked) and exposes
 * create + revoke. The full key is only visible immediately after creation
 * — once you navigate away you can never see it again.
 */
export default function Keys() {
  const [keys, setKeys] = useState<ProxyKeySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [justCreated, setJustCreated] = useState<CreatedProxyKey | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealingId, setRevealingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { keys } = await api.listKeys();
      setKeys(keys);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : `加载失败: ${(err as Error).message}`,
      );
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
      const created = await api.createKey({
        label: newLabel.trim() || undefined,
      });
      setJustCreated(created);
      setNewLabel("");
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : `创建失败: ${(err as Error).message}`,
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(keyId: string) {
    if (!confirm("吊销后该 key 立即失效，且无法恢复。确认吗？")) return;
    try {
      await api.deleteKey(keyId);
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : `吊销失败: ${(err as Error).message}`,
      );
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
      setError(
        err instanceof ApiError
          ? err.message
          : `显示失败: ${(err as Error).message}`,
      );
    } finally {
      setRevealingId(null);
    }
  }

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1500);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  }

  return (
    <PhoneFrame>
      <div className="flex-1 px-6 py-6 flex flex-col">
        <div className="mb-4">
          <BackButton to="/dashboard" label="账户" />
        </div>

        <h1 className="text-h2 mb-1">API Keys</h1>
        <p className="text-caption text-text-secondary mb-4">
          用这些 key 调用 OpenAI 兼容的 /v1/chat/completions
        </p>

        {/* Just-created key banner */}
        {justCreated && (
          <Card className="mb-4 border-accent">
            <div className="text-label text-accent font-semibold mb-1">
              已创建 · 请立即复制
            </div>
            <div className="text-caption text-text-secondary mb-3">
              离开本页后将无法再看到完整 key。请现在保存到密码管理器或环境变量。
            </div>
            <div className="font-mono text-caption bg-bg-alt border border-border rounded-sm p-2 break-all mb-2">
              {justCreated.key}
            </div>
            <div className="flex gap-2">
              <Button
                variant="primary"
                onClick={() => handleCopy(justCreated.key)}
              >
                {copyState === "copied" ? "已复制 ✓" : "复制"}
              </Button>
              <Button variant="ghost" onClick={() => setJustCreated(null)}>
                我已保存
              </Button>
            </div>
          </Card>
        )}

        {/* Create form */}
        <form onSubmit={handleCreate} className="mb-6">
          <div className="text-label text-text-secondary mb-1">新建 key</div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="备注（可选，如 my-laptop）"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="flex-1 rounded-sm border border-border bg-surface px-3 py-2 text-body focus:border-accent focus:outline-none"
            />
            <Button type="submit" disabled={creating}>
              {creating ? "创建中…" : "创建"}
            </Button>
          </div>
        </form>

        {error && (
          <div className="text-caption text-danger-text bg-danger-subtle border border-danger-border rounded-sm px-3 py-2 mb-4">
            {error}
          </div>
        )}

        {/* Existing keys */}
        <div className="flex-1 space-y-2 overflow-y-auto">
          <div className="text-label text-text-secondary">现有 keys</div>
          {loading && (
            <div className="text-center text-caption text-text-muted py-4">
              加载中…
            </div>
          )}
          {!loading && keys && keys.length === 0 && (
            <div className="text-center text-caption text-text-muted py-4">
              还没有 key，创建一个开始使用
            </div>
          )}
          {keys?.map((k) => (
            <div
              key={k.keyId}
              className="bg-surface border border-border rounded-[14px] p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-body font-medium truncate">
                    {k.label || "default"}
                  </div>
                  <div className="font-mono text-caption text-text-muted mt-1 break-all">
                    {revealed[k.keyId] ?? k.key}
                  </div>
                  <div className="flex gap-3 mt-1">
                    <button
                      onClick={() => handleReveal(k.keyId)}
                      disabled={revealingId === k.keyId}
                      className="text-caption text-accent hover:underline disabled:opacity-50"
                    >
                      {revealingId === k.keyId
                        ? "加载中…"
                        : revealed[k.keyId]
                          ? "隐藏"
                          : "显示"}
                    </button>
                    {revealed[k.keyId] && (
                      <button
                        onClick={() => handleCopy(revealed[k.keyId])}
                        className="text-caption text-accent hover:underline"
                      >
                        复制
                      </button>
                    )}
                  </div>
                  <div className="text-caption text-text-muted mt-1">
                    创建于{" "}
                    {new Date(k.createdAt).toLocaleDateString("zh-CN")}
                    {k.disabled && (
                      <span className="ml-2 text-danger">· 已吊销</span>
                    )}
                  </div>
                </div>
                {!k.disabled && (
                  <button
                    onClick={() => handleRevoke(k.keyId)}
                    className="text-caption text-danger hover:text-danger-text"
                  >
                    吊销
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </PhoneFrame>
  );
}
