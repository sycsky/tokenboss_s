/**
 * POST /v1/billing/redeem — apply a redemption code (兑换码) to the
 * caller's quota.
 *
 * Flow:
 *   1. Session auth → user record (must be linked to newapi)
 *   2. Log in to newapi as the user (cached cookie)
 *   3. Forward `{ key: code }` to newapi `POST /api/user/topup`
 *   4. Translate the response — `quotaAdded` is in newapi quota units;
 *      we convert to USD for the dashboard so callers don't have to know
 *      the 500_000 magic factor.
 *
 * Errors:
 *   - 400 invalid_request_error  — code missing / wrong type
 *   - 401 authentication_error   — bad session
 *   - 409 conflict (newapi_not_linked) — user has no newapi account
 *   - 422 invalid_code           — newapi rejected the code (expired /
 *                                  consumed / typo). Surfaces newapi's
 *                                  message verbatim so the user sees the
 *                                  same Chinese explanation they'd get
 *                                  from /console/topup directly.
 *   - 502 upstream_error         — newapi unreachable / unexpected
 *   - 503 service_unavailable    — newapi not configured
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

import {
  isAuthFailure,
  verifySessionHeader,
  type AuthContext,
} from "../lib/auth.js";
import {
  isNewapiConfigured,
  newapi,
  NewapiError,
  newapiQuotaToUsd,
} from "../lib/newapi.js";

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

/** Mirrors authHandlers#register — newapi username = userId without u_ prefix. */
function newapiUsername(userId: string): string {
  return userId.startsWith("u_") ? userId.slice(2) : userId.slice(0, 20);
}

function requireNewapiLink(auth: AuthContext): APIGatewayProxyResultV2 | null {
  if (!isNewapiConfigured()) {
    return jsonError(
      503,
      "service_unavailable",
      "newapi is not configured.",
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

export const redeemHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const auth = await requireSession(event);
  if (isAuthFailure(auth)) {
    return jsonError(auth.status, "authentication_error", auth.message, auth.code);
  }
  const linkErr = requireNewapiLink(auth);
  if (linkErr) return linkErr;

  const body = parseJsonBody(event);
  if (!body) {
    return jsonError(400, "invalid_request_error", "Body must be valid JSON.");
  }
  const codeRaw = body.code;
  if (typeof codeRaw !== "string" || codeRaw.trim().length === 0) {
    return jsonError(
      400,
      "invalid_request_error",
      "code must be a non-empty string.",
      "code_required",
    );
  }
  const code = codeRaw.trim();

  try {
    const session = await newapi.loginUser({
      username: newapiUsername(auth.userId),
      password: auth.user.newapiPassword as string,
    });
    const result = await newapi.redeemCode(session, code);
    return jsonResponse(200, {
      quotaAdded: result.quotaAdded,
      usdAdded: newapiQuotaToUsd(result.quotaAdded),
    });
  } catch (err) {
    if (err instanceof NewapiError) {
      // newapi returns 200+success=false for "invalid code" — we throw a
      // NewapiError with the upstream message preserved. Treat anything
      // that looks like a user-input failure as 422 (semantic 4xx) rather
      // than the raw status (which would 200 → confusing).
      const msg = err.message;
      const isUserInputFailure =
        /redeem|无效|过期|已使用|不存在|invalid|expired|used/i.test(msg);
      const status = isUserInputFailure ? 422 : err.status || 502;
      return jsonError(
        status,
        isUserInputFailure ? "invalid_code" : "upstream_error",
        msg,
      );
    }
    return jsonError(502, "upstream_error", (err as Error).message);
  }
};
