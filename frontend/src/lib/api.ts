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

// Prefer build-time Vite env, fall back to runtime injection via /env.js (Docker entrypoint)
declare global { interface Window { __ENV__?: { VITE_API_URL?: string; VITE_CHAT_URL?: string } } }
const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ||
  window.__ENV__?.VITE_API_URL ||
  "http://localhost:3000";
const CHAT_URL =
  (import.meta.env.VITE_CHAT_URL as string | undefined) ||
  window.__ENV__?.VITE_CHAT_URL ||
  API_URL;

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
  /** True after the user clicks the verification link sent on register. */
  emailVerified: boolean;
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

// ---------- API response types (v1 backend) ----------

export type BucketSkuType = "trial" | "topup" | "plan_plus" | "plan_super" | "plan_ultra";

export interface BucketRecord {
  id: string;
  userId: string;
  skuType: BucketSkuType;
  amountUsd: number;
  dailyCapUsd: number | null;
  dailyRemainingUsd: number | null;
  totalRemainingUsd: number | null;
  startedAt: string;
  expiresAt: string | null;
  modeLock: "none" | "auto_only" | "auto_eco_only";
  modelPool: "all" | "codex_only" | "eco_only";
  /** When newapi will next refill this subscription. ISO string sourced
   *  from the subscription's next_reset_time. null when the plan never
   *  resets (e.g. trial: quota_reset_period=never). */
  nextResetAt: string | null;
  createdAt: string;
}

export interface BucketsResponse {
  buckets: BucketRecord[];
}

export interface UsageRecord {
  id: number;
  userId: string;
  bucketId: string | null;
  eventType: "consume" | "reset" | "expire" | "topup" | "refund";
  amountUsd: number;
  model: string | null;
  source: string | null;
  /** Last 8 chars of the bearer token used. Match against the same suffix
   * of `ProxyKeySummary.key` (which already shows ...-last4) to attribute
   * each call to one of the user's API keys. */
  keyHint: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  createdAt: string;
}

export interface HourlyUsage {
  hour: string;
  consumed: number;
}

export interface UsageDetailResponse {
  records: UsageRecord[];
  totals: { consumed: number; calls: number };
  hourly24h: HourlyUsage[];
}

export interface UsageAggregateGroup {
  /** Group key — source string or keyHint, depending on the aggregateBy value. null when the field was unset on those records. */
  groupKey: string | null;
  callCount: number;
  totalConsumedUsd: number;
  lastUsedAt: string;
}

export interface UsageAggregateResponse {
  groups: UsageAggregateGroup[];
}

export interface MeResponse {
  user: UserProfile;
}

// ---------- billing types ----------

export type BillingPlanId = "plus" | "super" | "ultra";
export type BillingChannel = "epusdt" | "xunhupay";
export type BillingStatus = "pending" | "paid" | "expired" | "failed";
export type BillingCurrency = "CNY" | "USD";

export interface BillingOrder {
  orderId: string;
  planId: BillingPlanId;
  channel: BillingChannel;
  /** Quoted amount in `currency` (CNY for xunhupay, USD for epusdt). */
  amount: number;
  currency: BillingCurrency;
  /** Channel-side actual settled amount (USDT count for epusdt). */
  amountActual?: number;
  status: BillingStatus;
  paymentUrl?: string;
  blockTxId?: string;
  createdAt: string;
  paidAt?: string;
}

export interface CreateOrderResponse {
  orderId: string;
  planId: BillingPlanId;
  channel: BillingChannel;
  amount: number;
  currency: BillingCurrency;
  amountActual?: number;
  paymentUrl: string;
  /** Direct QR image URL when channel=xunhupay. Use to render an
   *  inline QR on PC instead of redirecting to the gateway. */
  qrCodeUrl?: string;
  expiresAt?: number;
  status: BillingStatus;
}

// ---------- public API ----------

export const api = {
  // auth — password flow (primary)
  register(input: { email: string; password: string; displayName?: string }): Promise<AuthResponse> {
    return request<AuthResponse>("/v1/auth/register", {
      method: "POST",
      body: input,
      token: null,
    });
  },
  login(email: string, password: string): Promise<AuthResponse> {
    return request<AuthResponse>("/v1/auth/login", {
      method: "POST",
      body: { email, password },
      token: null,
    });
  },
  verifyEmail(token: string): Promise<AuthResponse> {
    return request<AuthResponse>("/v1/auth/verify-email", {
      method: "POST",
      body: { token },
      token: null,
    });
  },
  resendVerification(): Promise<{ ok: true; alreadyVerified?: boolean }> {
    return request<{ ok: true; alreadyVerified?: boolean }>(
      "/v1/auth/resend-verification",
      { method: "POST", body: {} },
    );
  },

  // auth — email-code flow (passwordless / "forgot password" recovery)
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
  me(): Promise<MeResponse> {
    return request<MeResponse>("/v1/me");
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
  getBuckets(): Promise<BucketsResponse> {
    return request<BucketsResponse>("/v1/buckets");
  },

  // usage
  usage(range: "today" | "week" | "month" = "today"): Promise<UsageResponse> {
    return request<UsageResponse>("/v1/usage", { query: { range } });
  },
  getUsage(opts: { from?: string; to?: string; eventType?: string; limit?: number; offset?: number } = {}): Promise<UsageDetailResponse> {
    const qs = new URLSearchParams(
      Object.entries(opts)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    return request<UsageDetailResponse>(`/v1/usage${qs ? "?" + qs : ""}`, { method: "GET" });
  },
  /**
   * Aggregate consume events grouped by `source` (Agent identifier) or
   * `keyHint` (last 8 chars of the bearer token). Returns a tiny
   * `groups` array — much cheaper than pulling 200 raw records and
   * reducing client-side, and stays correct as volume grows.
   */
  getUsageAggregate(
    by: 'source' | 'keyHint',
    opts: { from?: string; to?: string; limit?: number } = {},
  ): Promise<UsageAggregateResponse> {
    const qs = new URLSearchParams(
      Object.entries({ aggregateBy: by, ...opts })
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    return request<UsageAggregateResponse>(`/v1/usage?${qs}`, { method: 'GET' });
  },

  // billing
  createOrder(input: {
    planId: BillingPlanId;
    channel: BillingChannel;
    /** Optional: where to send the user back after the gateway. Defaults
     *  to backend-side `${PUBLIC_BASE_URL}/billing/success?orderId=...`. */
    redirectUrl?: string;
  }): Promise<CreateOrderResponse> {
    return request<CreateOrderResponse>("/v1/billing/orders", {
      method: "POST",
      body: input,
    });
  },
  getOrder(orderId: string): Promise<{ order: BillingOrder }> {
    return request<{ order: BillingOrder }>(
      `/v1/billing/orders/${encodeURIComponent(orderId)}`,
    );
  },
  listOrders(): Promise<{ orders: BillingOrder[] }> {
    return request<{ orders: BillingOrder[] }>("/v1/billing/orders");
  },
};
