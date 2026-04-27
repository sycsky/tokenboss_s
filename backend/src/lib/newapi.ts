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
    res = await fetch(url.toString(), {
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

  /**
   * Log in as a newapi user and return the session cookie plus their id.
   * The cookie is an opaque string (`session=...`) suitable for inclusion
   * in the `Cookie` header of follow-up requests.
   */
  async loginUser(input: {
    username: string;
    password: string;
  }): Promise<{ cookie: string; userId: number }> {
    const { baseUrl } = getConfig();
    const res = await fetch(`${baseUrl}/api/user/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: input.username, password: input.password }),
    });
    const text = await res.text();
    const parsed = JSON.parse(text) as {
      success?: boolean;
      message?: string;
      data?: { id?: number };
    };
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
    return { cookie, userId: parsed.data.id };
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
    const createRes = await fetch(`${baseUrl}/api/token/`, {
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
    const createBody = (await createRes.json()) as { success?: boolean; message?: string };
    if (!createRes.ok || !createBody.success) {
      throw new NewapiError(
        createRes.status || 500,
        createBody.message ?? "createToken failed",
      );
    }

    // 2. Locate the just-created token by name, taking the newest match.
    // We scope to page 0 size 10 since a fresh user's token count is small.
    const listRes = await fetch(`${baseUrl}/api/token/?p=0&size=10`, {
      headers: userHeaders,
    });
    const listBody = (await listRes.json()) as {
      success?: boolean;
      data?: { items?: NewapiToken[] };
    };
    const items = listBody.data?.items ?? [];
    const match = items
      .filter((t) => t.name === input.name)
      .sort((a, b) => b.id - a.id)[0];
    if (!match) {
      throw new NewapiError(500, `createToken succeeded but token ${input.name} not found in listing`);
    }

    // 3. Reveal the raw key via the UI-facing endpoint.
    const revealRes = await fetch(`${baseUrl}/api/token/${match.id}/key`, {
      method: "POST",
      headers: userHeaders,
    });
    const revealBody = (await revealRes.json()) as {
      success?: boolean;
      message?: string;
      data?: { key?: string };
    };
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
    /** Initial newapi quota to seed (raw newapi units; 500,000 ≈ $1). */
    quota?: number;
  }): Promise<{ newapiUserId: number }> {
    const user = await this.createUser({
      username: input.username,
      password: input.password,
      display_name: input.display_name,
      email: input.email,
      group: "default",
    });
    // newapi's POST /api/user/ silently ignores the `quota` field at
    // creation time — quota can only be set via PUT. Without this step
    // every chat request fails with `insufficient_user_quota` because
    // the user-level quota is a separate check from the token's
    // `unlimited_quota` flag.
    await this.updateUser({
      id: user.id,
      username: user.username,
      quota: input.quota ?? 2_500_000,
      group: "default",
    });
    return { newapiUserId: user.id };
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
    const res = await fetch(`${baseUrl}/api/token/${tokenId}/key`, {
      method: "POST",
      headers: {
        cookie: session.cookie,
        "new-api-user": String(session.userId),
      },
    });
    const body = (await res.json()) as {
      success?: boolean;
      message?: string;
      data?: { key?: string };
    };
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
    const res = await fetch(`${baseUrl}/api/token/?p=0&size=100`, {
      headers: {
        cookie: session.cookie,
        "new-api-user": String(session.userId),
      },
    });
    const body = (await res.json()) as {
      success?: boolean;
      message?: string;
      data?: { items?: NewapiToken[] };
    };
    if (!res.ok || !body.success) {
      throw new NewapiError(
        res.status || 500,
        body.message ?? "listUserTokens failed",
      );
    }
    return body.data?.items ?? [];
  },

  /** Delete a token by ID (admin). */
  async deleteToken(tokenId: number): Promise<void> {
    await req<unknown>("DELETE", `/api/token/${tokenId}`);
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

  // --- Models ---

  /** List models available on the newapi instance. */
  async listModels(): Promise<unknown[]> {
    return req<unknown[]>("GET", "/api/models");
  },

  // --- Health ---

  /** Check if the newapi instance is reachable. */
  async status(): Promise<Record<string, unknown>> {
    const { baseUrl } = getConfig();
    const res = await fetch(`${baseUrl}/api/status`);
    return (await res.json()) as Record<string, unknown>;
  },
};
