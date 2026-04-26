/**
 * Thin fetch wrapper around the TokenBoss backend.
 *
 * All calls are JSON-in / JSON-out. The session token (JWT from
 * /v1/auth/register or /v1/auth/login) is auto-injected as `Authorization:
 * Bearer <token>` when present.
 *
 * Env vars:
 *   VITE_API_URL  — base URL of the HTTP API (auth, /v1/me, /v1/keys, /v1/usage)
 *   VITE_CHAT_URL — base URL of the streaming chat proxy (currently same host
 *                    in local dev; in prod this is a Lambda Function URL)
 */

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3000";
const CHAT_URL = (import.meta.env.VITE_CHAT_URL as string | undefined) ?? API_URL;

export const CHAT_COMPLETIONS_URL = `${CHAT_URL.replace(/\/$/, "")}/v1/chat/completions`;

// ---------- session token storage ----------

const SESSION_KEY = "tb_session";

export function getStoredSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function setStoredSession(token: string | null): void {
  try {
    if (token) localStorage.setItem(SESSION_KEY, token);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode or disabled — session just won't persist */
  }
}

// ---------- error shape ----------

export interface ApiErrorBody {
  error?: { type?: string; message?: string; code?: string };
}

export class ApiError extends Error {
  readonly status: number;
  readonly type: string;
  readonly code: string | undefined;
  constructor(status: number, body: ApiErrorBody | undefined, fallback: string) {
    const e = body?.error;
    super(e?.message ?? fallback);
    this.status = status;
    this.type = e?.type ?? "server_error";
    this.code = e?.code;
  }
}

// ---------- request core ----------

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Explicit token override — used by login/register before it's persisted. */
  token?: string | null;
  /** Query params, appended only if non-empty. */
  query?: Record<string, string | undefined>;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(path, API_URL);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";

  // Use the explicit token if passed, otherwise the stored session.
  const token = opts.token === undefined ? getStoredSession() : opts.token;
  if (token) headers["authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    throw new ApiError(0, undefined, `Network error: ${(err as Error).message}`);
  }

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // non-JSON body; leave parsed = undefined
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, parsed as ApiErrorBody | undefined, `HTTP ${res.status}`);
  }
  return parsed as T;
}

// ---------- typed responses ----------

export interface UserProfile {
  userId: string;
  email: string;
  displayName?: string;
  balance: number;
  freeQuota: number;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: UserProfile;
  /** Present on verifyCode — true when the user was newly created. */
  isNew?: boolean;
}

export interface ProxyKeySummary {
  /** Masked form for display (e.g. `tb_live_...abcd`). */
  key: string;
  /** Stable identifier used with DELETE /v1/keys/{keyId}. */
  keyId: string;
  label?: string;
  createdAt: string;
  disabled?: boolean;
}

export interface CreatedProxyKey {
  /** Full unmasked key — returned ONLY once at create time. Copy now. */
  key: string;
  keyId: string;
  label?: string;
  createdAt: string;
  disabled?: boolean;
}

export interface UsageRecordView {
  id: string;
  model: string;
  tier: number;
  at: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  creditsCharged: number;
}

export interface UsageResponse {
  range: "today" | "week" | "month";
  from: string;
  to: string;
  totalCreditsCharged: number;
  totalTokens: number;
  count: number;
  records: UsageRecordView[];
}

// ---------- public API ----------

export const api = {
  // auth — code-based flow
  sendCode(email: string): Promise<{ ok: true }> {
    return request<{ ok: true }>("/v1/auth/send-code", {
      method: "POST",
      body: { email },
      token: null,
    });
  },
  verifyCode(email: string, code: string): Promise<AuthResponse> {
    return request<AuthResponse>("/v1/auth/verify-code", {
      method: "POST",
      body: { email, code },
      token: null,
    });
  },
  me(): Promise<{ user: UserProfile }> {
    return request<{ user: UserProfile }>("/v1/me");
  },

  // keys
  listKeys(): Promise<{ keys: ProxyKeySummary[] }> {
    return request<{ keys: ProxyKeySummary[] }>("/v1/keys");
  },
  createKey(input: { label?: string }): Promise<CreatedProxyKey> {
    return request<CreatedProxyKey>("/v1/keys", { method: "POST", body: input });
  },
  deleteKey(keyId: string): Promise<{ ok: true }> {
    return request<{ ok: true }>(`/v1/keys/${encodeURIComponent(keyId)}`, {
      method: "DELETE",
    });
  },
  revealKey(keyId: string): Promise<{ keyId: number; key: string }> {
    return request<{ keyId: number; key: string }>(
      `/v1/keys/${encodeURIComponent(keyId)}/reveal`,
    );
  },

  // buckets
  getBuckets(): Promise<{ buckets: unknown[] }> {
    return request<{ buckets: unknown[] }>("/v1/buckets");
  },

  // usage
  usage(range: "today" | "week" | "month" = "today"): Promise<UsageResponse> {
    return request<UsageResponse>("/v1/usage", { query: { range } });
  },
  getUsage(opts: { from?: string; to?: string; eventType?: string; limit?: number; offset?: number } = {}): Promise<UsageResponse> {
    const qs = new URLSearchParams(
      Object.entries(opts)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    return request<UsageResponse>(`/v1/usage${qs ? "?" + qs : ""}`, { method: "GET" });
  },
};
