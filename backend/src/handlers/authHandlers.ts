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

import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

import { verifySessionHeader, isAuthFailure } from "../lib/auth.js";
import { hashPassword, signSession, verifyPassword } from "../lib/authTokens.js";
import { sendVerificationEmail, sendVerifyLinkEmail } from "../lib/emailService.js";
import { isNewapiConfigured, newapi, NewapiError, newapiQuotaToUsd } from "../lib/newapi.js";
import { getNewapiPlanId } from "../lib/plans.js";
import {
  createEmailVerifyToken,
  consumeEmailVerifyToken,
  consumeVerificationCode,
  getUser,
  getUserIdByEmail,
  markEmailVerified,
  putApiKeyIndex,
  putEmailIndex,
  putUser,
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
 * Build a profile for API responses. `balance` is the user's total
 * spendable USD on newapi (`user.quota / 500_000` — newapi stores quota
 * in raw units where 500,000 = $1). It's an aggregate of subscription
 * remaining + any wallet top-up.
 *
 * Fine-grained subscription state (current plan, expiry, period quota)
 * is intentionally NOT here — frontends call `/v1/buckets` for that and
 * compose with `balance` to show "total wallet" vs "today's allowance"
 * separately. Older versions of this function returned `quota - used`
 * which double-subtracted (newapi.user.quota is already remaining); fix
 * for that incident is to simply convert the raw remaining to USD.
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

/**
 * (formerly grantTrialBucket — bucket model is gone; the equivalent is
 * `users.plan = 'trial'` plus a 1-day subscription bound on newapi via the
 * subscription module. See provisionAndBindTrial below.)
 */

/**
 * Provision a newapi account for a freshly-registered TokenBoss user, then
 * bind them to the Trial subscription plan. Atomicity is best-effort:
 *
 *   • provision failure → throws (caller should 502 the register response)
 *   • bind failure (network, missing env) → logged loud but swallowed; the
 *     user still has a working newapi account at the provisioner default
 *     quota/group, and the cron can attempt re-bind later. Returning a 502
 *     here would be too aggressive for what is effectively a quota perk.
 */
async function provisionAndBindTrial(args: {
  userId: string;
  newapiUsername: string;
  newapiPassword: string;
  displayName: string;
  email: string;
}): Promise<{ newapiUserId: number }> {
  // Don't pass quota/group — the bind below sets both via the configured
  // Trial plan in newapi (1 day duration, $10 total, never resets).
  const provisioned = await newapi.provisionUser({
    username: args.newapiUsername,
    password: args.newapiPassword,
    display_name: args.displayName,
    email: args.email,
  });

  const trialPlanId = getNewapiPlanId("trial");
  if (trialPlanId === null) {
    console.warn(
      `[register] NEWAPI_PLAN_ID_TRIAL not configured — skipping trial bind for ${args.userId}; ` +
        `user will be left in newapi default group with the provisioner's fallback quota`,
    );
    return { newapiUserId: provisioned.newapiUserId };
  }

  try {
    await newapi.bindSubscription({
      userId: provisioned.newapiUserId,
      planId: trialPlanId,
    });
  } catch (err) {
    const msg = err instanceof NewapiError ? err.message : (err as Error).message;
    console.error(
      `[register] trial bind failed for ${args.userId} (newapi user=${provisioned.newapiUserId}): ${msg}`,
    );
    // Swallow — see comment block above. User still has account.
  }

  return { newapiUserId: provisioned.newapiUserId };
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

  // When newapi is configured, provision the matching account up front and
  // bind the Trial subscription. V3 ("newapi-as-truth"): TokenBoss does NOT
  // store the user's plan/expiresAt locally — newapi's subscription module
  // is the only source of truth. /v1/buckets reads it live each time.
  // Bind failures are swallowed inside the helper (see its docstring).
  if (isNewapiConfigured()) {
    const newapiUsername = userId.startsWith("u_") ? userId.slice(2) : userId.slice(0, 20);
    const newapiPassword = randomBytes(12).toString("base64url");
    try {
      const { newapiUserId } = await provisionAndBindTrial({
        userId,
        newapiUsername,
        newapiPassword,
        // newapi enforces a max length on display_name, so fall back to the
        // newapi username (≤ 20 chars) when the user didn't supply their own.
        displayName: displayName ?? newapiUsername,
        email,
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

  putUser(user);
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
        const provisioned = await provisionAndBindTrial({
          userId,
          newapiUsername,
          newapiPassword,
          displayName: newapiUsername,
          email,
        });
        newapiUserId = provisioned.newapiUserId;

        // Auto-create the user's default API key right after provisioning
        // so /onboard/install can render the spell with the key inline,
        // SkillBoss-style. Plaintext is fetched on demand via reveal — we
        // don't store it on our side; newapi keeps it. We DO store the
        // sha256 of the raw key so chatProxyCore can resolve sk-xxx →
        // userId for free-tier model rewriting.
        const session = await newapi.loginUser({
          username: newapiUsername,
          password: newapiPassword,
        });
        const { tokenId, apiKey } = await newapi.createAndRevealToken({
          session,
          name: "default",
          unlimited_quota: true,
        });
        try {
          putApiKeyIndex({
            userId,
            newapiTokenId: tokenId,
            keyHash: createHash("sha256").update(apiKey).digest("hex"),
          });
        } catch (idxErr) {
          console.error(`[verifyCode] api_key_index write failed for ${userId}:`, (idxErr as Error).message);
        }
      } catch (err) {
        const msg = err instanceof NewapiError ? err.message : (err as Error).message;
        console.error(`[verifyCode] newapi provisioning failed for ${userId}:`, msg);
        return jsonResponse(502, {
          error: "newapi_provision_failed",
          message: "Could not provision account on metering service. Please try again.",
        });
      }
    }

    const createdAt = new Date().toISOString();
    putUser({
      userId,
      email,
      displayName: undefined,
      phone: undefined,
      passwordHash: undefined,
      createdAt,
      // The act of consuming the verify-code IS proof the user owns
      // the inbox — mark verified so we don't pester them again.
      emailVerified: true,
      newapiUserId,
      newapiPassword,
    });
    isNew = true;
  } else {
    // Existing user re-logging via OTP. The act of consuming the code is
    // proof of inbox ownership (same justification as the new-user branch
    // above), so flip emailVerified if it isn't already set. Skip the
    // UPDATE when it's a no-op to avoid a write per login.
    const existing = await getUser(userId);
    if (existing && !existing.emailVerified) {
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

  const token = signSession(userId);
  return jsonResponse(200, {
    token,
    user: await buildUserProfile(finalUser),
    isNew,
  });
}
