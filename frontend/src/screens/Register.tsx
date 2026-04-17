import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { PhoneFrame } from "../components/PhoneFrame.js";
import { Button } from "../components/Button.js";
import { useAuth } from "../lib/auth.js";
import { ApiError } from "../lib/api.js";

/**
 * Free-signup form. Creates the account + seeds $5 of credits on the
 * backend, then persists the returned JWT so subsequent routes are authed.
 */
export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("密码至少 6 位");
      return;
    }
    setSubmitting(true);
    try {
      await register({
        email: email.trim(),
        password,
        displayName: displayName.trim() || undefined,
      });
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : `注册失败: ${(err as Error).message}`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PhoneFrame>
      <div className="flex-1 px-6 py-10 flex flex-col">
        <div className="mb-6">
          <div className="text-label text-text-secondary">TokenBoss</div>
          <h1 className="text-h2 mt-1">创建账户</h1>
          <p className="text-body text-text-secondary mt-1">
            注册即送 $5 免费额度，无需信用卡
          </p>
        </div>

        <div className="bg-accent-subtle border border-accent/30 rounded-[14px] px-4 py-3 mb-6">
          <div className="text-caption text-accent font-semibold tracking-widest">
            注册送
          </div>
          <div className="text-h2 text-accent">$5 · 约 5000 credits</div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="text-label text-text-secondary">邮箱</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-sm border border-border bg-surface px-3 py-2 text-body focus:border-accent focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="text-label text-text-secondary">昵称（可选）</span>
            <input
              type="text"
              autoComplete="nickname"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 w-full rounded-sm border border-border bg-surface px-3 py-2 text-body focus:border-accent focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="text-label text-text-secondary">密码</span>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-sm border border-border bg-surface px-3 py-2 text-body focus:border-accent focus:outline-none"
            />
            <span className="text-caption text-text-muted">至少 6 位</span>
          </label>

          {error && (
            <div className="text-caption text-danger-text bg-danger-subtle border border-danger-border rounded-sm px-3 py-2">
              {error}
            </div>
          )}

          <Button type="submit" fullWidth disabled={submitting}>
            {submitting ? "注册中…" : "注册并领取额度"}
          </Button>
        </form>

        <div className="mt-6 text-center text-caption text-text-secondary">
          已有账户？{" "}
          <Link to="/login" className="text-accent font-medium">
            登录
          </Link>
        </div>
      </div>
    </PhoneFrame>
  );
}
