/**
 * Password hashing (scrypt) + session tokens (HS256 JWT).
 *
 * Both are implemented on top of `node:crypto` so we don't pull in any new
 * dependencies. For an MVP this is fine — scrypt is the only KDF we need and
 * JWT is just three base64url segments joined by dots.
 *
 * Security notes:
 *   - Scrypt cost (N=16384) balances latency and resistance to offline crack.
 *   - JWT uses HMAC-SHA256 with a shared secret from `SESSION_SECRET`. No
 *     asymmetric keys, no key rotation: good enough for a single Lambda
 *     function verifying its own tokens.
 *   - Session TTL is 7 days. No refresh tokens.
 *   - There is NO email verification, NO password reset flow, and NO rate
 *     limiting on login attempts. All of those are deferred.
 */

import {
  createHmac,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

// ---------- password ----------

const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_BYTES = 16;

/** Return a serialized scrypt hash: `scrypt$<saltHex>$<hashHex>`. */
export async function hashPassword(plain: string): Promise<string> {
  if (!plain || plain.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = await scrypt(plain, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/** Constant-time password check against a stored hash. */
export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const derived = await scrypt(plain, salt, SCRYPT_KEYLEN);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

// ---------- JWT ----------

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface SessionClaims {
  /** User ID. */
  sub: string;
  /** Issued at (unix seconds). */
  iat: number;
  /** Expiry (unix seconds). */
  exp: number;
  /** Token version snapshot at sign time. Bumped server-side on logout
   *  so all tokens carrying the old value are rejected. Defaults to 0
   *  on legacy tokens issued before this field existed. */
  tv: number;
}

function base64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(s: string): Buffer {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64");
}

function getSecret(): Buffer {
  const raw = process.env.SESSION_SECRET;
  // Production must have a real, non-default secret. We crash loudly
  // rather than fall back to a hardcoded string — a fallback secret
  // checked into source code allows trivial JWT forgery if it ever
  // reaches a deployed environment. The check is gated on
  // NODE_ENV='production' (Dockerfile sets this) so local dev still
  // gets a stable default.
  if (process.env.NODE_ENV === "production") {
    if (!raw || raw.length < 16) {
      throw new Error(
        "SESSION_SECRET env var must be set (>= 16 chars) in production. " +
          "Refusing to start with a default secret.",
      );
    }
    if (raw === "tokenboss-local-dev-session-secret-32bytes-min") {
      throw new Error(
        "SESSION_SECRET is set to the documented local-dev placeholder. " +
          "Generate a fresh random value before deploying.",
      );
    }
    return Buffer.from(raw, "utf8");
  }
  // Non-production: prefer the configured secret, otherwise fall back
  // to a stable string so tokens survive `tsx watch` restarts. Never
  // returned in production because of the guard above.
  if (raw && raw.length >= 16) {
    return Buffer.from(raw, "utf8");
  }
  return Buffer.from(
    "tokenboss-local-dev-session-secret-32bytes-min",
    "utf8",
  );
}

/** Sign a session token for `userId`. TTL is 7 days. `tv` is the user's
 *  current tokenVersion — bumped on logout so old tokens stop verifying. */
export function signSession(userId: string, tokenVersion: number = 0): string {
  const header = { alg: "HS256", typ: "JWT" };
  const nowSec = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = {
    sub: userId,
    iat: nowSec,
    exp: nowSec + SESSION_TTL_SECONDS,
    tv: tokenVersion,
  };
  const headerB64 = base64urlEncode(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64urlEncode(Buffer.from(JSON.stringify(claims)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = createHmac("sha256", getSecret()).update(signingInput).digest();
  return `${signingInput}.${base64urlEncode(sig)}`;
}

/**
 * Verify a session token. Returns the claims on success, or `null` if the
 * token is malformed, expired, or signed with the wrong secret.
 */
export function verifySession(token: string): SessionClaims | null {
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

  let claims: SessionClaims;
  try {
    claims = JSON.parse(base64urlDecode(payloadB64).toString("utf8")) as SessionClaims;
  } catch {
    return null;
  }
  if (typeof claims.sub !== "string" || typeof claims.exp !== "number") {
    return null;
  }
  if (claims.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }
  // Legacy tokens minted before tokenVersion existed have no `tv` field —
  // treat them as tv=0 so they continue to verify against fresh accounts
  // (whose tokenVersion also defaults to 0). Once a logout happens, the
  // user's tokenVersion bumps to 1+ and these legacy tokens stop matching.
  if (typeof claims.tv !== "number") {
    claims.tv = 0;
  }
  return claims;
}
