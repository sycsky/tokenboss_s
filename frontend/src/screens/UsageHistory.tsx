import { useEffect, useState } from "react";

import { PhoneFrame } from "../components/PhoneFrame.js";
import { BackButton } from "../components/BackButton.js";
import { api, ApiError, type UsageResponse } from "../lib/api.js";

type Range = "today" | "week" | "month";

const RANGE_LABELS: Record<Range, string> = {
  today: "今日",
  week: "本周",
  month: "本月",
};

function formatTime(iso: string, range: Range): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (range === "today") {
    return d.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  return d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

/**
 * Usage history with today / week / month tabs. Wired to GET /v1/usage.
 * Charges come back from the backend as absolute credit counts; we show
 * them as negatives so the UI reads as a ledger.
 */
export default function UsageHistory() {
  const [range, setRange] = useState<Range>("today");
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await api.usage(range);
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) {
          setError(
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
  }, [range]);

  const records = data?.records ?? [];
  const totalCharged = data?.totalCreditsCharged ?? 0;
  const totalTokens = data?.totalTokens ?? 0;

  return (
    <PhoneFrame>
      <div className="flex-1 px-6 py-6 flex flex-col">
        <div className="mb-4">
          <BackButton to="/dashboard" label="账户" />
        </div>

        <h1 className="text-h2 mb-4">使用记录</h1>

        {/* Range tabs */}
        <div className="flex bg-bg-alt rounded-sm p-1 mb-4">
          {(["today", "week", "month"] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={[
                "flex-1 py-2 rounded-sm text-label transition-colors",
                range === r
                  ? "bg-surface text-text-primary shadow-warm-sm"
                  : "text-text-secondary",
              ].join(" ")}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>

        {/* Total */}
        <div className="bg-surface border border-border rounded-[14px] p-4 mb-4">
          <div className="flex items-baseline justify-between">
            <div className="text-caption text-text-secondary">
              {RANGE_LABELS[range]}合计
            </div>
            <div className="text-caption text-text-muted">
              {loading
                ? "…"
                : `${data?.count ?? 0} 次 · ${totalTokens.toLocaleString()} tokens`}
            </div>
          </div>
          <div className="font-mono text-h2 mt-1">
            -{totalCharged.toLocaleString()} credits
          </div>
        </div>

        {error && (
          <div className="text-caption text-danger-text bg-danger-subtle border border-danger-border rounded-sm px-3 py-2 mb-4">
            {error}
          </div>
        )}

        {/* Transaction list */}
        <div className="flex-1 space-y-1 overflow-y-auto">
          {loading && (
            <div className="text-center text-caption text-text-muted py-6">
              加载中…
            </div>
          )}
          {!loading && records.length === 0 && !error && (
            <div className="text-center text-caption text-text-muted py-6">
              暂无记录
            </div>
          )}
          {records.map((t) => (
            <div
              key={t.id}
              className="flex items-start justify-between px-2 py-3 border-b border-border-subtle"
            >
              <div>
                <div className="text-body">{t.model}</div>
                <div className="text-caption text-text-muted font-mono">
                  {formatTime(t.at, range)} · {t.totalTokens.toLocaleString()} tokens
                </div>
              </div>
              <div className="font-mono text-body text-text-primary">
                -{t.creditsCharged.toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </div>
    </PhoneFrame>
  );
}
