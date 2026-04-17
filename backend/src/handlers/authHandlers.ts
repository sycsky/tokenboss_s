/**
 * Auth handlers for the web dashboard.
 *
 * POST /v1/auth/register  — create a user, seed free credits, return JWT
 * POST /v1/auth/login     — verify email/password, return JWT
 * GET  /v1/me             — return current user profile (session-authed)
 *
 * JWT and proxy keys are deliberately separate:
 *   - The JWT authenticates a browser session to these dashboard routes.
 *   - The `tb_live_...` proxy keys authenticate CLI/SDK calls to the chat proxy.
 * Losing one does not compromise the other.
 */

import { randomBytes, randomUUID } from "node:crypto";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

import { verifySessionHeader, isAuthFailure } from "../lib/auth.js";
import { hashPassword, signSession, verifyPassword } from "../lib/authTokens.js";
import { isNewapiConfigured, newapi, NewapiError } from "../lib/newapi.js";
import {
  getUser,
  getUserIdByEmail,
  putEmailIndex,
  putUser,
  type UserRecord,
} from "../lib/store.js";

/**
 * Signup gift, expressed in newapi's internal quota units (500,000 ≈ $1).
 * Default 2,500,000 = $5. Override via env `NEWAPI_SIGNUP_QUOTA`.
 */
function getSignupQuota(): number {
  const raw = process.env.NEWAPI_SIGNUP_QUOTA;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2_500_000;
}

// ---------- helpers ----------

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

function parseJsonBody(event: APIGatewayProxyEventV2): Record<string, unknown> | null {
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Build a profile for API responses. When newapi is configured and the user
 * has a provisioned newapi account, `balance` is the live remaining newapi
 * quota (`quota - used_quota`) — newapi is the single source of truth for
 * billing. The SQLite `balance` column is only a fallback for local dev or
 * legacy users provisioned before newapi was wired in.
 */
async function buildUserProfile(
  u: UserRecord,
): Promise<Record<string, unknown>> {
  let balance = 0;
  if (isNewapiConfigured() && u.newapiUserId !== undefined) {
    try {
      const nu = await newapi.getUser(u.newapiUserId);
      balance = Math.max(0, nu.quota - nu.used_quota);
    } catch (err) {
      console.warn(
        `[userProfile] newapi getUser failed for ${u.userId}:`,
        (err as Error).message,
      );
    }
  }
  return {
    userId: u.userId,
    email: u.email,
    displayName: u.displayName,
    balance,
    freeQuota: getSignupQuota(),
    createdAt: u.createdAt,
  };
}

// ---------- POST /v1/auth/register ----------

export const registerHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const body = parseJsonBody(event);
  if (!body) return jsonError(400, "invalid_request_error", "Body must be valid JSON.");

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : undefined;

  if (!EMAIL_RE.test(email)) {
    return jsonError(400, "invalid_request_error", "Invalid email address.");
  }
  if (password.length < 6) {
    return jsonError(
      400,
      "invalid_request_error",
      "Password must be at least 6 characters.",
    );
  }

  const existing = await getUserIdByEmail(email);
  if (existing) {
    return jsonError(
      409,
      "conflict",
      "An account with this email already exists.",
      "email_taken",
    );
  }

  let passwordHash: string;
  try {
    passwordHash = await hashPassword(password);
  } catch (err) {
    return jsonError(400, "invalid_request_error", (err as Error).message);
  }

  const userId = `u_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const now = new Date().toISOString();
  const user: UserRecord = {
    userId,
    email,
    displayName,
    passwordHash,
    createdAt: now,
  };

  // Provision a matching newapi account + seed signup quota. No API token
  // is created here — users mint their own on demand via `/v1/keys`. The
  // random password we generate is kept server-side so TokenBoss can log
  // in as the user when they later manage tokens through the dashboard.
  //
  // Fail-closed: if newapi is configured but provisioning fails, surface
  // a 502 rather than create a TokenBoss user with no matching newapi
  // account. (Local dev without newapi skips this block entirely.)
  if (isNewapiConfigured()) {
    // newapi caps username at 20 chars; TokenBoss userId is 22 ("u_" + 20
    // hex), so strip the prefix. Password is ≤20 chars too, but only used
    // server-to-server, so ~96 bits of entropy from 12 random bytes is plenty.
    const newapiUsername = userId.startsWith("u_") ? userId.slice(2) : userId.slice(0, 20);
    const newapiPassword = randomBytes(12).toString("base64url");
    try {
      const provisioned = await newapi.provisionUser({
        username: newapiUsername,
        password: newapiPassword,
        display_name: displayName ?? email,
        email,
        quota: getSignupQuota(),
      });
      user.newapiUserId = provisioned.newapiUserId;
      user.newapiPassword = newapiPassword;
    } catch (err) {
      const msg = err instanceof NewapiError ? err.message : (err as Error).message;
      console.error(`[register] newapi provisioning failed for ${userId}:`, msg);
      return jsonError(
        502,
        "upstream_error",
        "Could not provision account on metering service. Please try again.",
        "newapi_provision_failed",
      );
    }
  }

  await putUser(user);
  await putEmailIndex(email, userId);

  const token = signSession(userId);
  return jsonResponse(201, {
    token,
    user: await buildUserProfile(user),
  });
};

// ---------- POST /v1/auth/login ----------

export const loginHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const body = parseJsonBody(event);
  if (!body) return jsonError(400, "invalid_request_error", "Body must be valid JSON.");

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return jsonError(400, "invalid_request_error", "Email and password are required.");
  }

  const userId = await getUserIdByEmail(email);
  if (!userId) {
    return jsonError(401, "authentication_error", "Invalid email or password.", "bad_credentials");
  }
  const user = await getUser(userId);
  if (!user || !user.passwordHash) {
    return jsonError(401, "authentication_error", "Invalid email or password.", "bad_credentials");
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return jsonError(401, "authentication_error", "Invalid email or password.", "bad_credentials");
  }

  const token = signSession(user.userId);
  return jsonResponse(200, {
    token,
    user: await buildUserProfile(user),
  });
};

// ---------- GET /v1/me ----------

export const meHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const authHeader =
    event.headers?.authorization ?? event.headers?.Authorization ?? undefined;
  const auth = await verifySessionHeader(authHeader);
  if (isAuthFailure(auth)) {
    return jsonError(auth.status, "authentication_error", auth.message, auth.code);
  }
  return jsonResponse(200, { user: await buildUserProfile(auth.user) });
};
