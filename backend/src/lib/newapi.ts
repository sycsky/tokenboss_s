/**
 * Admin API client for a self-hosted newapi instance.
 *
 * newapi (Calcium-Ion/new-api) exposes a full admin REST API that we use
 * to sync users, manage tokens, and pull usage stats. TokenBoss acts as
 * the business layer; the newapi instance handles the actual LLM routing,
 * metering, and quota enforcement.
 *
 * Auth: newapi's admin routes accept `Authorization: <access_token>` header
 * (no "Bearer" prefix). The access token is generated once in the newapi
 * dashboard → user icon → "Generate Access Token".
 *
 * Env vars:
 *   NEWAPI_BASE_URL    — e.g. http://localhost:3001 (no trailing slash)
 *   NEWAPI_ADMIN_TOKEN — admin access token from newapi dashboard
 */

// ---------- Config ----------

import { Agent } from "undici";

/**
 * Disable connection reuse for newapi calls. Default Node fetch keeps
 * connections in a pool; serverless-hosted newapi instances (zeabur etc.)
 * silently close idle connections, so the next reuse returns an empty
 * body before any HTTP response. Same fix chatProxyCore uses for chat
 * forwards. Adds a tiny per-request handshake cost in exchange for
 * reliability — admin / dashboard calls are infrequent enough that this
 * is invisible in practice.
 */
const newapiDispatcher = new Agent({
  connect: { timeout: 30_000 },
  keepAliveTimeout: 1,
  keepAliveMaxTimeout: 1,
  headersTimeout: 60_000,
  bodyTimeout: 60_000,
});

/** Wrap fetch() to always pass the no-keep-alive dispatcher. */
function nfetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...(init ?? {}),
    // @ts-expect-error undici-specific extension on fetch init
    dispatcher: newapiDispatcher,
  });
}

function getConfig(): { baseUrl: string; token: string; userId: string } {
  const baseUrl = process.env.NEWAPI_BASE_URL?.replace(/\/+$/, "");
  const token = process.env.NEWAPI_ADMIN_TOKEN;
  if (!baseUrl || !token) {
    throw new Error(
      "newapi not configured. Set NEWAPI_BASE_URL and NEWAPI_ADMIN_TOKEN.",
    );
  }
  // newapi admin endpoints require the caller's user ID in a header alongside
  // the access token. Defaults to "1" (root admin); override via env if the
  // access token belongs to a different admin user.
  const userId = process.env.NEWAPI_ADMIN_USER_ID ?? "1";
  return { baseUrl, token, userId };
}

/** True when NEWAPI_BASE_URL + NEWAPI_ADMIN_TOKEN are both set. */
export function isNewapiConfigured(): boolean {
  return !!(process.env.NEWAPI_BASE_URL && process.env.NEWAPI_ADMIN_TOKEN);
}

// ---------- Error ----------

export class NewapiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "NewapiError";
    this.status = status;
  }
}

// ---------- Quota unit conversion ----------
//
// newapi stores quotas in raw "units" where 500,000 ≈ $1. All conversions
// between USD and newapi units must go through these helpers — never write
// `* 500_000` inline. Get this wrong by 1000x and you'll either give every
// free user a planet's worth of credits or charge $30/day plans 0.06 cents.

const NEWAPI_UNITS_PER_USD = 500_000;

export function usdToNewapiQuota(usd: number): number {
  return Math.round(usd * NEWAPI_UNITS_PER_USD);
}

export function newapiQuotaToUsd(quota: number): number {
  return quota / NEWAPI_UNITS_PER_USD;
}

// ---------- Fetch core ----------

/**
 * Read the response body as JSON, but tolerate empty / non-JSON bodies by
 * surfacing a NewapiError with the upstream status and a snippet of the
 * raw text. Without this wrapper, an empty body (502 from a fronting
 * proxy, temporary 504, etc.) bubbles up as the cryptic
 * "Unexpected end of JSON input".
 */
