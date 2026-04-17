/**
 * Session authentication for the web dashboard (HS256 JWT).
 *
 * The chat proxy (`/v1/chat/completions`) is no longer authed by TokenBoss
 * — it forwards the caller's `Authorization: Bearer sk-xxx` straight to
 * newapi, which handles key verification and billing. This module only
 * serves the session-authed routes: `/v1/me`, `/v1/keys`, `/v1/usage`.
 */

import { verifySession } from "./authTokens.js";
import { getUser, type UserRecord } from "./store.js";

export interface AuthContext {
  userId: string;
  user: UserRecord;
}

export interface AuthFailure {
  status: number;
  code: string;
  message: string;
}

/**
 * Pulls the raw token out of an `Authorization: Bearer <token>` header.
 * Returns `null` when the header is missing, malformed, or not using Bearer.
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

/** Type guard to distinguish success from failure on auth results. */
export function isAuthFailure(
  result: AuthContext | AuthFailure,
): result is AuthFailure {
  return (result as AuthFailure).status !== undefined;
}

/** Verify the JWT session token from a Bearer header and load the user. */
export async function verifySessionHeader(
  authHeader: string | undefined,
): Promise<AuthContext | AuthFailure> {
  const token = extractBearerToken(authHeader);
  if (!token) {
    return {
      status: 401,
      code: "missing_session",
      message: "Missing Authorization header. Expected: Authorization: Bearer <session token>.",
    };
  }
  const claims = verifySession(token);
  if (!claims) {
    return {
      status: 401,
      code: "invalid_session",
      message: "Session token invalid or expired. Please log in again.",
    };
  }
  const user = await getUser(claims.sub);
  if (!user) {
    return {
      status: 401,
      code: "orphan_session",
      message: "Session references a user that no longer exists.",
    };
  }
  return { userId: user.userId, user };
}
