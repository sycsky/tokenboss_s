/**
 * Auth handlers for the web dashboard.
 *
 * POST /v1/auth/register    — create user (email + password), return JWT
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

import {
  createVerifiedUser,
  revokeTakeoverCredentials,
} from "../lib/accountProvisioning.js";
import { verifySessionHeader, isAuthFailure } from "../lib/auth.js";
import { hashPassword, signSession, verifyPassword } from "../lib/authTokens.js";
import { sendVerificationEmail, sendVerifyLinkEmail } from "../lib/emailService.js";
import { isNewapiConfigured, newapi, NewapiError, newapiQuotaToUsd } from "../lib/newapi.js";
import {
  createEmailVerifyToken,
  consumeEmailVerifyToken,
  consumeVerificationCode,
  bumpUserTokenVersion,
  getUser,
  getUserIdByEmail,
  insertUser,
  isUniqueConstraintError,
  markEmailVerified,
  putEmailIndex,
  recentCodeCount,
  recentEmailVerifyTokenCount,
  saveVerificationCode,
  type UserRecord,
} from "../lib/store.js";

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
 * Build a profile for API responses. `balance` is the user's wallet
 * (topup) balance in USD — `newapi.user.quota / 500_000`, where 500,000
 * raw units = $1. This is INDEPENDENT of subscription quota, which is
 * tracked on the subscription record (amount_total / amount_used) and
 * consumed against that record. Subscription remaining does NOT show up
 * in `balance`.
 *
 * For UI: dashboards show "今日剩 (subscription)" using `/v1/buckets`
 * data, and "钱包余额 (wallet)" using this `balance`. They are two
 * separate buckets of money with different semantics — sub resets daily
 * / monthly per the plan, wallet credits don't reset.
 */
async function buildUserProfile(
  u: UserRecord,
): Promise<Record<string, unknown>> {
  let balance = 0;
  if (isNewapiConfigured() && u.newapiUserId !== undefined) {
    try {
      const nu = await newapi.getUser(u.newapiUserId);
      balance = newapiQuotaToUsd(Math.max(0, nu.quota));
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
  // Stop-loss: do NOT bind the Trial subscription / free $10 credit for new
  // accounts. Existing balances/subscriptions live in newapi and are left
  // untouched by this signup path.
  if (isNewapiConfigured()) {
    const newapiUsername = userId.startsWith("u_") ? userId.slice(2) : userId.slice(0, 20);
    const newapiPassword = randomBytes(12).toString("base64url");
    try {
      const { newapiUserId } = await newapi.provisionUser({
        username: newapiUsername,
        password: newapiPassword,
        // newapi enforces a max length on display_name, so fall back to the
        // newapi username (≤ 20 chars) when the user didn't supply their own.
        display_name: displayName ?? newapiUsername,
        email,
        group: "default",
        quota: 0,
      });
      user.newapiUserId = newapiUserId;
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

  // Create-only insert: a concurrent signup (password, OTP or OAuth) that
  // grabbed this email after our pre-check above must NOT be replaced —
  // INSERT OR REPLACE would delete the winner row and orphan its newapi /
  // oauth bindings. Surface the same 409 the pre-check would have.
  try {
    insertUser(user);
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      if (user.newapiUserId !== undefined) {
        console.warn(
          `[register] duplicate signup race for ${email}: newapi user ${user.newapiUserId} orphaned`,
        );
      }
      return jsonError(
        409,
        "conflict",
        "An account with this email already exists.",
        "email_taken",
      );
    }
    throw err;
  }
  await putEmailIndex(email, userId);

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

  const token = signSession(user.userId, user.tokenVersion ?? 0);
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

  const sessionToken = signSession(user.userId, user.tokenVersion ?? 0);
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

// ---------- POST /v1/auth/logout ----------

/**
 * Invalidate every session token currently in circulation for the caller
 * by bumping `users.tokenVersion`. Stateless JWTs have no server-side
 * revocation list; bumping the embedded `tv` claim's expected value is
 * how we get logout-everywhere semantics without paying for a session
 * table on every request.
 *
 * Idempotent: a second call still bumps the counter, but the first call
 * already invalidated all existing tokens. We don't 401 on a stale
 * token here — if the client thinks it's logging out, we let it.
 * Returns 200 even when the bearer is missing/expired; logout should
 * never appear to fail to the user.
 */
export const logoutHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const authHeader =
    event.headers?.authorization ?? event.headers?.Authorization ?? undefined;
  const auth = await verifySessionHeader(authHeader);
  if (!isAuthFailure(auth)) {
    bumpUserTokenVersion(auth.userId);
  }
  return jsonResponse(200, { ok: true });
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
    // Provision the newapi-side account up front so this user can
    // immediately create keys and call /v1/chat/completions. Consuming
    // the verify-code IS proof the user owns the inbox, so the account
    // lands emailVerified. Stop-loss: OTP-created accounts must NOT
    // auto-bind the Trial subscription or free credit.
    try {
      const created = await createVerifiedUser({ email });
      userId = created.userId;
    } catch (err) {
      console.error(`[verifyCode] newapi provisioning failed for ${email}:`, (err as Error).message);
      return jsonResponse(502, {
        error: "newapi_provision_failed",
        message: "Could not provision account on metering service. Please try again.",
      });
    }
    isNew = true;
  } else {
    // Existing user re-logging via OTP. The act of consuming the code is
    // proof of inbox ownership (same justification as the new-user branch
    // above), so flip emailVerified if it isn't already set. Skip the
    // UPDATE when it's a no-op to avoid a write per login.
    const existing = await getUser(userId);
    if (existing && !existing.emailVerified) {
      // Never-verified row = whoever set its password didn't prove inbox
      // ownership, but this OTP consumer just did. Pre-registration
      // takeover guard: revoke password + sessions + api keys before
      // handing the account over (same rule as the OAuth merge).
      await revokeTakeoverCredentials(userId);
      markEmailVerified(userId);
    }
  }

  // Re-fetch the (possibly just-created or just-verified) user so the
  // response carries the same UserProfile shape as register / login /
  // verifyEmail. Without this the frontend's loginWithCode lands a partial
  // user (emailVerified=undefined) and "邮箱待验证" banner flashes until
  // the next /v1/me hydration.
  const finalUser = await getUser(userId);
  if (!finalUser) {
    return jsonResponse(500, { error: "user_missing_after_verify" });
  }

  const token = signSession(userId, finalUser.tokenVersion ?? 0);
  return jsonResponse(200, {
    token,
    user: await buildUserProfile(finalUser),
    isNew,
  });
}