async function readJsonResponse<T>(
  res: Response,
  opName: string,
): Promise<T> {
  const text = await res.text();
  if (!text) {
    throw new NewapiError(
      res.status || 502,
      `${opName}: empty response from newapi (status ${res.status})`,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const snippet = text.slice(0, 120);
    throw new NewapiError(
      res.status || 502,
      `${opName}: non-JSON response from newapi (status ${res.status}): ${snippet}`,
    );
  }
}

async function req<T>(
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  const { baseUrl, token, userId } = getConfig();
  const url = new URL(path, baseUrl);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    authorization: token,
    "new-api-user": userId,
  };
  if (body !== undefined) headers["content-type"] = "application/json";

  let res: Response;
  try {
    res = await nfetch(url.toString(), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new NewapiError(0, `newapi unreachable: ${(err as Error).message}`);
  }

  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* non-JSON */
  }

  if (!res.ok || parsed.success === false) {
    const msg =
      (parsed.message as string) ?? `HTTP ${res.status}: ${text.slice(0, 200)}`;
    throw new NewapiError(res.status || 500, msg);
  }

  return (parsed.data ?? parsed) as T;
}

// ---------- Types ----------

/** A single subscription record on a newapi user. Each call to
 *  `bindSubscription` creates one of these; users can have multiple
 *  active records simultaneously if `bind` was called repeatedly without
 *  invalidating the prior ones. */
export interface NewapiSubscription {
  /** Per-record id (use with invalidateUserSubscription). NOT the plan id. */
  id: number;
  user_id: number;
  /** id of the underlying plan in 订阅管理. */
  plan_id: number;
  /** Total quota granted by this subscription (raw newapi units; 500_000 ≈ $1). */
  amount_total: number;
  /** Quota consumed against this subscription. */
  amount_used: number;
  /** Unix seconds — subscription start. */
  start_time: number;
  /** Unix seconds — subscription end (newapi enforces; auto-rolls back group). */
  end_time: number;
  /** "active" | "invalidated" | "expired" | "consumed". */
  status: string;
  /** "admin" / "epay" / "stripe" / "creem" — how the sub was created. */
  source?: string;
  /** Unix seconds. */
  last_reset_time?: number;
  /** Unix seconds — when newapi will next refill amount_used = 0. */
  next_reset_time?: number;
  /** newapi user group this subscription pushes the user into. */
  upgrade_group?: string;
  /** Group the user was in before bind — newapi restores on invalidate. */
  prev_user_group?: string;
  created_at: number;
  updated_at: number;
}

/** newapi user object (subset of fields we care about). */
export interface NewapiUser {
  id: number;
  username: string;
  display_name: string;
  email: string;
  role: number;
  status: number;
  quota: number;
  used_quota: number;
  request_count: number;
  group: string;
}

/** newapi token (API key) object. */
export interface NewapiToken {
  id: number;
  user_id: number;
  key: string;
  name: string;
  remain_quota: number;
  used_quota: number;
  unlimited_quota: boolean;
  status: number;
  created_time: number;
  expired_time: number;
}

/** Single log entry from newapi. */
export interface NewapiLogEntry {
  id: number;
  user_id: number;
  created_at: number; // unix timestamp
  type: number;
  content: string;
  username: string;
  token_name: string;
  model_name: string;
  quota: number;
  prompt_tokens: number;
  completion_tokens: number;
  channel_id: number;
  request_id: string;
  group: string;
}

/** Paginated response wrapper from newapi. */
interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

// ---------- Session cache ----------
//
// newapi's /api/user/login is rate-limited (returns 429 with empty body
// when called too often). Callers that need a user-scoped session
// (listUserTokens, createAndRevealToken, revealToken) all go through
// loginUser; without caching, every dashboard refresh re-authenticates
// and trips the limiter. We hold a session cookie in-memory keyed by
// username for SESSION_TTL_MS — after which loginUser fetches a fresh
// one. Process restarts evict everything (intentional; sessions are
// non-critical state).

const SESSION_TTL_MS = 5 * 60 * 1000;

interface CachedSession {
  cookie: string;
  userId: number;
  expiresAt: number;
}

const sessionCache = new Map<string, CachedSession>();

