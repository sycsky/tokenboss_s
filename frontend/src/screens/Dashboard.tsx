import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { PhoneFrame } from "../components/PhoneFrame.js";
import { Button, LinkButton } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { useAuth } from "../lib/auth.js";
import { api, ApiError, type UsageResponse } from "../lib/api.js";

/**
 * Account overview. Pulls the current balance from `useAuth().user` (kept
 * fresh via `refresh()`) and the today-usage rollup from `GET /v1/usage`.
 */
export default function Dashboard() {
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();

  const [todayUsage, setTodayUsage] = useState<UsageResponse | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Refresh balance in parallel with today's usage so the card and the
        // stat widgets update together.
        const [, usage] = await Promise.all([
          refresh().catch(() => {
            /* handled by AuthProvider on 401 */
          }),
          api.usage("today"),
        ]);
        if (!cancelled) setTodayUsage(usage);
      } catch (err) {
        if (!cancelled) {
          setUsageError(
            err instanceof ApiError
              ? err.message
              : `加载失败: ${(err as Error).message}`,
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  // At this point `user` is guaranteed non-null by RequireAuth, but we
  // narrow for TS.
  if (!user) return null;

  const balance = user.balance;
  const freeQuota = user.freeQuota || 1; // avoid /0
  const remainingPct = Math.max(0, Math.min(100, (balance / freeQuota) * 100));
  const usedCredits = Math.max(0, freeQuota - balance);

  const avatarLetter =
    (user.displayName?.[0] ?? user.email[0] ?? "U").toUpperCase();

  return (
    <PhoneFrame>
      <div className="flex-1 px-6 py-6 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-label text-text-secondary">TokenBoss</div>
            <div className="text-h2">账户总览</div>
          </div>
          <button
            onClick={handleLogout}
            className="w-10 h-10 rounded-full bg-accent-subtle text-accent flex items-center justify-center font-semibold"
            title="退出登录"
          >
            {avatarLetter}
          </button>
        </div>

        {/* Balance card */}
        <Card tone="quota" className="mb-6">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-caption text-white/60">当前余额</div>
            <div className="text-caption text-accent font-semibold">
              免费版
            </div>
          </div>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="font-mono text-[44px] font-semibold leading-none">
              {balance.toLocaleString()}
            </span>
            <span className="text-caption text-white/60">credits</span>
          </div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden mb-4">
            <div
              className="h-full bg-accent"
              style={{ width: `${remainingPct}%` }}
            />
          </div>
          <div className="flex justify-between text-caption text-white/60">
            <span>已用 {usedCredits.toLocaleString()}</span>
            <span className="font-mono">赠送总额 {freeQuota.toLocaleString()}</span>
          </div>
        </Card>

        {/* Today stats */}
        <Card className="mb-4">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-label text-text-secondary">今日消耗</div>
            <div className="font-mono text-body">
              {loading
                ? "…"
                : `${(todayUsage?.totalCreditsCharged ?? 0).toLocaleString()} credits`}
            </div>
          </div>
          <div className="text-caption text-text-muted">
            {loading
              ? "加载中…"
              : `${todayUsage?.count ?? 0} 次调用 · ${
                  (todayUsage?.totalTokens ?? 0).toLocaleString()
                } tokens`}
          </div>
          {usageError && (
            <div className="text-caption text-danger-text mt-2">
              {usageError}
            </div>
          )}
        </Card>

        <div className="grid grid-cols-2 gap-3 mb-6">
          <Card>
            <div className="text-caption text-text-secondary mb-1">邮箱</div>
            <div className="font-mono text-body truncate">{user.email}</div>
          </Card>
          <Card>
            <div className="text-caption text-text-secondary mb-1">用户 ID</div>
            <div className="font-mono text-caption truncate">{user.userId}</div>
          </Card>
        </div>

        {/* Actions */}
        <div className="space-y-2 mt-auto">
          <LinkButton to="/dashboard/keys" fullWidth>
            管理 API Key
          </LinkButton>
          <LinkButton to="/dashboard/history" variant="secondary" fullWidth>
            查看使用记录
          </LinkButton>
          <LinkButton to="/onboard/install" variant="ghost" fullWidth>
            接入说明
          </LinkButton>
          <Button variant="ghost" fullWidth onClick={handleLogout}>
            退出登录
          </Button>
        </div>
      </div>
    </PhoneFrame>
  );
}
