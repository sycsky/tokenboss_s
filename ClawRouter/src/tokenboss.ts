/**
 * TokenBoss Mode
 *
 * This module configures ClawRouter to route requests through the TokenBoss
 * backend. TokenBoss mode is always active — x402 payment and wallet logic
 * have been removed. All upstream requests target TOKENBOSS_API_URL and use
 * the bearer token from TOKENBOSS_API_KEY.
 */

const API_URL_ENV = "TOKENBOSS_API_URL";
const API_KEY_ENV = "TOKENBOSS_API_KEY";

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
 * Returns the TokenBoss configuration object with upstream URL and API key.
 * Used to validate that required env vars are set at startup.
 */
export function getTokenBossConfig(): { upstream: string; apiKey: string } | undefined {
  const upstream = getTokenBossUpstream();
  const apiKey = getTokenBossApiKey();
  if (!upstream || !apiKey) return undefined;
  return { upstream, apiKey };
}

/** Fetch signature matching upstream fetch usage. */
type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Creates a fetch replacement that injects
 * `Authorization: Bearer <tb_live_xxx>` into every outgoing request.
 * Used as the sole upstream fetch function — TokenBoss mode is always active.
 *
 * Throws if TOKENBOSS_API_KEY is not set.
 */
export function createTokenBossFetch(): FetchFn {
  const apiKey = getTokenBossApiKey();
  if (!apiKey) {
    throw new Error(
      `${API_KEY_ENV} is not set. Set it to your tb_live_xxx proxy key and set ${API_URL_ENV} to your TokenBoss API URL.`,
    );
  }
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${apiKey}`);
    return fetch(input, { ...init, headers });
  };
}
