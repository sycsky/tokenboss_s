import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, type Location } from "react-router-dom";

import { PhoneFrame } from "../components/PhoneFrame.js";
import { Button } from "../components/Button.js";
import { useAuth } from "../lib/auth.js";
import { ApiError } from "../lib/api.js";

/**
 * Email + password sign-in. On success we jump straight to whatever the
 * user was trying to reach (via `state.from`) or the dashboard as a default.
 */
export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as Location & { state?: { from?: string } };
  const redirectTo = location.state?.from ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : `登录失败: ${(err as Error).message}`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PhoneFrame>
      <div className="flex-1 px-6 py-10 flex flex-col">
        <div className="mb-8">
          <div className="text-label text-text-secondary">TokenBoss</div>
          <h1 className="text-h2 mt-1">登录账户</h1>
          <p className="text-body text-text-secondary mt-1">
            欢迎回来，继续使用你的 AI 额度
          </p>
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
            <span className="text-label text-text-secondary">密码</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-sm border border-border bg-surface px-3 py-2 text-body focus:border-accent focus:outline-none"
            />
          </label>

          {error && (
            <div className="text-caption text-danger-text bg-danger-subtle border border-danger-border rounded-sm px-3 py-2">
              {error}
            </div>
          )}

          <Button type="submit" fullWidth disabled={submitting}>
            {submitting ? "登录中…" : "登录"}
          </Button>
        </form>

        <div className="mt-6 text-center text-caption text-text-secondary">
          还没有账户？{" "}
          <Link to="/register" className="text-accent font-medium">
            注册
          </Link>
        </div>
      </div>
    </PhoneFrame>
  );
}
