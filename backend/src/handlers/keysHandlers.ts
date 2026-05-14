/**
 * API key management for the web dashboard.
 *
 * Keys are newapi tokens (`sk-xxx`) — TokenBoss no longer mints its own
 * layer on top. These handlers sign into newapi as the caller (using the
 * password stored at registration time) and proxy the call through.
 *
 * GET    /v1/keys              — list the user's tokens (newapi truncates
 *                                the raw key, so `key` here is masked;
 *                                the plaintext is only returned from POST)
 * POST   /v1/keys              — create a new token, returns plaintext once
 * DELETE /v1/keys/{tokenId}    — delete a token (admin API; owner-checked)
 *
 * All routes are session-authed.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { createHash } from "node:crypto";

import { isAuthFailure, verifySessionHeader, type AuthContext } from "../lib/auth.js";
import { isNewapiConfigured, newapi, NewapiError } from "../lib/newapi.js";
import { newapiUsername } from "../lib/newapiIdentity.js";
import { putApiKeyIndex, deleteApiKeyIndex } from "../lib/store.js";

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function jsonResponse(
  statusCode: number,
  body: unknown,
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function jsonError(
  statusCode: number,
  type: string,
  message: string,
  code?: string,
): APIGatewayProxyResultV2 {
  return jsonResponse(statusCode, {
    error: { type, message, ...(code ? { code } : {}) },
  });
}

async function requireSession(event: APIGatewayProxyEventV2) {
  const authHeader =
    event.headers?.authorization ?? event.headers?.Authorization ?? undefined;
  return verifySessionHeader(authHeader);
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

/**
 * Guard every handler with the same "newapi must be configured and the
 * user must be linked to a newapi account" check. Without it there's
 * nothing meaningful to proxy to.
 */
export function requireNewapiLink(
  auth: AuthContext,
): APIGatewayProxyResultV2 | null {
  if (!isNewapiConfigured()) {
    return jsonError(
      503,
      "service_unavailable",
      "Key management is unavailable — newapi is not configured.",
      "newapi_not_configured",
    );
  }
  if (auth.user.newapiUserId === undefined || !auth.user.newapiPassword) {
    return jsonError(
      409,
      "conflict",
      "This account is not linked to newapi. Re-register or contact support.",
      "newapi_not_linked",
    );
  }
  return null;
}

export function handleNewapiError(err: unknown): APIGatewayProxyResultV2 {
  const msg = err instanceof NewapiError ? err.message : (err as Error).message;
  const status = err instanceof NewapiError ? err.status || 502 : 502;
  // Translate the per-IP login rate-limit (newapi 429) into a clearer
  // 503 + retryable hint, instead of the raw "loginUser: ..." string,
  // so the dashboard can show "请稍后再试" rather than a noisy stack trace.
  if (err instanceof NewapiError && err.status === 429) {
    return jsonError(
      503,
      "service_unavailable",
      "上游短暂限流，请等几十秒再重试。",
      "newapi_rate_limited",
    );
  }
  return jsonError(status, "upstream_error", msg);
}

/**
 * Mask a raw `sk-xxx` key for list display. newapi's list endpoint already
 * returns a truncated form (starts with `sk-`, middle redacted), so we
 * just return it as-is; this helper is kept for clarity.
 */
function maskKey(key: string | undefined): string {
  if (!key) return "";
  if (key.length <= 12) return key;
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

// ---------- GET /v1/keys ----------

export const listKeysHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const auth = await requireSession(event);
  if (isAuthFailure(auth)) {
    return jsonError(auth.status, "authentication_error", auth.message, auth.code);
  }
  const guard = requireNewapiLink(auth);
  if (guard) return guard;

  try {
    const session = await newapi.loginUser({
      username: newapiUsername(auth.userId),
      password: auth.user.newapiPassword as string,
    });
    const tokens = await newapi.listUserTokens(session);
    return jsonResponse(200, {
      keys: tokens.map((t) => ({
        keyId: t.id,
        key: maskKey(t.key),
        label: t.name,
        createdAt: new Date(t.created_time * 1000).toISOString(),
        disabled: t.status !== 1,
        expiresAt: t.expired_time === -1 ? null : new Date(t.expired_time * 1000).toISOString(),
      })),
    });
  } catch (err) {
    return handleNewapiError(err);
  }
};

// ---------- POST /v1/keys ----------

