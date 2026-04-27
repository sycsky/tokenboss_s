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
import { sendVerificationEmail, sendVerifyLinkEmail } from "../lib/emailService.js";
import { isNewapiConfigured, newapi, NewapiError } from "../lib/newapi.js";
import {
  createBucket,
  createEmailVerifyToken,
  consumeEmailVerifyToken,
  consumeVerificationCode,
  getUser,
  getUserIdByEmail,
  markEmailVerified,
  putEmailIndex,
  putUser,
  recentCodeCount,
  recentEmailVerifyTokenCount,
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
    emailVerified: u.emailVerified === true,
    balance,
    freeQuota: getSignupQuota(),
    createdAt: u.createdAt,
  };
}

/**
 * Issue a fresh verification token for `userId` and dispatch the link
 * email. Throws on email-send failure so the caller can surface a 502 — we
 * don't want to silently create a token the user can't see.
 */
async function issueVerificationLink(
  userId: string,
  email: string,
  displayName?: string,
): Promise<void> {
  const { token } = createEmailVerifyToken(userId, email);
  const appUrl = process.env.APP_URL ?? "http://localhost:5179";
  const link = `${appUrl.replace(/\/$/, "")}/verify-email?token=${encodeURIComponent(token)}`;
  await sendVerifyLinkEmail(email, link, displayName);
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
  if (password.length < 8) {
    return jsonError(
      400,
      "invalid_request_error",
      "Password must be at least 8 characters.",
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
      // newapi enforces a max length on display_name, so fall back to
      // the newapi username (≤ 20 chars) when the user didn't supply
      // their own. Using the full email here breaks for any address
      // longer than newapi's DisplayName cap.
      const provisioned = await newapi.provisionUser({
        username: newapiUsername,
        password: newapiPassword,
        display_name: displayName ?? newapiUsername,
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

  // Send the verification link. If delivery fails (Resend down, no DNS,
  // dev console disabled), keep the account intact and return 201 — the
  // user can still log in and trigger /v1/auth/resend-verification.
  try {
    await issueVerificationLink(userId, email, displayName);
  } catch (err) {
    console.warn(`[register] verification email failed for ${userId}:`, (err as Error).message);
  }

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

// ---------- POST /v1/auth/verify-email ----------

/**
 * Consume a verification token (delivered via email) and mark the user
 * verified. Returns a fresh AuthResponse so the verify page can auto-log
 * the user in — clicking the email link IS proof of email ownership.
 */
export const verifyEmailHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const body = parseJsonBody(event);
  if (!body) return jsonError(400, "invalid_request_error", "Body must be valid JSON.");

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) {
    return jsonError(400, "invalid_request_error", "Missing token.", "missing_token");
  }

  const consumed = consumeEmailVerifyToken(token);
  if (!consumed) {
    return jsonError(
      400,
      "invalid_request_error",
      "验证链接无效或已过期。请重新发送。",
      "invalid_token",
    );
  }

  markEmailVerified(consumed.userId);
  const user = await getUser(consumed.userId);
  if (!user) {
    // Token was valid but user is gone — should not happen, but be defensive.
    return jsonError(404, "not_found", "Account not found.", "user_missing");
  }

  const sessionToken = signSession(user.userId);
  return jsonResponse(200, {
    token: sessionToken,
    user: await buildUserProfile(user),
  });
};

// ---------- POST /v1/auth/resend-verification ----------

/**
 * Authenticated. Re-issues a verification link for the current user. No-op
 * (still 200) if the email is already verified — keeps the client logic
 * simple. Rate-limited: 1 / 60s and 5 / hour per user.
 */
export const resendVerificationHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const authHeader =
    event.headers?.authorization ?? event.headers?.Authorization ?? undefined;
  const auth = await verifySessionHeader(authHeader);
  if (isAuthFailure(auth)) {
    return jsonError(auth.status, "authentication_error", auth.message, auth.code);
  }

  const u = auth.user;
  if (u.emailVerified) {
    return jsonResponse(200, { ok: true, alreadyVerified: true });
  }
  if (!u.email) {
    return jsonError(400, "invalid_request_error", "No email on file.", "no_email");
  }

  if (recentEmailVerifyTokenCount(u.userId, 60) >= 1) {
    return jsonError(429, "rate_limited", "请稍候再试。", "too_soon");
  }
  if (recentEmailVerifyTokenCount(u.userId, 3600) >= 5) {
    return jsonError(429, "rate_limited", "重发次数已达上限，请 1 小时后再试。", "hourly_limit");
  }

  try {
    await issueVerificationLink(u.userId, u.email, u.displayName);
  } catch (err) {
    console.error(`[resend-verification] email send failed for ${u.userId}:`, (err as Error).message);
    return jsonError(502, "upstream_error", "邮件发送失败，请稍后重试。", "email_send_failed");
  }

  return jsonResponse(200, { ok: true });
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

    // Provision the newapi-side account up front so this user can
    // immediately create keys and call /v1/chat/completions. The
    // password-register flow does this too — we mirror it here so
    // the email-code path doesn't ship a half-provisioned user.
    let newapiUserId: number | undefined;
    let newapiPassword: string | undefined;
    if (isNewapiConfigured()) {
      const newapiUsername = userId.slice(2);
      newapiPassword = randomBytes(12).toString("base64url");
      try {
        const provisioned = await newapi.provisionUser({
          username: newapiUsername,
          password: newapiPassword,
          display_name: newapiUsername,
          email,
          quota: getSignupQuota(),
        });
        newapiUserId = provisioned.newapiUserId;
      } catch (err) {
        const msg = err instanceof NewapiError ? err.message : (err as Error).message;
        console.error(`[verifyCode] newapi provisioning failed for ${userId}:`, msg);
        return jsonResponse(502, {
          error: "newapi_provision_failed",
          message: "Could not provision account on metering service. Please try again.",
        });
      }
    }

    putUser({
      userId,
      email,
      displayName: undefined,
      phone: undefined,
      passwordHash: undefined,
      createdAt: new Date().toISOString(),
      // The act of consuming the verify-code IS proof the user owns
      // the inbox — mark verified so we don't pester them again.
      emailVerified: true,
      newapiUserId,
      newapiPassword,
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
