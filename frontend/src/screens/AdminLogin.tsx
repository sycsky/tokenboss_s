import { useState, type FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";

import { useAdminAuth } from "../lib/adminAuth.js";
import { ApiError } from "../lib/api.js";

/**
 * Admin login. Plain centered form on neutral background — this UI is for
 * ops use, not user marketing, so it skips the PhoneFrame and brand
 * polish that the user-facing Login screen uses.
 */
export default function AdminLogin() {
  const nav = useNavigate();
  const loc = useLocation();
  const { login, token } = useAdminAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // If already logged in, bounce to the destination they came from (or
  // /admin/users by default). Renders momentarily before the redirect.
  if (token) {
    const back = (loc.state as { from?: string } | null)?.from ?? "/admin/users";
    nav(back, { replace: true });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      await login(username.trim(), password);
      const back = (loc.state as { from?: string } | null)?.from ?? "/admin/users";
      nav(back, { replace: true });
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 503) {
          if (err.code === "admin_misconfigured") {
            // Surface the upstream reason verbatim — usually a too-short
            // password tripping the production guard, and the operator
            // needs to see the actual rule to fix it.
            setError(err.message || "管理后台配置错误");
          } else {
            setError("管理后台未启用：请在 Zeabur 设置 TB_ADMIN_USERNAME / TB_ADMIN_PASSWORD。");
          }
        } else if (err.status === 429) {
          setError("尝试次数过多，请稍后再试。");
        } else if (err.status === 401) {
          setError("用户名或密码错误。");
        } else {
          setError(err.message || "登录失败");
        }
      } else {
        setError((err as Error).message || "登录失败");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg-alt flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-surface border border-border rounded-[14px] shadow-warm p-6">
        <h1 className="text-h2 font-semibold text-text-primary mb-1">
          TokenBoss Admin
        </h1>
        <p className="text-body text-text-secondary mb-5">
          运维后台登录
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="admin-username"
              className="block text-caption text-text-secondary mb-1"
            >
              用户名
            </label>
            <input
              id="admin-username"
              type="text"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 rounded-sm border border-border bg-surface focus:border-accent focus:outline-none text-body"
              required
            />
          </div>
          <div>
            <label
              htmlFor="admin-password"
              className="block text-caption text-text-secondary mb-1"
            >
              密码
            </label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-sm border border-border bg-surface focus:border-accent focus:outline-none text-body"
              required
            />
          </div>
          {error && (
            <div className="text-caption text-danger">{error}</div>
          )}
          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full bg-accent hover:bg-accent-hover disabled:bg-text-muted text-white font-semibold py-2.5 rounded-sm transition-colors"
          >
            {loading ? "登录中…" : "登录"}
          </button>
        </form>
      </div>
    </div>
  );
}
