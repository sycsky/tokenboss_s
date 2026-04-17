/**
 * Remote tier config fetcher (TokenBoss mode only).
 *
 * On startup and every `REFRESH_INTERVAL_MS`, fetch the operator's tier
 * mapping from `${TOKENBOSS_API_URL}/v1/router/tiers` and overwrite the
 * `tiers` / `ecoTiers` / `premiumTiers` / `agenticTiers` fields on
 * `DEFAULT_ROUTING_CONFIG` in place. This lets the operator change model
 * routing without shipping a new plugin release.
 *
 * Failures are non-fatal — we log a warning and leave whatever tier config
 * is currently in memory (either the built-in defaults or the last
 * successful remote fetch).
 */

import { getTokenBossUpstream, isTokenBossMode } from "../tokenboss.js";
import { DEFAULT_ROUTING_CONFIG } from "./config.js";
import type { Tier, TierConfig } from "./types.js";

type TierMap = Record<Tier, TierConfig>;

interface RemoteTiersPayload {
  tiers?: TierMap;
  ecoTiers?: TierMap;
  premiumTiers?: TierMap;
  agenticTiers?: TierMap;
}

const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const FETCH_TIMEOUT_MS = 10_000;
const REQUIRED_KEYS = ["SIMPLE", "MEDIUM", "COMPLEX", "REASONING"] as const;

function isValidTierMap(x: unknown): x is TierMap {
  if (!x || typeof x !== "object") return false;
  const rec = x as Record<string, unknown>;
  return REQUIRED_KEYS.every((k) => {
    const t = rec[k];
    if (!t || typeof t !== "object") return false;
    const tc = t as Record<string, unknown>;
    return typeof tc.primary === "string" && Array.isArray(tc.fallback);
  });
}

function applyRemoteTiers(payload: RemoteTiersPayload): string[] {
  const applied: string[] = [];
  if (isValidTierMap(payload.tiers)) {
    DEFAULT_ROUTING_CONFIG.tiers = payload.tiers;
    applied.push("tiers");
  }
  if (isValidTierMap(payload.ecoTiers)) {
    DEFAULT_ROUTING_CONFIG.ecoTiers = payload.ecoTiers;
    applied.push("ecoTiers");
  }
  if (isValidTierMap(payload.premiumTiers)) {
    DEFAULT_ROUTING_CONFIG.premiumTiers = payload.premiumTiers;
    applied.push("premiumTiers");
  }
  if (isValidTierMap(payload.agenticTiers)) {
    DEFAULT_ROUTING_CONFIG.agenticTiers = payload.agenticTiers;
    applied.push("agenticTiers");
  }
  return applied;
}

async function fetchRemoteTiersOnce(baseUrl: string): Promise<void> {
  const url = `${baseUrl}/v1/router/tiers`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      console.warn(
        `[ClawRouter] Remote tier fetch failed: HTTP ${res.status} from ${url}`,
      );
      return;
    }
    const payload = (await res.json()) as RemoteTiersPayload;
    const applied = applyRemoteTiers(payload);
    if (applied.length === 0) {
      console.warn(
        `[ClawRouter] Remote tier payload contained no valid tier maps — keeping local defaults.`,
      );
    } else {
      console.log(
        `[ClawRouter] Applied remote tier config: ${applied.join(", ")}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ClawRouter] Remote tier fetch failed: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

let refreshTimer: NodeJS.Timeout | undefined;

/**
 * Kick off the initial fetch and schedule periodic refresh. No-op when not
 * in TokenBoss mode. Returns the initial-fetch promise so the caller can
 * `await` it on startup if they want the first decision to use remote config.
 */
export function startRemoteTiersRefresh(): Promise<void> {
  if (!isTokenBossMode()) return Promise.resolve();
  const baseUrl = getTokenBossUpstream();
  if (!baseUrl) return Promise.resolve();

  const initial = fetchRemoteTiersOnce(baseUrl);

  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    void fetchRemoteTiersOnce(baseUrl);
  }, REFRESH_INTERVAL_MS);
  // Do not keep the Node event loop alive solely for this timer.
  refreshTimer.unref?.();

  return initial;
}

export function stopRemoteTiersRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
}
