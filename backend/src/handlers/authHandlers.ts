/**
 * Auth handlers for the web dashboard.
 *
 * POST /v1/auth/send-code  — send a 6-digit verification code to an email
 * POST /v1/auth/verify-code — verify the code, return JWT (creating account if new)
 * GET  /v1/me              — return current user profile (session-authed)
 *
 * JWT and proxy keys are deliberately separate:
 *   - The JWT authenticates a browser session to these dashboard routes.
 *   - The `tb_live_...` proxy keys authenticate CLI/SDK calls to the chat proxy.
 * Losing one does not compromise the other.
 */

import { randomBytes } from "node:crypto";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

import { verifySessionHeader, isAuthFailure } from "../lib/auth.js";
import { signSession } from "../lib/authTokens.js";
import { sendVerificationEmail } from "../lib/emailService.js";
import { isNewapiConfigured, newapi } from "../lib/newapi.js";
import {
  createBucket,
  consumeVerificationCode,
  getUserIdByEmail,
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
  return String(Math.floor(100000 + Math.random() * 900000));
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