// ---------- Public API ----------

export const newapi = {
  // --- User management (admin) ---

  /**
   * Create a new user on the newapi instance.
   * Requires admin auth.
   *
   * newapi's POST /api/user/ response does not include the created user's id
   * (returns only {success, message}), so we follow up with a search call to
   * resolve the id. The username is unique in newapi, so the search is
   * deterministic.
   */
  async createUser(input: {
    username: string;
    password: string;
    display_name?: string;
    email?: string;
    quota?: number;
    group?: string;
  }): Promise<NewapiUser> {
    await req<unknown>("POST", "/api/user/", {
      username: input.username,
      password: input.password,
      display_name: input.display_name ?? input.username,
      email: input.email,
      quota: input.quota ?? 0,
      group: input.group ?? "default",
      role: 1, // common user (not admin)
    });
    const found = await this.findUserByUsername(input.username);
    if (!found) {
      throw new NewapiError(
        500,
        `newapi createUser succeeded but user ${input.username} not found on lookup`,
      );
    }
    return found;
  },

  /** Search users by keyword (username/display_name/email). Returns first match. */
  async findUserByUsername(username: string): Promise<NewapiUser | null> {
    const res = await req<PageResult<NewapiUser>>(
      "GET",
      "/api/user/search",
      undefined,
      { keyword: username },
    );
    return res.items.find((u) => u.username === username) ?? null;
  },

  /** Get a user by ID (admin). */
  async getUser(userId: number): Promise<NewapiUser> {
    return req<NewapiUser>("GET", `/api/user/${userId}`);
  },

  /**
   * Update a user (admin). Used to add quota after payment.
   *
   * newapi's PUT handler re-saves the whole row, so `username` MUST be in
   * the body — otherwise it submits `username=""` which trips the unique
   * constraint and the update is rejected with a SQLSTATE 23505 error.
   * Any omitted-but-unique field has the same hazard, so callers should
   * pass the full identity (at minimum id + username).
   */
  async updateUser(input: {
    id: number;
    username: string;
    quota?: number;
    group?: string;
    status?: number;
  }): Promise<NewapiUser> {
    return req<NewapiUser>("PUT", "/api/user/", input);
  },

  // --- Redemption codes (admin) ---

  /**
   * Mint a one-shot redemption code on newapi's admin side. We use this in
   * the topup webhook flow: each settled topup order mints a code worth
   * `quotaUsd × 500_000` quota units, then immediately calls
   * `redeemCode` on behalf of the user to apply it. Two atomic newapi
   * operations replace a single read-modify-write `updateUser` that would
   * race against the user's own API consumption.
   *
   * The redemption is permanent (`expired_time=0`). `count` is fixed at 1
   * since each order mints exactly one code; the upstream limit is 100.
   *
   * `name` is what shows up in the newapi admin's redemption list, so pass
   * something traceable like the orderId. newapi caps it at 20 runes —
   * we truncate here so callers don't have to.
   */
  async createRedemption(input: {
    name: string;
    quotaUsd: number;
  }): Promise<string> {
    const { baseUrl, token, userId } = getConfig();
    const name = input.name.slice(0, 20); // newapi cap, see redemption.go:68
    const quota = Math.round(input.quotaUsd * 500_000);
    const res = await nfetch(`${baseUrl}/api/redemption`, {
      method: "POST",
      headers: {
        authorization: token,
        "new-api-user": userId,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name,
        count: 1,
        quota,
        expired_time: 0,
      }),
    });
    const parsed = await readJsonResponse<{
      success?: boolean;
      message?: string;
      data?: string[];
    }>(res, "createRedemption");
    if (!res.ok || !parsed.success || !Array.isArray(parsed.data) || parsed.data.length === 0) {
      throw new NewapiError(
        res.status || 500,
        parsed.message ?? "createRedemption failed",
      );
    }
    return parsed.data[0]!;
  },

  // --- Token management ---
  //
  // Tokens can ONLY be created by the owning user's session — newapi's
  // AddToken handler pulls the user id from `c.GetInt("id")` and ignores
  // any body-level user_id. Similarly, the raw `sk-xxx` key is only
  // returned by a dedicated reveal endpoint (`POST /api/token/{id}/key`),
  // which also requires the owner's session. So for each new TokenBoss
  // user we:
  //   1. Log in as them (password we generated at createUser time)
  //   2. POST /api/token/ to create the token under their account
  //   3. GET  /api/token/ to discover the new token's id (the POST response
  //      itself returns only {success:true})
  //   4. POST /api/token/{id}/key to reveal the raw key
  //
  // Session-cookie cache: every dashboard request that needs to act as a
  // user (list keys, create key, reveal key) goes through loginUser. Without
  // caching, a chatty dashboard hammers /api/user/login and hits newapi's
  // rate limiter (429 with empty body). We hold cookies in-memory keyed by
  // username for SESSION_TTL_MS; callers don't see this — they always go
  // through loginUser. Cookies older than the TTL are evicted lazily.

  /**
   * Log in as a newapi user and return the session cookie plus their id.
   * Cached for SESSION_TTL_MS so repeated dashboard calls reuse a single
   * cookie. Pass `force=true` (e.g., after a 401 from a downstream call)
   * to skip the cache.
   */
  async loginUser(input: {
    username: string;
    password: string;
    force?: boolean;
  }): Promise<{ cookie: string; userId: number }> {
    const cached = sessionCache.get(input.username);
    if (!input.force && cached && cached.expiresAt > Date.now()) {
      return { cookie: cached.cookie, userId: cached.userId };
    }
    const { baseUrl } = getConfig();
    const res = await nfetch(`${baseUrl}/api/user/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: input.username, password: input.password }),
    });
    const parsed = await readJsonResponse<{
      success?: boolean;
      message?: string;
      data?: { id?: number };
    }>(res, "loginUser");
    if (!res.ok || !parsed.success || !parsed.data?.id) {
      throw new NewapiError(
        res.status || 500,
        parsed.message ?? `login failed for ${input.username}`,
      );
    }
    const setCookie = res.headers.get("set-cookie");
    const cookie = setCookie?.split(";")[0];
    if (!cookie) {
      throw new NewapiError(500, "login succeeded but no session cookie returned");
    }
    sessionCache.set(input.username, {
      cookie,
      userId: parsed.data.id,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    return { cookie, userId: parsed.data.id };
  },

  /** Drop a cached session for a username — call this after a downstream
   *  401 to force the next loginUser to re-authenticate. */
  invalidateSession(username: string): void {
    sessionCache.delete(username);
  },

  /**
   * Create a token under the given user session and return its full raw key.
   * Combines the three newapi calls (create → locate id → reveal key) into
   * one operation so callers don't need to juggle the pagination + session
   * plumbing themselves.
   */
  async createAndRevealToken(input: {
    session: { cookie: string; userId: number };
    name: string;
    unlimited_quota?: boolean;
    remain_quota?: number;
    expired_time?: number; // unix seconds, -1 = never
    models?: string[];
    group?: string;
  }): Promise<{ tokenId: number; apiKey: string }> {
    const { baseUrl } = getConfig();
    const userHeaders: Record<string, string> = {
      cookie: input.session.cookie,
      "new-api-user": String(input.session.userId),
    };

    // 1. Create the token. Response body is just {success, message}.
    const createRes = await nfetch(`${baseUrl}/api/token/`, {
      method: "POST",
      headers: { ...userHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        remain_quota: input.remain_quota ?? 0,
        unlimited_quota: input.unlimited_quota ?? false,
        expired_time: input.expired_time ?? -1,
        models: input.models,
        group: input.group,
      }),
    });
    const createBody = await readJsonResponse<{
      success?: boolean;
      message?: string;
    }>(createRes, "createToken");
    if (!createRes.ok || !createBody.success) {
      throw new NewapiError(
        createRes.status || 500,
        createBody.message ?? "createToken failed",
      );
    }

    // 2. Locate the just-created token by name, taking the newest match.
    // We scope to page 0 size 10 since a fresh user's token count is small.
    const listRes = await nfetch(`${baseUrl}/api/token/?p=0&size=10`, {
      headers: userHeaders,
    });
    const listBody = await readJsonResponse<{
      success?: boolean;
      data?: { items?: NewapiToken[] };
    }>(listRes, "createAndRevealToken/list");
    const items = listBody.data?.items ?? [];
    const match = items
      .filter((t) => t.name === input.name)
      .sort((a, b) => b.id - a.id)[0];
    if (!match) {
      throw new NewapiError(500, `createToken succeeded but token ${input.name} not found in listing`);
    }

    // 3. Reveal the raw key via the UI-facing endpoint.
    const revealRes = await nfetch(`${baseUrl}/api/token/${match.id}/key`, {
      method: "POST",
      headers: userHeaders,
    });
    const revealBody = await readJsonResponse<{
      success?: boolean;
      message?: string;
      data?: { key?: string };
    }>(revealRes, "createAndRevealToken/reveal");
    if (!revealRes.ok || !revealBody.success || !revealBody.data?.key) {
      throw new NewapiError(
        revealRes.status || 500,
        revealBody.message ?? "reveal key failed",
      );
    }
    const rawKey = revealBody.data.key;
    const apiKey = rawKey.startsWith("sk-") ? rawKey : `sk-${rawKey}`;
    return { tokenId: match.id, apiKey };
  },

  /**
   * High-level helper: create a newapi user and provision a default token
   * for them, returning everything TokenBoss needs to store. This is the
   * operation the register handler calls.
   *
   * Idempotency/cleanup note: if any step after createUser fails, the
   * newapi user will exist without a token. Caller should surface the
   * error and either retry (the user already exists; createUser will fail
   * on the second call) or delete the newapi user manually. For MVP we
   * just fail loudly.
   */
  async provisionUser(input: {
    username: string;
    password: string;
    display_name?: string;
    email?: string;
    /** Initial newapi quota to seed (raw newapi units; 500,000 ≈ $1).
     *  Optional. When omitted, no quota PUT is issued — the user starts
     *  at newapi's default quota (typically 0) and the caller must set
     *  it via a separate mechanism (e.g. `bindSubscription`). V3 register
     *  flow relies on bind to set quota; V2 callers still pass an explicit
     *  number when needed for direct provisioning. */
    quota?: number;
    /** newapi user-group; defaults to "default". */
    group?: string;
  }): Promise<{ newapiUserId: number }> {
    const group = input.group ?? "default";
    const user = await this.createUser({
      username: input.username,
      password: input.password,
      display_name: input.display_name,
      email: input.email,
      group,
    });
    // newapi's POST /api/user/ silently ignores the `quota` field at
    // creation time — quota can only be set via PUT. Only do the PUT when
    // the caller explicitly asks for a quota (V2 paths). V3 register
    // skips this and lets bindSubscription set the quota atomically with
    // the trial subscription record.
    if (input.quota !== undefined) {
      await this.updateUser({
        id: user.id,
        username: user.username,
        quota: input.quota,
        group,
      });
    }
    return { newapiUserId: user.id };
  },

  /**
   * Redeem a code (兑换码) on behalf of the user. Wraps newapi's
   * `POST /api/user/topup` which validates the code, applies it to the
   * user's quota, and returns the quota delta added.
   *
   * On invalid / expired / consumed code, newapi returns `success=false`
   * with `message="..."` (i18n key `MsgRedeemFailed`). Caller-friendly
   * mapping: `RedeemError` with the upstream message preserved.
   */
  async redeemCode(session: {
    cookie: string;
    userId: number;
  }, code: string): Promise<{ quotaAdded: number }> {
    const { baseUrl } = getConfig();
    const res = await nfetch(`${baseUrl}/api/user/topup`, {
      method: "POST",
      headers: {
        cookie: session.cookie,
        "new-api-user": String(session.userId),
        "content-type": "application/json",
      },
      body: JSON.stringify({ key: code }),
    });
    const body = await readJsonResponse<{
      success?: boolean;
      message?: string;
      data?: number;
    }>(res, "redeemCode");
    if (!res.ok || !body.success || typeof body.data !== "number") {
      throw new NewapiError(
        res.status || 500,
        body.message ?? "redeem failed",
      );
    }
    return { quotaAdded: body.data };
  },

  /**
   * Reveal the raw `sk-xxx` key for a token the session owns. newapi only
   * returns plaintext via this endpoint (not in listings), so the dashboard
   * must call it on demand — we don't cache.
   */
  async revealToken(session: {
    cookie: string;
    userId: number;
  }, tokenId: number): Promise<string> {
    const { baseUrl } = getConfig();
    const res = await nfetch(`${baseUrl}/api/token/${tokenId}/key`, {
      method: "POST",
      headers: {
        cookie: session.cookie,
        "new-api-user": String(session.userId),
      },
    });
    const body = await readJsonResponse<{
      success?: boolean;
      message?: string;
      data?: { key?: string };
    }>(res, "revealToken");
    if (!res.ok || !body.success || !body.data?.key) {
      throw new NewapiError(
        res.status || 500,
        body.message ?? "revealToken failed",
      );
    }
    // newapi stores/returns the raw key without the `sk-` prefix. Clients
    // authenticate with `Authorization: Bearer sk-<raw>`, so normalize here.
    return body.data.key.startsWith("sk-") ? body.data.key : `sk-${body.data.key}`;
  },

  /**
   * List a user's tokens under their own session. `/v1/keys` uses this so
   * the dashboard shows only the signed-in user's keys, not admin-visible
   * ones across the whole instance.
   */
  async listUserTokens(session: {
    cookie: string;
    userId: number;
  }): Promise<NewapiToken[]> {
    const { baseUrl } = getConfig();
    const res = await nfetch(`${baseUrl}/api/token/?p=0&size=100`, {
      headers: {
        cookie: session.cookie,
        "new-api-user": String(session.userId),
      },
    });
    const body = await readJsonResponse<{
      success?: boolean;
      message?: string;
      data?: { items?: NewapiToken[] };
    }>(res, "listUserTokens");
    if (!res.ok || !body.success) {
      throw new NewapiError(
        res.status || 500,
        body.message ?? "listUserTokens failed",
      );
    }
    return body.data?.items ?? [];
  },

  /** Delete a token by ID via admin auth. NOTE: many newapi forks require
   *  the OWNER's session to delete (admin DELETE is silently ignored or
   *  soft-deletes). Prefer `deleteUserToken` from a user session. */
  async deleteToken(tokenId: number): Promise<void> {
    await req<unknown>("DELETE", `/api/token/${tokenId}`);
  },

  /** Delete a token using the owner's session. This is the path the
   *  newapi UI takes — works reliably across forks. */
  async deleteUserToken(
    session: { cookie: string; userId: number },
    tokenId: number,
  ): Promise<void> {
    const { baseUrl } = getConfig();
    const res = await nfetch(`${baseUrl}/api/token/${tokenId}`, {
      method: "DELETE",
      headers: {
        cookie: session.cookie,
        "new-api-user": String(session.userId),
      },
    });
    const body = await readJsonResponse<{ success?: boolean; message?: string }>(
      res,
      "deleteUserToken",
    );
    if (!res.ok || body.success === false) {
      throw new NewapiError(
        res.status || 500,
        body.message ?? "deleteUserToken failed",
      );
    }
  },

  // --- Usage logs ---

  /**
   * Query usage logs (admin endpoint — can see all users).
   * Returns paginated log entries with token/model details.
   */
  async getLogs(query?: {
    page?: number;
    per_page?: number;
    start_timestamp?: number;
    end_timestamp?: number;
    model_name?: string;
    token_name?: string;
    username?: string;
    type?: number; // 2 = consumption
  }): Promise<PageResult<NewapiLogEntry>> {
    return req<PageResult<NewapiLogEntry>>(
      "GET",
      "/api/log/",
      undefined,
      {
        p: query?.page ?? 0,
        size: query?.per_page ?? 50,
        start_timestamp: query?.start_timestamp,
        end_timestamp: query?.end_timestamp,
        model_name: query?.model_name,
        token_name: query?.token_name,
        username: query?.username,
        type: query?.type,
      },
    );
  },

  /**
   * Get aggregated usage stats (admin).
   * Returns total quota used in the time range.
   */
  async getLogStat(query?: {
    start_timestamp?: number;
    end_timestamp?: number;
    model_name?: string;
    token_name?: string;
  }): Promise<{ quota: number; rpm: number; tpm: number }> {
    return req<{ quota: number; rpm: number; tpm: number }>(
      "GET",
      "/api/log/stat",
      undefined,
      {
        start_timestamp: query?.start_timestamp,
        end_timestamp: query?.end_timestamp,
        model_name: query?.model_name,
        token_name: query?.token_name,
      },
    );
  },

  // --- Subscriptions ---
  //
  // newapi has a subscription module (Trial/Plus/Super/Ultra plans configured
  // in the admin panel under 订阅管理). bind here is the canonical way to
  // upgrade a user — it atomically:
  //   1. Creates a subscription record with the plan's duration + reset rules
  //   2. Sets user.group = plan.upgrade_group (e.g. "plus")
  //   3. Sets user.quota = plan.total_amount
  //
  // bind APPENDS — it does NOT cancel existing subscriptions. To replace
  // (e.g. trial → plus on payment), call listUserSubscriptions first to
  // find existing active records, then invalidateUserSubscription on each
  // before binding the new plan. Otherwise the old subscription stays
  // active and newapi may consume from it first (FIFO) which makes the
  // user see "trial quota deducted while on plus".
  //
  // No native "cancel/expire entire subscription" endpoint exists for the
  // user's group rollback — use updateUser({ group: "default" }) for that.
  //
  // Repeat-binding the same plan is idempotent (no error). Cross-plan bind
  // (e.g. trial → plus) DOES NOT auto-cancel the trial — see above.

  /**
   * Bind a newapi user to a subscription plan. Returns the success message
   * newapi echoes back; callers usually only care that this didn't throw.
   *
   * Note: this APPENDS a subscription record. If the user already has an
   * active subscription, both will be live. Use listUserSubscriptions +
   * invalidateUserSubscription first when you want a "replace" semantic.
   */
  async bindSubscription(input: {
    userId: number;
    planId: number;
  }): Promise<{ message?: string }> {
    return req<{ message?: string }>(
      "POST",
      "/api/subscription/admin/bind",
      { user_id: input.userId, plan_id: input.planId },
    );
  },

  /**
   * List all subscription records for a newapi user (any status). The
   * returned shape is `[{ subscription: { id, status, ... } }, ...]`. The
   * `id` here is the per-record subscription id used to invalidate or
   * delete a single record (different from the plan_id).
   */
  async listUserSubscriptions(userId: number): Promise<NewapiSubscription[]> {
    const res = await req<Array<{ subscription: NewapiSubscription }>>(
      "GET",
      `/api/subscription/admin/users/${userId}/subscriptions`,
    );
    return (res ?? []).map((row) => row.subscription);
  },

  /**
   * Invalidate (soft-cancel) a single subscription record by its id.
   * Newapi flips the record's status to "invalidated" and stops counting
   * its quota toward the user. Group rollback to the user's pre-sub group
   * happens automatically per newapi's subscription rules.
   */
  async invalidateUserSubscription(subscriptionId: number): Promise<{ message?: string }> {
    return req<{ message?: string }>(
      "POST",
      `/api/subscription/admin/user_subscriptions/${subscriptionId}/invalidate`,
    );
  },

  // --- Models ---

  /** List models available on the newapi instance. */
  async listModels(): Promise<unknown[]> {
    return req<unknown[]>("GET", "/api/models");
  },

  // --- Health ---

  /** Check if the newapi instance is reachable. */
  async status(): Promise<Record<string, unknown>> {
    const { baseUrl } = getConfig();
    const res = await nfetch(`${baseUrl}/api/status`);
    return (await res.json()) as Record<string, unknown>;
  },
};
