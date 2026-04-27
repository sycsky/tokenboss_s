/**
 * Auth handlers for the web dashboard.
 *
 * POST /v1/auth/register    — create user (email + password), seed trial, return JWT
 * POST /v1/auth/login       — verify email/password, return JWT
 * POST /v1/auth/send-code   — send a 6-digit verification code (passwordless / recovery)
 * POST /v1/auth/verify-code — verify the code, return JWT (creating account if new)
 * GET  /v1/me               — return current user profile (session-authed)
 *
 * Email-code routes stay live alongside password auth so they can back the
 * "forgot password" recovery flow (and CLI integrations that don't carry a
 * password). Email verification on register is deferred to v1.1 once Resend
 * is wired — see B2 in docs/superpowers/specs/2026-04-25-credits-economy-design.md.
 *
 * JWT and proxy keys are deliberately separate:
 *   - The JWT authenticates a browser session to these dashboard routes.
 *   - The `tb_live_...` proxy keys authenticate CLI/SDK calls to the chat proxy.
 * Losing one does not compromise the other.
 */

import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

import { verifySessionHeader, isAuthFailure } from "../lib/auth.js";
import { hashPassword, signSession, verifyPassword } from "../lib/authTokens.js";
import { sendVerificationEmail } from "../lib/emailService.js";
import { isNewapiConfigured, newapi, NewapiError } from "../lib/newapi.js";
import {
  createBucket,
  consumeVerificationCode,
  getUser,
  getUserIdByEmail,
  putEmailIndex,
  putUser,
  recentCodeCount,
  saveVerificationCode,
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

/**
 * Grant the standard signup trial bucket: $10 / 24 h, ECO-only model pool.
 * Mirrors the bucket created by the OTP path so register/OTP paths agree.
 */
function grantTrialBucket(userId: string): void {
  const now = new Date();
  createBucket({
    userId,
    skuType: "trial",
    amountUsd: 10,
    dailyCapUsd: null,
    dailyRemainingUsd: null,
    totalRemainingUsd: 10,
    startedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 24 * 3600e3).toISOString(),
    modeLock: "auto_eco_only",
    modelPool: "eco_only",
  });
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

  const existing = getUserIdByEmail(email);
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

  // When newapi is configured, provision the matching account up front.
  // In local dev (mock upstream) this block is skipped and the trial bucket
  // alone backs the new user. Fail-closed if newapi is configured but
  // returns an error — better a 502 than a TokenBoss user with no upstream.
  if (isNewapiConfigured()) {
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

  putUser(user);
  await putEmailIndex(email, userId);
  grantTrialBucket(userId);

  const token = signSession(userId);
  return jsonResponse(201, {
    token,
    user: await buildUserProfile(user),
    isNew: true,
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

  const userId = getUserIdByEmail(email);
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

// ---------- POST /v1/auth/send-code ----------

function genCode(): string {
  return String(randomInt(100000, 1000000));
}

export async function sendCodeHandler(
  evt: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const body = parseJsonBody(evt);
  if (!body) return jsonResponse(400, { error: "invalid_body" });

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) return jsonResponse(400, { error: "invalid_email" });

  if (recentCodeCount(email, 60) >= 1)
    return jsonResponse(429, { error: "too_many_requests" });
  if (recentCodeCount(email, 3600) >= 5)
    return jsonResponse(429, { error: "too_many_requests" });

  const code = genCode();
  saveVerificationCode(email, code, 300);
  await sendVerificationEmail(email, code);
  return jsonResponse(200, { ok: true });
}

// ---------- POST /v1/auth/verify-code ----------

export async function verifyCodeHandler(
  evt: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const body = parseJsonBody(evt);
  if (!body) return jsonResponse(400, { error: "invalid_body" });

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const code =
    typeof body.code === "string" ? body.code.trim() : "";

  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
    return jsonResponse(400, { error: "invalid_input" });
  }

  if (!consumeVerificationCode(email, code)) {
    return jsonResponse(401, { error: "invalid_or_expired_code" });
  }

  let userId = getUserIdByEmail(email);
  let isNew = false;
  if (!userId) {
    userId = `u_${randomBytes(10).toString("hex")}`;
    putUser({
      userId,
      email,
      displayName: undefined,
      phone: undefined,
      passwordHash: undefined,
      createdAt: new Date().toISOString(),
      newapiUserId: undefined,
      newapiPassword: undefined,
    });
    isNew = true;
    // Grant trial bucket: $10 / 24h / forced ECO
    createBucket({
      userId,
      skuType: "trial",
      amountUsd: 10,
      dailyCapUsd: null,
      dailyRemainingUsd: null,
      totalRemainingUsd: 10,
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 3600e3).toISOString(),
      modeLock: "auto_eco_only",
      modelPool: "eco_only",
    });
  }

  const token = signSession(userId);
  return jsonResponse(200, { token, user: { userId, email }, isNew });
}
