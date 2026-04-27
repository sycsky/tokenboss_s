/**
 * MD5(sortedParams + secret) signing — shared by epusdt and xunhupay.
 *
 * Both gateways use the same algorithm, only differing in:
 *   • the field that holds the signature (`signature` vs `hash`)
 *   • the field set itself (epusdt has `pid`, xunhupay has `appid` etc.)
 *
 * Rules:
 *   • ASCII (string) sort by key ascending
 *   • drop entries whose value is null / undefined / empty string
 *   • the signature field itself is excluded from the digest
 *   • numeric values are stringified with no trailing zeros
 *     (matches Go's `strconv.FormatFloat(v, 'f', -1, 64)`)
 */
import crypto from "node:crypto";

export interface SignOptions {
  /** Field names that must NOT be included in the digest (e.g. "signature", "hash"). */
  excludeKeys?: string[];
}

function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    // Trim trailing zeros: 100 → "100", 100.5 → "100.5", 100.5000 → "100.5"
    if (Number.isInteger(v)) return v.toString();
    return v.toString();
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

export function buildSignString(
  params: Record<string, unknown>,
  opts: SignOptions = {},
): string {
  const skip = new Set(opts.excludeKeys ?? []);
  const entries = Object.keys(params)
    .filter((k) => !skip.has(k))
    .map((k) => [k, stringifyValue(params[k])] as const)
    .filter(([, v]) => v !== "")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.map(([k, v]) => `${k}=${v}`).join("&");
}

export function md5KsortSign(
  params: Record<string, unknown>,
  secret: string,
  opts: SignOptions = {},
): string {
  const str = buildSignString(params, opts);
  return crypto.createHash("md5").update(str + secret).digest("hex");
}

/**
 * Constant-time string compare to avoid a timing oracle on signature checks.
 * Returns false when lengths differ — `crypto.timingSafeEqual` throws in
 * that case, so we short-circuit it.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
