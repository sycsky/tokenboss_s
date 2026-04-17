/**
 * TokenBoss Fork Mode
 *
 * This module enables ClawRouter to route requests through a TokenBoss
 * backend instead of BlockRun. Activated when both TOKENBOSS_API_URL and
 * TOKENBOSS_API_KEY environment variables are set.
 *
 * In TokenBoss mode:
 *   - Upstream requests target TOKENBOSS_API_URL (e.g. https://api.tokenboss.co)
 *   - Each request gets `Authorization: Bearer <TOKENBOSS_API_KEY>` injected
 *   - The x402 payment flow and wallet generation are bypassed entirely
 *   - All routing, compression, caching, and slash-command logic still runs
 *
 * This is a minimal intervention — the x402 code path is left intact so
 * ClawRouter still works in its original BlockRun mode when these env vars
 * are not set. Full x402 removal is tracked as a follow-up cleanup.
 */

const API_URL_ENV = "TOKENBOSS_API_URL";
const API_KEY_ENV = "TOKENBOSS_API_KEY";

/**
 * Dummy EVM private key used as a placeholder for the wallet resolver in
 * TokenBoss mode. `privateKeyToAccount()` accepts this value (it's a valid
 * secp256k1 scalar), so downstream code that still reads `account.address`
 * keeps working. The key is NEVER used to sign anything in TokenBoss mode
 * because the x402 code path is not taken.
 */
export const TOKENBOSS_DUMMY_WALLET_KEY =
  "0x0000000000000000000000000000000000000000000000000000000000000001";

/**
 * Returns the TokenBoss upstream base URL, or undefined if not set.
 * The URL should NOT include a trailing slash, and should be the API origin
 * (e.g. "https://api.tokenboss.co") — the proxy appends paths like
 * "/v1/chat/completions" directly.
 */
export function getTokenBossUpstream(): string | undefined {
  const raw = process.env[API_URL_ENV]?.trim();
  if (!raw) return undefined;
  return raw.replace(/\/+$/, "");
}

/**
 * Returns the TokenBoss proxy API key (`tb_live_xxx`), or undefined.
 */
export function getTokenBossApiKey(): string | undefined {
  return process.env[API_KEY_ENV]?.trim() || undefined;
}

/**
 * True when both TOKENBOSS_API_URL and TOKENBOSS_API_KEY are set.
 * Single source of truth for "are we in TokenBoss mode."
 */
export function isTokenBossMode(): boolean {
  return Boolean(getTokenBossUpstream() && getTokenBossApiKey());
}

/** Fetch signature matching the one used by payment-preauth.ts. */
type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Creates a fetch replacement that injects
 * `Authorization: Bearer <tb_live_xxx>` into every outgoing request.
 * Used as a drop-in substitute for the x402 `payFetch` when TokenBoss mode
 * is active.
 *
 * Throws if called without `TOKENBOSS_API_KEY` set — callers should gate on
 * `isTokenBossMode()` first.
 */
export function createTokenBossFetch(): FetchFn {
  const apiKey = getTokenBossApiKey();
  if (!apiKey) {
    throw new Error(
      `${API_KEY_ENV} is not set. Set it to your tb_live_xxx proxy key, ` +
        `or unset ${API_URL_ENV} to disable TokenBoss mode.`,
    );
  }
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${apiKey}`);
    return fetch(input, { ...init, headers });
  };
}
