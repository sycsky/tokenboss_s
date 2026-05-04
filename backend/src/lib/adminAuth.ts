/**
 * Admin session authentication.
 *
 * Distinct from the user session in `auth.ts` / `authTokens.ts`:
 *   - Admin credentials live in env vars (TB_ADMIN_USERNAME / TB_ADMIN_PASSWORD)
 *     — there is no admin row in the SQLite users table. Single super-admin.
 *   - Admin JWTs are signed with the same SESSION_SECRET as user JWTs but
 *     carry a `role: "admin"` claim that user-route verifiers reject and
 *     this verifier requires. The two surfaces cannot cross.
 *   - Admin JWTs use the user-JWT TTL (7 days) — long enough for an ops
 *     session, short enough that an exfil token expires on its own.
 *
 * This file contains: cred check, sign, verify, header guard, env-config
 * gate, in-memory IP brute-force lockout. Handlers use only the exports.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  base64urlEncode,
  base64urlDecode,
  getSecret,
  SESSION_TTL_SECONDS,
} from "./authTokens.js";

// ---------- Config ----------

/**
 * In production, refuse to expose the admin route with a weak password.
 * Anything shorter than this is brute-forceable in minutes against a
 * public dashboard. In dev / CI the guard is off so test setups can use
 * short literals like 'pwd'.
 */
const MIN_ADMIN_PASSWORD_LENGTH = 12;

/** True when both env vars are non-empty. Handlers use this to return 503
 *  cleanly when the operator hasn't enabled admin mode at all (rather than
 *  letting login attempts hang on undefined comparisons). */
export function isAdminConfigured(): boolean {
  return !!(process.env.TB_ADMIN_USERNAME && process.env.TB_ADMIN_PASSWORD);
}

/**
 * Validate the admin env vars. Called by adminLoginHandler before the cred
 * compare so we surface misconfiguration loudly. In production a too-short
 * password throws; the handler converts that to a 503 so the route still
 * doesn't accept any login attempt.
 */
function getAdminCreds(): { username: string; password: string } {
  const username = process.env.TB_ADMIN_USERNAME;
  const password = process.env.TB_ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error("TB_ADMIN_USERNAME / TB_ADMIN_PASSWORD not set");
  }
  if (
    process.env.NODE_ENV === "production" &&
    password.length < MIN_ADMIN_PASSWORD_LENGTH
  ) {
    throw new Error(
      `TB_ADMIN_PASSWORD must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters in production. ` +
        "Refusing to enable the admin route with a weak credential.",
    );
  }
  return { username, password };
}

// ---------- Cred verify (constant-time) ----------

/**
 * Compare submitted username + password against env. Both fields go through
 * timingSafeEqual after a length-equalised buffer copy so a wrong-length
 * input doesn't shortcut the comparison. Returns true only when BOTH match.
 */
export function checkAdminCreds(username: string, password: string): boolean {
  if (!isAdminConfigured()) return false;
  const env = getAdminCreds();
  return safeEq(username, env.username) && safeEq(password, env.password);
}

function safeEq(a: string, b: string): boolean {
  // Pad to equal length so timingSafeEqual doesn't throw, but always run
  // both paths so the timing is bounded by max(len). The OR keeps wrong-
  // length inputs from short-circuiting (the buffer copy + compare runs
  // regardless; the `&&` at the end gates the result).
  const maxLen = Math.max(a.length, b.length, 1);
  const bufA = Buffer.alloc(maxLen);
  const bufB = Buffer.alloc(maxLen);
  bufA.write(a);
  bufB.write(b);
  return timingSafeEqual(bufA, bufB) && a.length === b.length;
}

// ---------- IP lockout (in-memory) ----------
//
// 5 failed logins from one IP in 15 minutes locks that IP out for 15 more
// minutes. State lives in-memory only; Zeabur restarts wipe it. This is a
// cheap brute-force speed bump — the constant-time compare and 800 ms
// failure delay matter more for actual security. We don't enforce a global
// rate limit because there is exactly one admin and one expected source IP.

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

interface IpRecord {
  failures: number;
  /** Earliest failure in the current sliding window. */
  windowStart: number;
  lockedUntil: number | null;
}

const ipRecords = new Map<string, IpRecord>();

/** True when the IP is currently locked. Updates the record's window
 *  expiry lazily so callers don't need a separate cleanup tick. */
