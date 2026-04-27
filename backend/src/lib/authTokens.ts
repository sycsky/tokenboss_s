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
  if (!raw || raw.length < 16) {
    // Local dev fallback: a stable value so tokens survive `tsx watch`
    // restarts. Lambda must set SESSION_SECRET explicitly via the SAM
    // parameter — we crash loudly if it's missing at Lambda runtime.
    if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
      return Buffer.from(
        "tokenboss-local-dev-session-secret-32bytes-min",
        "utf8",
      );
    }
    throw new Error(
      "SESSION_SECRET env var must be set (at least 16 characters) in Lambda runtime.",
    );
  }
  return Buffer.from(raw, "utf8");
}

/** Sign a session token for `userId`. TTL is 7 days. */
export function signSession(userId: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const nowSec = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = {
    sub: userId,
    iat: nowSec,
    exp: nowSec + SESSION_TTL_SECONDS,
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
  return claims;
}
