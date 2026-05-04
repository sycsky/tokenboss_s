import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAdminAuth } from "../lib/adminAuth.js";
import {
  adminApi,
  type AdminUserListItem,
  type AdminUserListResponse,
} from "../lib/adminApi.js";
import { ApiError } from "../lib/api.js";

const PAGE_SIZE = 50;

export default function AdminUsers() {
  const nav = useNavigate();
  const { username, logout, invalidate } = useAdminAuth();

  const [search, setSearch] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<AdminUserListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce the search box (300ms) so we don't fire a request per keystroke.
  // Reset to page 0 when the query changes — pagination over the filtered
  // result set, not the unfiltered one.
  const debounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      setDebouncedQ(search.trim());
      setPage(0);
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [search]);

  // Fetch on (q, page) change. Aborting via cancellation flag — fetch
  // doesn't need an AbortController for this small scale; the flag
  // prevents stale responses from setting state after a newer request.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    adminApi
      .listUsers({ q: debouncedQ, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then((res) => {
        if (cancelled) return;
        setData(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          // Stale or revoked token — clear and bounce.
          invalidate();
          nav("/admin/login", { replace: true });
          return;
        }
        setError(err instanceof Error ? err.message : "加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQ, page, invalidate, nav]);

  const totalPages = useMemo(() => {
    if (!data) return 0;
    return Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  }, [data]);

  function handleLogout() {
    logout();
    nav("/admin/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-bg-alt">
      <header className="bg-surface border-b border-border px-6 py-3 flex items-center justify-between">
        <div>
          <div className="text-h3 font-semibold text-text-primary">
            TokenBoss Admin
          </div>
          <div className="text-caption text-text-secondary">
            登录身份: <span className="font-mono">{username ?? "—"}</span>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="text-caption text-text-secondary hover:text-accent border border-border hover:border-accent rounded-sm px-3 py-1.5 transition-colors"
        >
          退出
        </button>
      </header>

      <main className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-between mb-4 gap-3">
          <input
            type="text"
            placeholder="按 邮箱 / userId / 显示名 搜索…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 max-w-md px-3 py-2 rounded-sm border border-border bg-surface focus:border-accent focus:outline-none text-body"
          />
          <div className="text-caption text-text-secondary whitespace-nowrap">
            共 {data?.total ?? "—"} 个用户
          </div>
        </div>

        {error && (
          <div className="bg-danger-subtle border border-danger-border text-danger-text rounded-sm p-3 text-caption mb-3">
            {error}
          </div>
        )}

        <div className="bg-surface border border-border rounded-[14px] shadow-warm overflow-hidden">
          <table className="w-full text-body">
            <thead className="bg-bg-alt border-b border-border">
              <tr>
                <th className="text-left px-4 py-3 text-caption font-medium text-text-secondary">邮箱</th>
                <th className="text-left px-4 py-3 text-caption font-medium text-text-secondary">User ID</th>
                <th className="text-left px-4 py-3 text-caption font-medium text-text-secondary">显示名</th>
                <th className="text-left px-4 py-3 text-caption font-medium text-text-secondary">套餐</th>
                <th className="text-left px-4 py-3 text-caption font-medium text-text-secondary">newapi ID</th>
                <th className="text-left px-4 py-3 text-caption font-medium text-text-secondary">注册时间</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-text-secondary text-caption">
                    加载中…
                  </td>
                </tr>
              )}
              {!loading && data && data.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-text-secondary text-caption">
                    没有匹配的用户
                  </td>
                </tr>
              )}
              {data?.items.map((u) => (
                <UserRow key={u.userId} user={u} />
              ))}
            </tbody>
          </table>
        </div>

        {data && data.total > PAGE_SIZE && (
          <div className="flex items-center justify-between mt-4 text-caption text-text-secondary">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 border border-border rounded-sm hover:border-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              上一页
            </button>
            <span>
              第 {page + 1} / {totalPages} 页
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page + 1 >= totalPages}
              className="px-3 py-1.5 border border-border rounded-sm hover:border-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              下一页
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

function UserRow({ user }: { user: AdminUserListItem }) {
  const created = new Date(user.createdAt);
  const createdLabel = isNaN(created.getTime())
    ? user.createdAt
    : `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}-${String(created.getDate()).padStart(2, "0")}`;
  return (
    <tr className="border-b border-border-subtle hover:bg-bg-alt transition-colors">
      <td className="px-4 py-3">
        <Link
          to={`/admin/users/${encodeURIComponent(user.userId)}`}
          className="text-accent hover:underline"
        >
          {user.email ?? <span className="text-text-muted">无邮箱</span>}
        </Link>
      </td>
      <td className="px-4 py-3 font-mono text-caption text-text-secondary">{user.userId}</td>
      <td className="px-4 py-3 text-text-secondary">{user.displayName ?? "—"}</td>
      <td className="px-4 py-3">
        {user.plan ? (
          <span className="inline-block text-caption font-medium px-2 py-0.5 rounded-sm bg-accent-subtle text-accent-ink">
            {user.plan}
          </span>
        ) : (
          <span className="text-text-muted text-caption">—</span>
        )}
      </td>
      <td className="px-4 py-3 font-mono text-caption text-text-secondary">
        {user.newapiUserId ?? "—"}
      </td>
      <td className="px-4 py-3 text-caption text-text-secondary">{createdLabel}</td>
    </tr>
  );
}
