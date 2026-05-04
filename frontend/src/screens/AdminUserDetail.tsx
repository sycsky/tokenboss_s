import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useAdminAuth } from "../lib/adminAuth.js";
import { adminApi, type AdminUserDetail } from "../lib/adminApi.js";
import { ApiError } from "../lib/api.js";

export default function AdminUserDetailScreen() {
  const { userId = "" } = useParams<{ userId: string }>();
  const nav = useNavigate();
  const { invalidate } = useAdminAuth();

  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    adminApi
      .getUser(userId)
      .then((res) => {
        if (cancelled) return;
        setUser(res.user);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          invalidate();
          nav("/admin/login", { replace: true });
          return;
        }
        if (err instanceof ApiError && err.status === 404) {
          setError("用户不存在");
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
  }, [userId, invalidate, nav]);

  return (
    <div className="min-h-screen bg-bg-alt">
      <header className="bg-surface border-b border-border px-6 py-3 flex items-center gap-4">
        <Link
          to="/admin/users"
          className="text-caption text-accent hover:underline"
        >
          ← 返回列表
        </Link>
        <div className="text-h3 font-semibold text-text-primary">用户详情</div>
      </header>

      <main className="max-w-3xl mx-auto p-6 space-y-4">
        {loading && (
          <div className="text-text-secondary text-caption">加载中…</div>
        )}
        {error && (
          <div className="bg-danger-subtle border border-danger-border text-danger-text rounded-sm p-3 text-caption">
            {error}
          </div>
        )}

        {user && (
          <>
            <Section title="身份">
              <Field label="User ID" value={user.userId} mono />
              <Field label="邮箱" value={user.email ?? "—"} />
              <Field label="显示名" value={user.displayName ?? "—"} />
              <Field label="手机号" value={user.phone ?? "—"} />
              <Field
                label="邮箱已验证"
                value={user.emailVerified ? "是" : "否"}
              />
              <Field label="注册时间" value={fmtDateTime(user.createdAt)} />
            </Section>

            <Section title="newapi 凭据">
              <Field
                label="newapi 用户 ID"
                value={user.newapi.userId ?? "—"}
                mono
              />
              <Field
                label="newapi 用户名"
                value={user.newapi.username ?? "—"}
                mono
                copyable={user.newapi.username}
              />
              <Field
                label="newapi 密码（明文）"
                value={user.newapi.password ?? "—"}
                mono
                copyable={user.newapi.password}
                emphasize
              />
            </Section>

            <Section title="订阅 / 额度">
              <Field label="套餐" value={user.subscription.plan ?? "—"} />
              <Field
                label="开始时间"
                value={fmtDateTime(user.subscription.startedAt)}
              />
              <Field
                label="到期时间"
                value={fmtDateTime(user.subscription.expiresAt)}
              />
              <Field
                label="每日额度 (USD)"
                value={
                  user.subscription.dailyQuotaUsd !== null
                    ? `$${user.subscription.dailyQuotaUsd.toFixed(2)}`
                    : "—"
                }
              />
              <Field
                label="下次重置时间"
                value={fmtDateTime(user.subscription.nextResetAt)}
              />
            </Section>
          </>
        )}
      </main>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-surface border border-border rounded-[14px] shadow-warm p-5">
      <h2 className="text-label font-semibold text-text-primary mb-3 uppercase tracking-wider">
        {title}
      </h2>
      <dl className="grid grid-cols-[140px_1fr] gap-y-2 gap-x-4 text-body">
        {children}
      </dl>
    </section>
  );
}

function Field({
  label,
  value,
  mono,
  copyable,
  emphasize,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
  copyable?: string | null;
  emphasize?: boolean;
}) {
  return (
    <>
      <dt className="text-caption text-text-secondary self-center">{label}</dt>
      <dd
        className={[
          mono ? "font-mono" : "",
          emphasize ? "text-accent-ink font-semibold" : "text-text-primary",
          "flex items-center gap-2",
        ].join(" ")}
      >
        <span className="break-all">{value}</span>
        {copyable && <CopyButton text={copyable} />}
      </dd>
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {
            /* clipboard blocked — silent */
          });
      }}
      className="text-caption text-accent hover:text-accent-hover border border-border hover:border-accent rounded-sm px-2 py-0.5 transition-colors"
    >
      {copied ? "已复制" : "复制"}
    </button>
  );
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