export function isIpLocked(ip: string): boolean {
  const rec = ipRecords.get(ip);
  if (!rec) return false;
  const now = Date.now();
  if (rec.lockedUntil !== null && rec.lockedUntil > now) {
    return true;
  }
  if (rec.lockedUntil !== null && rec.lockedUntil <= now) {
    ipRecords.delete(ip);
    return false;
  }
  if (now - rec.windowStart > LOCKOUT_WINDOW_MS) {
    ipRecords.delete(ip);
    return false;
  }
  return false;
}

/** Record a failed login from this IP. Locks the IP after threshold. */
export function recordIpFailure(ip: string): void {
  const now = Date.now();
  const rec = ipRecords.get(ip);
  if (!rec) {
    ipRecords.set(ip, { failures: 1, windowStart: now, lockedUntil: null });
    return;
  }
  if (now - rec.windowStart > LOCKOUT_WINDOW_MS) {
    rec.failures = 1;
    rec.windowStart = now;
    rec.lockedUntil = null;
    return;
  }
  rec.failures += 1;
  if (rec.failures >= LOCKOUT_THRESHOLD) {
    rec.lockedUntil = now + LOCKOUT_WINDOW_MS;
  }
}

/** Successful login clears the failure counter for this IP. */
export function clearIpFailures(ip: string): void {
  ipRecords.delete(ip);
}

// ---------- Sign / verify ----------

interface AdminClaims {
  /** Always equals the env username at issue time. The user-route verifier
   *  rejects any JWT carrying a `role` claim, so this name doesn't
   *  collide with user `sub` (a userId). */
  sub: string;
  role: "admin";
  iat: number;
  exp: number;
}

/** Sign an admin JWT. The sub is the username so multiple admin sessions
 *  (rotating creds across deploys) can be reasoned about, but the auth
 *  decision still pivots on `role === "admin"`. */
export function signAdminSession(username: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const nowSec = Math.floor(Date.now() / 1000);
  const claims: AdminClaims = {
    sub: username,
    role: "admin",
    iat: nowSec,
    exp: nowSec + SESSION_TTL_SECONDS,
  };
  const headerB64 = base64urlEncode(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64urlEncode(Buffer.from(JSON.stringify(claims)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = createHmac("sha256", getSecret()).update(signingInput).digest();
  return `${signingInput}.${base64urlEncode(sig)}`;
}

export interface AdminContext {
  username: string;
}

export interface AuthFailure {
  status: number;
  code: string;
  message: string;
}

export function isAdminAuthFailure(
  res: AdminContext | AuthFailure,
): res is AuthFailure {
  return (res as AuthFailure).status !== undefined;
}

/**
 * Verify an admin JWT. Returns the claims (with role === "admin" gated)
 * or null on any defect: bad signature, expired, missing/wrong role.
 * Mirrors verifySession's pattern but enforces the role claim.
 */
export function verifyAdminSession(token: string): AdminClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;

  const expectedSig = createHmac("sha256", getSecret())
    .update(signingInput)
    .digest();
  const providedSig = base64urlDecode(sigB64);
  if (
    providedSig.length !== expectedSig.length ||
    !timingSafeEqual(providedSig, expectedSig)
  ) {
    return null;
  }

  let claims: AdminClaims;
  try {
    claims = JSON.parse(base64urlDecode(payloadB64).toString("utf8")) as AdminClaims;
  } catch {
    return null;
  }
  if (
    typeof claims.sub !== "string" ||
    typeof claims.exp !== "number" ||
    claims.role !== "admin"
  ) {
    return null;
  }
  if (claims.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }
  return claims;
}

/** Header guard: extract Bearer, verify, return AdminContext or AuthFailure
 *  with the same shape user-route handlers use. */
export function verifyAdminHeader(
  authHeader: string | undefined,
): AdminContext | AuthFailure {
  if (!authHeader) {
    return {
      status: 401,
      code: "missing_session",
      message: "Missing Authorization header. Expected: Authorization: Bearer <admin token>.",
    };
  }
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    return {
      status: 401,
      code: "missing_session",
      message: "Missing Authorization header. Expected: Authorization: Bearer <admin token>.",
    };
  }
  const claims = verifyAdminSession(m[1].trim());
  if (!claims) {
    return {
      status: 401,
      code: "invalid_session",
      message: "Admin session invalid or expired. Please log in again.",
    };
  }
  return { username: claims.sub };
}
