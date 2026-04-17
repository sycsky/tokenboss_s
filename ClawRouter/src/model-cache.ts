/**
 * Model-list cache.
 *
 * Proxy `/v1/models` used to return a hard-coded static list. In TokenBoss
 * mode, the source of truth for available models is the backend's
 * `/v1/models` endpoint (which proxies newapi). We cache its response in
 * memory with a short TTL so we don't refetch on every request.
 *
 * On miss / failure, fall back to the bundled `buildProxyModelList()` so the
 * proxy keeps working even when the backend is unreachable.
 */

import { buildProxyModelList } from "./proxy.js";
import { getTokenBossUpstream, getTokenBossApiKey } from "./tokenboss.js";

type ModelEntry = {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
};

const TTL_MS = 30 * 60_000;
const FETCH_TIMEOUT_MS = 5_000;

let cache: { entries: ModelEntry[]; expiresAt: number } | null = null;
let inflight: Promise<ModelEntry[]> | null = null;

export function clearModelCache(): void {
  cache = null;
}

export async function getModelsCached(): Promise<ModelEntry[]> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.entries;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const fetched = await fetchModelsFromBackend();
      if (fetched && fetched.length > 0) {
        cache = { entries: fetched, expiresAt: Date.now() + TTL_MS };
        return fetched;
      }
    } catch {
      // fall through to static
    }
    const fallback = buildProxyModelList();
    // Cache fallback briefly so we don't hammer the backend on outage.
    cache = { entries: fallback, expiresAt: Date.now() + 30_000 };
    return fallback;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

async function fetchModelsFromBackend(): Promise<ModelEntry[] | null> {
  const base = getTokenBossUpstream();
  if (!base) return null;
  const apiKey = getTokenBossApiKey();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/v1/models`, {
      method: "GET",
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: unknown };
    if (!Array.isArray(data.data)) return null;
    const created = Math.floor(Date.now() / 1000);
    return data.data
      .map((m): ModelEntry | null => {
        if (!m || typeof m !== "object") return null;
        const r = m as Record<string, unknown>;
        const id = typeof r.id === "string" ? r.id : null;
        if (!id) return null;
        return {
          id,
          object: "model",
          created: typeof r.created === "number" ? r.created : created,
          owned_by:
            typeof r.owned_by === "string"
              ? r.owned_by
              : id.includes("/")
                ? (id.split("/")[0] ?? "tokenboss")
                : "tokenboss",
        };
      })
      .filter((m): m is ModelEntry => m !== null);
  } finally {
    clearTimeout(timer);
  }
}