export const createKeyHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const auth = await requireSession(event);
  if (isAuthFailure(auth)) {
    return jsonError(auth.status, "authentication_error", auth.message, auth.code);
  }
  const guard = requireNewapiLink(auth);
  if (guard) return guard;

  const body = parseJsonBody(event);
  if (!body) return jsonError(400, "invalid_request_error", "Body must be valid JSON.");
  const rawLabel = typeof body.label === "string" ? body.label.trim() : "";
  const label = rawLabel ? rawLabel.slice(0, 64) : "default";

  // expiresInDays: integer >= 1, or omitted/null = permanent.
  let expiredTime = -1;
  let expiresAtISO: string | null = null;
  if (body.expiresInDays !== undefined && body.expiresInDays !== null) {
    if (
      typeof body.expiresInDays !== "number" ||
      !Number.isInteger(body.expiresInDays) ||
      body.expiresInDays < 1 ||
      body.expiresInDays > 36500
    ) {
      return jsonError(
        400,
        "invalid_request_error",
        "expiresInDays must be a positive integer (≤ 36500) or null.",
      );
    }
    const seconds = Math.floor(Date.now() / 1000) + body.expiresInDays * 86400;
    expiredTime = seconds;
    expiresAtISO = new Date(seconds * 1000).toISOString();
  }

  try {
    const session = await newapi.loginUser({
      username: newapiUsername(auth.userId),
      password: auth.user.newapiPassword as string,
    });
    const { tokenId, apiKey } = await newapi.createAndRevealToken({
      session,
      name: label,
      unlimited_quota: true,
      expired_time: expiredTime,
      // Pin every newly minted user token to newapi's "auto" group so the
      // upstream router picks the auto-tier channel rather than whichever
      // channel the user's account-level group resolves to.
      group: "auto",
    });
    // Index the raw key's hash so chatProxyCore can resolve sk-xxx → userId
    // without storing the plaintext or hitting newapi on every request.
    try {
      putApiKeyIndex({
        userId: auth.userId,
        newapiTokenId: tokenId,
        keyHash: sha256Hex(apiKey),
      });
    } catch (indexErr) {
      // Don't block key creation if the index write fails — the user gets
      // the key, but direct sk-xxx callers may not get free-tier rewriting
      // until backfill picks it up. Log loudly so we notice.
      console.error("[keys] api_key_index write failed", {
        userId: auth.userId,
        tokenId,
        err: (indexErr as Error).message,
      });
    }
    // Return the FULL key exactly once — the list view masks it from then on.
    return jsonResponse(201, {
      keyId: tokenId,
      key: apiKey,
      label,
      createdAt: new Date().toISOString(),
      disabled: false,
      expiresAt: expiresAtISO,
    });
  } catch (err) {
    return handleNewapiError(err);
  }
};

// ---------- DELETE /v1/keys/{keyId} ----------

export const deleteKeyHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const auth = await requireSession(event);
  if (isAuthFailure(auth)) {
    return jsonError(auth.status, "authentication_error", auth.message, auth.code);
  }
  const guard = requireNewapiLink(auth);
  if (guard) return guard;

  const rawId = event.pathParameters?.keyId;
  const tokenId = rawId ? Number(rawId) : NaN;
  if (!Number.isFinite(tokenId)) {
    return jsonError(400, "invalid_request_error", "Missing or invalid key id in path.");
  }

  try {
    // Ownership check: the admin-scoped `deleteToken` can delete any token,
    // so we must confirm this token actually belongs to the caller. Login
    // as the user and scan their token list.
    const session = await newapi.loginUser({
      username: newapiUsername(auth.userId),
      password: auth.user.newapiPassword as string,
    });
    const tokens = await newapi.listUserTokens(session);
    const owned = tokens.find((t) => t.id === tokenId);
    if (!owned) {
      // Don't leak existence: return the same 404 whether it belongs to
      // another user or doesn't exist at all.
      return jsonError(404, "not_found", "Key does not exist.");
    }
    // Delete via the user's session — newapi requires owner auth for
    // hard delete; admin DELETE is silently ignored on some forks.
    await newapi.deleteUserToken(session, tokenId);
    deleteApiKeyIndex(auth.userId, tokenId);
    return jsonResponse(200, { ok: true, keyId: tokenId });
  } catch (err) {
    return handleNewapiError(err);
  }
};
