/**
 * Admin API client + storage.
 *
 * Self-contained — uses its own localStorage key (`tb_admin_session`) so
 * the admin session never collides with the user session in `api.ts`.
 * Calls go to the same VITE_API_URL host. The fetch + error shape mirror
 * `api.ts`'s `request()` exactly so error handling stays consistent.
 *
 * Surfaces:
 *   adminApi.login(username, password) → { token, username }
 *   adminApi.listUsers({ q, limit, offset }) → { items, total, limit, offset }
 *   adminApi.getUser(userId) → { user }
 */

import { ApiError, type ApiErrorBody } from "./api.js";

// `Window.__ENV__` is fully declared in api.ts; we deliberately don't
// re-declare it here so TS doesn't complain about a narrower shape.

const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ||
  (typeof window !== "undefined" ? window.__ENV__?.VITE_API_URL : undefined) ||
  "http://localhost:3000";

const ADMIN_SESSION_KEY = "tb_admin_session";

export function getStoredAdminSession(): string | null {
  try {
    return localStorage.getItem(ADMIN_SESSION_KEY);
  } catch {
    return null;
  }
}

export function setStoredAdminSession(token: string | null): void {
  try {
    if (token) localStorage.setItem(ADMIN_SESSION_KEY, token);
    else localStorage.removeItem(ADMIN_SESSION_KEY);
  } catch {
    /* private mode — session just doesn't persist */
  }
}

interface AdminRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Override the stored admin token. Used by login before persist. */
  token?: string | null;
  query?: Record<string, string | undefined>;
}

async function adminRequest<T>(
  path: string,
  opts: AdminRequestOptions = {},
): Promise<T> {
  const url = new URL(path, API_URL);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";

  const token = opts.token === undefined ? getStoredAdminSession() : opts.token;
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
      /* non-JSON body */
    }
  }
  if (!res.ok) {
    throw new ApiError(res.status, parsed as ApiErrorBody | undefined, `HTTP ${res.status}`);
  }
  return parsed as T;
}

// ---------- response types ----------

export interface AdminLoginResponse {
  token: string;
  username: string;
}

export interface AdminUserListItem {
  userId: string;
  email: string | null;
  displayName: string | null;
  plan: "trial" | "plus" | "super" | "ultra" | null;
  emailVerified: boolean;
  newapiUserId: number | null;
  createdAt: string;
}

export interface AdminUserListResponse {
  items: AdminUserListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminUserDetail {
  userId: string;
  email: string | null;
  displayName: string | null;
  phone: string | null;
  emailVerified: boolean;
  createdAt: string;
  newapi: {
    userId: number | null;
    username: string | null;
    password: string | null;
  };
  subscription: {
    plan: "trial" | "plus" | "super" | "ultra" | null;
    startedAt: string | null;
    expiresAt: string | null;
    dailyQuotaUsd: number | null;
    nextResetAt: string | null;
  };
}

// ---------- public surface ----------

export const adminApi = {
  login(username: string, password: string): Promise<AdminLoginResponse> {
    return adminRequest<AdminLoginResponse>("/v1/admin/login", {
      method: "POST",
      body: { username, password },
      token: null,
    });
  },

  listUsers(input: {
    q?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<AdminUserListResponse> {
    return adminRequest<AdminUserListResponse>("/v1/admin/users", {
      query: {
        q: input.q,
        limit: input.limit !== undefined ? String(input.limit) : undefined,
        offset: input.offset !== undefined ? String(input.offset) : undefined,
      },
    });
  },

  getUser(userId: string): Promise<{ user: AdminUserDetail }> {
    return adminRequest<{ user: AdminUserDetail }>(
      `/v1/admin/users/${encodeURIComponent(userId)}`,
    );
  },
};
