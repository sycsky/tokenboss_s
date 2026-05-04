/**
 * Admin handlers for the ops back office.
 *
 * Distinct from the user-facing auth handlers in `authHandlers.ts`:
 *   - Credentials live in env vars, not the users table. There is exactly
 *     one super-admin per deploy.
 *   - Returns the user's plaintext newapiPassword on the detail endpoint
 *     so ops can SSH-less debug a user's newapi account. This is the
 *     entire reason the back office exists; do NOT re-redact this field.
 *   - In-memory IP brute-force lockout (see lib/adminAuth.ts) — a Zeabur
 *     restart wipes it, fine for a single ops user.
 *   - Login failures sleep ~800ms before responding so an attacker can't
 *     spin tens of thousands of attempts a minute even before the lockout
 *     kicks in.
 *
 * Routes (all under /v1/admin):
 *   POST  /login            — exchange username+password for an admin JWT
 *   GET   /users?q&limit&offset — paginated list (search across email/userId/displayName)
 *   GET   /users/{userId}   — single user with newapi creds
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

import {
  checkAdminCreds,
  clearIpFailures,
  isAdminAuthFailure,
  isAdminConfigured,
  isIpLocked,
  recordIpFailure,
  signAdminSession,
  verifyAdminHeader,
} from "../lib/adminAuth.js";
import { newapiUsername } from "../lib/newapiIdentity.js";
import { getUser, listUsers } from "../lib/store.js";

// ---------- Tunables ----------

const FAILED_LOGIN_DELAY_MS = 800;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

// ---------- Response helpers ----------

function jsonResponse(
  statusCode: number,
  body: unknown,
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function jsonError(
  statusCode: number,
  type: string,
  message: string,
  code?: string,
): APIGatewayProxyResultV2 {
  return jsonResponse(statusCode, {
    error: { type, message, ...(code ? { code } : {}) },
  });
}

function parseJsonBody(
  event: APIGatewayProxyEventV2,
): Record<string, unknown> | null {
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? "", "base64").toString("utf8")
      : (event.body ?? "");
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Extract a stable client IP for the lockout key. Local dev (`local.ts`)
 * always populates `requestContext.http.sourceIp`; if absent, fall back to
 * the synthetic `unknown` bucket so all attackers from missing-IP paths
 * share one budget rather than getting infinite attempts.
 */
function clientIp(event: APIGatewayProxyEventV2): string {
  const ip = event.requestContext?.http?.sourceIp;
  return typeof ip === "string" && ip.length > 0 ? ip : "unknown";
}

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function requireAdminAuth(event: APIGatewayProxyEventV2) {
  const authHeader =
    event.headers?.authorization ?? event.headers?.Authorization ?? undefined;
  return verifyAdminHeader(authHeader);
}

// ---------- POST /v1/admin/login ----------

export const adminLoginHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  if (!isAdminConfigured()) {
    return jsonError(
      503,
      "service_unavailable",
      "Admin console is not enabled. Set TB_ADMIN_USERNAME and TB_ADMIN_PASSWORD.",
      "admin_not_configured",
    );
  }

  const ip = clientIp(event);
  if (isIpLocked(ip)) {
    // Don't reveal precise lockout window — generic 429.
    return jsonError(
      429,
      "rate_limited",
      "Too many failed attempts. Try again later.",
      "ip_locked",
    );
  }

  const body = parseJsonBody(event);
  if (!body) {
    return jsonError(400, "invalid_request_error", "Body must be valid JSON.");
  }
  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) {
    return jsonError(
      400,
      "invalid_request_error",
      "username and password are required.",
    );
  }

  let ok: boolean;
  try {
    ok = checkAdminCreds(username, password);
  } catch (err) {
    // Misconfig (e.g. weak password in production) — surface as 503 so the
    // operator notices, rather than masquerading as a credential failure.
    return jsonError(
      503,
      "service_unavailable",
      (err as Error).message,
      "admin_misconfigured",
    );
  }

  if (!ok) {
    recordIpFailure(ip);
    await delay(FAILED_LOGIN_DELAY_MS);
    return jsonError(
      401,
      "authentication_error",
      "Invalid username or password.",
      "invalid_credentials",
    );
  }

  clearIpFailures(ip);
  const token = signAdminSession(username);
  return jsonResponse(200, { token, username });
};

// ---------- GET /v1/admin/users ----------

export const adminListUsersHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  if (!isAdminConfigured()) {
    return jsonError(503, "service_unavailable", "Admin console is not enabled.");
  }
  const auth = await requireAdminAuth(event);
  if (isAdminAuthFailure(auth)) {
    return jsonError(auth.status, "authentication_error", auth.message, auth.code);
  }

  const qs = event.queryStringParameters ?? {};
  const q = (qs.q ?? "").trim();
  const limit = clampInt(qs.limit, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const offset = clampInt(qs.offset, 0, 0, Number.MAX_SAFE_INTEGER);

  const { items, total } = listUsers({ q, limit, offset });
  return jsonResponse(200, {
    items: items.map((u) => ({
      userId: u.userId,
      email: u.email ?? null,
      displayName: u.displayName ?? null,
      plan: u.plan ?? null,
      emailVerified: u.emailVerified === true,
      newapiUserId: u.newapiUserId ?? null,
      createdAt: u.createdAt,
    })),
    total,
    limit,
    offset,
  });
};

function clampInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// ---------- GET /v1/admin/users/{userId} ----------

export const adminGetUserHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  if (!isAdminConfigured()) {
    return jsonError(503, "service_unavailable", "Admin console is not enabled.");
  }
  const auth = await requireAdminAuth(event);
  if (isAdminAuthFailure(auth)) {
    return jsonError(auth.status, "authentication_error", auth.message, auth.code);
  }

  const userId = event.pathParameters?.userId;
  if (!userId) {
    return jsonError(400, "invalid_request_error", "Missing userId in path.");
  }
  const user = await getUser(userId);
  if (!user) {
    return jsonError(404, "not_found", "User not found.");
  }

  return jsonResponse(200, {
    user: {
      userId: user.userId,
      email: user.email ?? null,
      displayName: user.displayName ?? null,
      phone: user.phone ?? null,
      emailVerified: user.emailVerified === true,
      createdAt: user.createdAt,
      newapi: {
        userId: user.newapiUserId ?? null,
        // The username we provisioned the user with — what they would type
        // into newapi's login form. Computed deterministically.
        username: user.newapiUserId !== undefined ? newapiUsername(user.userId) : null,
        // Plaintext. The whole point of this endpoint. See the file header.
        password: user.newapiPassword ?? null,
      },
      subscription: {
        plan: user.plan ?? null,
        startedAt: user.subscriptionStartedAt ?? null,
        expiresAt: user.subscriptionExpiresAt ?? null,
        dailyQuotaUsd: user.dailyQuotaUsd ?? null,
        nextResetAt: user.quotaNextResetAt ?? null,
      },
    },
  });
};
