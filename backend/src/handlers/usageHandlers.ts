/**
 * GET /v1/usage — dashboard usage history.
 *
 * Reads from the upstream newapi instance (the canonical source-of-truth
 * for consume events) instead of TokenBoss's local DB. Local usage_log is
 * no longer written; this handler reshapes `newapi.getLogs` output into
 * the same `UsageRecord` / `UsageAggregate` / `hourly24h` shapes the
 * dashboard already expects, so frontend code is unchanged.
 *
 * Auth: session JWT only. (An earlier "internal-gateway" pattern accepted
 * `x-tb-user-id` as the principal, but TokenBoss is deployed with the
 * Node server directly on the public internet — no edge strips that
 * header — so trusting it was an unauthenticated IDOR. Removed.)
 *
 * Query params (unchanged from the local-DB version):
 *   eventType  — filter records to a single event type (only "consume" is
 *                served from newapi; other types yield empty)
 *   from       — ISO timestamp lower bound (inclusive)
 *   to         — ISO timestamp upper bound (inclusive)
 *   limit      — max records returned (default 50)
 *   offset     — pagination offset (default 0)
 *   aggregateBy — "source" | "keyHint" — group totals by attribute. newapi
 *                 has no `source` notion, so source aggregation always
 *                 returns a single null-keyed group.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

import { isAuthFailure, verifySessionHeader } from "../lib/auth.js";
import {
  getUser,
  getAttributionsForJoin,
  listResetSnapshots,
  type AttributionRecord,
  type SubscriptionSnapshot,
} from "../lib/store.js";
import { newapi, newapiQuotaToUsd, NewapiError, type NewapiLogEntry } from "../lib/newapi.js";
import { newapiUsername } from "../lib/newapiIdentity.js";

// ---------- Helpers ----------

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

const VALID_EVENT_TYPES = ["consume", "reset", "expire", "topup", "refund"] as const;
type EventType = (typeof VALID_EVENT_TYPES)[number];

function isValidEventType(v: string): v is EventType {
  return (VALID_EVENT_TYPES as readonly string[]).includes(v);
}

interface UsageRecordShape {
  id: number | string;
  userId: string;
  bucketId: string | null;
  eventType: "consume" | "reset" | "expire";
  amountUsd: number;
  model: string | null;
  source: string | null;
  keyHint: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  createdAt: string;
}

/** Soft-join newapi log entries with usage_attribution rows. Per spec, the
 *  match is `(userId, model, |capturedAt - created_at| ≤ 5s)`; the closest
 *  attribution wins. Entries with no match get source='other' so the
 *  chat-completions API line is never null. */
function attachSourcesToLogEntries(
  userId: string,
  entries: NewapiLogEntry[],
): Map<number, string> {  // map keyed by entry.id → source slug
  const out = new Map<number, string>();
  if (entries.length === 0) return out;

  // Iterate instead of spreading into Math.min/max — spread blows the
  // call stack at ~10k args on V8, and this is now called with the
  // full 30d window (capped at 5k but close to that limit on heavy
  // users).
  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = Number.NEGATIVE_INFINITY;
  for (const e of entries) {
    if (e.created_at < minTs) minTs = e.created_at;
    if (e.created_at > maxTs) maxTs = e.created_at;
  }
  const minIso = new Date((minTs - 5) * 1000).toISOString();
  const maxIso = new Date((maxTs + 5) * 1000).toISOString();
  const distinctModels = Array.from(new Set(
    entries.map((e) => e.model_name).filter((m): m is string => Boolean(m)),
  ));

  const attributions: AttributionRecord[] = distinctModels.length > 0
    ? getAttributionsForJoin(userId, distinctModels, minIso, maxIso)
    : [];

  for (const entry of entries) {
    let bestSlug: string | null = null;
    let bestDeltaMs = Number.POSITIVE_INFINITY;
    const entryMs = entry.created_at * 1000;
    for (const attr of attributions) {
      if (attr.model !== entry.model_name) continue;
      const captureMs = new Date(attr.capturedAt).getTime();
      const delta = Math.abs(captureMs - entryMs);
      if (delta > 5000) continue;
      if (delta < bestDeltaMs) {
        bestDeltaMs = delta;
        bestSlug = attr.source;
      }
    }
    out.set(entry.id, bestSlug ?? 'other');
  }
  return out;
}

function mapNewapiLog(entry: NewapiLogEntry, userId: string, source: string | null): UsageRecordShape {
  return {
    id: entry.id,
    userId,
    bucketId: null,
    eventType: "consume",
    amountUsd: newapiQuotaToUsd(entry.quota),
    model: entry.model_name ?? null,
    source,                              // <-- pass through from caller
    keyHint: entry.token_name ?? null, // user-friendly token label
    tokensIn: entry.prompt_tokens ?? null,
    tokensOut: entry.completion_tokens ?? null,
    createdAt: new Date(entry.created_at * 1000).toISOString(),
  };
}

function isoToTimestamp(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const d = new Date(iso).getTime();
  return Number.isFinite(d) ? Math.floor(d / 1000) : undefined;
}

/** Default lookback when no `from` is provided. Always "last 30 days"
 *  for every user (sub or not, new or old) — picked over per-cycle
 *  windows because:
 *    - One rule, zero branches.
 *    - Stable across sub resets (no "where did my history go?" jump
 *      when the cycle rolls over).
 *    - Matches industry convention (Stripe / Vercel / GitHub all
 *      default to 近 30 天).
 *  Hero "今日剩" still reads from newapi sub state so cycle-accurate
 *  numbers exist where they matter; this window is for the trend
 *  cards, not for billing accounting. */
const DEFAULT_LOOKBACK_DAYS = 30;
function defaultStartTs(): number {
  // Quantize "now" to the minute before subtracting. Without this, the
  // returned timestamp drifts every second, which makes the upstream
  // cache key (username|startTs|endTs) effectively unique per request
  // and defeats the 60s TTL — neighbouring requests almost never share
  // a cache slot. With minute-quantization, every request inside the
  // same minute lands on the same key and the cache actually hits.
  const minuteMs = 60_000;
  const nowMinuteMs = Math.floor(Date.now() / minuteMs) * minuteMs;
  return Math.floor((nowMinuteMs - DEFAULT_LOOKBACK_DAYS * 86400 * 1000) / 1000);
}

interface FetchAllParams {
  username: string;
  start_timestamp?: number;
  end_timestamp?: number;
}

// In-memory caches for the three upstream call shapes the handler uses.
// All share the same TTL / size / single-flight semantics:
//   - 60s TTL — short enough that "trend numbers lag a minute" is fine.
//     Hero "今日剩" reads sub state directly, not these caches, so
//     billing accuracy is unaffected.
//   - FIFO eviction at CACHE_MAX_ENTRIES bounds memory.
//   - Single-flight: when N callers race on the same cold key, only the
//     first hits newapi; the rest await the same Promise. Without this,
//     the dashboard's two simultaneous /v1/usage requests (records list
//     + keyHint aggregate) both miss the empty cache and both execute
//     the full pagination — same upstream work doubled. Mirrors the
//     loginInFlight pattern in newapi.ts.
//
// Per-process only — no Redis, no cross-instance sharing. Each zeabur
// replica warms its own caches; eventual consistency is fine.
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 200;

interface MemoEntry<T> { expiresAt: number; data: T; }

interface MemoCache<T> {
  cache: Map<string, MemoEntry<T>>;
  inFlight: Map<string, Promise<T>>;
  getOrFetch(key: string, fetch: () => Promise<T>): Promise<T>;
  clear(): void;
}

function makeMemoCache<T>(): MemoCache<T> {
  const cache = new Map<string, MemoEntry<T>>();
  const inFlight = new Map<string, Promise<T>>();
  const getOrFetch = async (key: string, fetch: () => Promise<T>): Promise<T> => {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    const existing = inFlight.get(key);
    if (existing) return existing;
    const p = (async () => {
      const data = await fetch();
      if (cache.size >= CACHE_MAX_ENTRIES) {
        // Map preserves insertion order, so first key is oldest. Strict
        // LRU isn't worth the bookkeeping for a 60s TTL.
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, data });
      return data;
    })();
    inFlight.set(key, p);
    // Drop the in-flight slot once the call settles — success means the
    // cache is now warm; failure means the next caller can retry on its
    // own. Use a no-op catch so the unhandled-rejection path stays clean
    // for callers who didn't subscribe.
    void p.catch(() => undefined).finally(() => inFlight.delete(key));
    return p;
  };
  const clear = (): void => { cache.clear(); inFlight.clear(); };
  return { cache, inFlight, getOrFetch, clear };
}

const consumeLogCache = makeMemoCache<NewapiLogEntry[]>();
const consumeStatCache = makeMemoCache<{ quota: number }>();
const consumeRecentPageCache = makeMemoCache<{ items: NewapiLogEntry[]; total: number }>();

function cacheKeyFor(p: FetchAllParams): string {
  return `${p.username}|${p.start_timestamp ?? ''}|${p.end_timestamp ?? ''}`;
}

/** Test-only: drop every in-memory cache so cases stay isolated. */
export function _clearConsumeLogCacheForTests(): void {
  consumeLogCache.clear();
  consumeStatCache.clear();
  consumeRecentPageCache.clear();
}

/** Pull every consume entry for `username` in the given window. Caps at 5000.
 *  Results are cached per (username, window) for 60s with single-flight. */
async function fetchAllConsumeLogs(p: FetchAllParams): Promise<NewapiLogEntry[]> {
  return consumeLogCache.getOrFetch(cacheKeyFor(p), async () => {
    // newapi's /api/log/ silently caps `size` at 100 server-side regardless
    // of what we request. The previous "items.length < requestedPerPage"
    // EOF check therefore always tripped on page 0 (100 < 1000), so totals
    // and the hourly chart silently froze at the first 100 entries — the
    // exact symptom users hit ("调用次数停在 100"). Drive the loop off the
    // response's own `total` instead, with a hard cap to bound memory /
    // request count for power users.
    const PER_PAGE = 100;
    const HARD_CAP_RECORDS = 5000;
    const HARD_CAP_PAGES = Math.ceil(HARD_CAP_RECORDS / PER_PAGE);
    const all: NewapiLogEntry[] = [];
    for (let page = 0; page < HARD_CAP_PAGES; page++) {
      const res = await newapi.getLogs({
        page,
        per_page: PER_PAGE,
        type: 2,
        username: p.username,
        start_timestamp: p.start_timestamp,
        end_timestamp: p.end_timestamp,
      });
      const items = res?.items ?? [];
      if (items.length === 0) break;
      all.push(...items);
      const total = typeof res?.total === 'number' ? res.total : undefined;
      if (total !== undefined && all.length >= total) break;
      if (all.length >= HARD_CAP_RECORDS) break;
    }
    return all;
  });
}

// ---------- Handler ----------

/**
 * Translate any newapi errors that bubble out of the handler body into a
 * frontend-friendly response. The 429 case in particular: newapi's
 * `/api/user/login` rate-limits per source IP, and TokenBoss shares one
 * IP across all users, so a quiet thundering herd of dashboard tabs can
 * trip it. We surface a 503 with a retry hint instead of leaking the raw
 * upstream string. Mirrors keysHandlers#handleNewapiError.
 */
function handleNewapiError(err: unknown): APIGatewayProxyResultV2 {
  if (err instanceof NewapiError && err.status === 429) {
    return jsonError(
      503,
      "service_unavailable",
      "上游短暂限流，请等几十秒再重试。",
      "newapi_rate_limited",
    );
  }
  const msg = err instanceof NewapiError ? err.message : (err as Error).message;
  const status = err instanceof NewapiError ? err.status || 502 : 502;
  return jsonError(status, "upstream_error", msg);
}

export const usageHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    return await usageHandlerImpl(event);
  } catch (err) {
    return handleNewapiError(err);
  }
};

const usageHandlerImpl = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const headers = event.headers ?? {};
  const authHeader =
    headers.authorization ?? headers.Authorization ?? undefined;
  const auth = await verifySessionHeader(authHeader);
  if (isAuthFailure(auth)) {
    return jsonError(
      auth.status,
      "authentication_error",
      auth.message,
      auth.code,
    );
  }
  const userId = auth.userId;

  const user = await getUser(userId);
  if (!user || user.newapiUserId == null) {
    // No newapi link → no usage history we can report. Return empty
    // shape so the dashboard renders a clean zero-state.
    const qs = event.queryStringParameters ?? {};
    if (qs.aggregateBy) return jsonResponse(200, { groups: [] });
    return jsonResponse(200, {
      records: [],
      totals: { consumed: 0, calls: 0 },
      hourly24h: emptyHourly24h(),
    });
  }
  const username = newapiUsername(userId);

  const qs = event.queryStringParameters ?? {};
  // Default window = rolling 30d. Client may override via `from` (e.g.
  // UsageHistory's 24h fetch).
  const startTs = isoToTimestamp(qs.from) ?? defaultStartTs();
  const endTs = isoToTimestamp(qs.to);

  // ----- Aggregation mode -----
  const aggBy = qs.aggregateBy;
  if (aggBy) {
    if (aggBy !== "source" && aggBy !== "keyHint") {
      return jsonError(
        400,
        "validation_error",
        `Invalid aggregateBy: ${aggBy}`,
        "invalid_aggregate_by",
      );
    }
    const limitRaw = qs.limit ? parseInt(qs.limit, 10) : 50;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50;

    if (aggBy === "source") {
      // newapi has no source attribution — return one null-keyed group
      // covering the whole window so the dashboard's AGENTS panel can
      // render at least an "all sources" total.
      const all = await fetchAllConsumeLogs({
        username,
        start_timestamp: startTs,
        end_timestamp: endTs,
      });
      if (all.length === 0) return jsonResponse(200, { groups: [] });
      const totalUsd = all.reduce((s, e) => s + newapiQuotaToUsd(e.quota), 0);
      const lastTs = all.reduce((mx, e) => Math.max(mx, e.created_at), 0);
      return jsonResponse(200, {
        groups: [
          {
            groupKey: null,
            callCount: all.length,
            totalConsumedUsd: round6(totalUsd),
            lastUsedAt: new Date(lastTs * 1000).toISOString(),
          },
        ],
      });
    }

    // aggBy === "keyHint": group by newapi's token_name (the user-given
    // label, since the raw key tail isn't stored in newapi listings).
    const all = await fetchAllConsumeLogs({
      username,
      start_timestamp: startTs,
      end_timestamp: endTs,
    });
    type Acc = {
      groupKey: string | null;
      callCount: number;
      totalConsumedUsd: number;
      lastUsedAt: number;
    };
    const byKey = new Map<string, Acc>();
    for (const e of all) {
      const k = e.token_name ?? "";
      let acc = byKey.get(k);
      if (!acc) {
        acc = {
          groupKey: e.token_name ?? null,
          callCount: 0,
          totalConsumedUsd: 0,
          lastUsedAt: 0,
        };
        byKey.set(k, acc);
      }
      acc.callCount += 1;
      acc.totalConsumedUsd += newapiQuotaToUsd(e.quota);
      if (e.created_at > acc.lastUsedAt) acc.lastUsedAt = e.created_at;
    }
    const groups = Array.from(byKey.values())
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .slice(0, limit)
      .map((a) => ({
        groupKey: a.groupKey,
        callCount: a.callCount,
        totalConsumedUsd: round6(a.totalConsumedUsd),
        lastUsedAt: new Date(a.lastUsedAt * 1000).toISOString(),
      }));
    return jsonResponse(200, { groups });
  }

  // ----- Records list mode -----
  const eventTypeRaw = qs.eventType;
  if (eventTypeRaw) {
    if (!isValidEventType(eventTypeRaw)) {
      return jsonError(
        400,
        "validation_error",
        `Invalid eventType: ${eventTypeRaw}`,
        "invalid_event_type",
      );
    }
    if (eventTypeRaw !== "consume") {
      // newapi only knows about consume events. Other event types
      // (reset/expire/topup/refund) used to come from local usage_log
      // which we no longer write — return empty so filters still work.
      return jsonResponse(200, {
        records: [],
        totals: { consumed: 0, calls: 0 },
        hourly24h: emptyHourly24h(),
      });
    }
  }

  const limitRaw = qs.limit ? parseInt(qs.limit, 10) : 50;
  const offsetRaw = qs.offset ? parseInt(qs.offset, 10) : 0;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50;
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

  // Synthesize subscription reset/expire records from the snapshot table
  // so /console/history shows the periodic "作废 + 重置" pair newapi
  // doesn't log natively. listResetSnapshots returns ONLY rows with
  // resetExpiredUsd set, so ordinary observation snapshots aren't
  // double-counted.
  const resetSnapshots = listResetSnapshots(
    userId,
    startTs ? new Date(startTs * 1000).toISOString() : undefined,
    endTs ? new Date(endTs * 1000).toISOString() : undefined,
  );
  const resetRecords = resetSnapshots.flatMap(snapshotToRecords);

  // Fast path — small page sizes don't need the full 30d scan. Fetch
  // ONE upstream page for the records list, ONE stat call for
  // totals.consumed, and ONE smaller 24h scan for the hourly chart.
  // Three calls in parallel ≈ one RTT wall-time vs. 50 sequential
  // pages on the slow path. Falls back to the slow path when the
  // caller is paginating deep into history (UsageHistory page 6+).
  //
  // Correctness: as long as `recordsPageSize ≥ offset + limit`, the
  // merge of (most-recent N consume) + (all resets in window) sorted
  // desc is identical at positions [offset, offset+limit) to the merge
  // of the full set — newapi sorts log pages by created_at desc, so
  // any consume row pushed past position recordsPageSize is older than
  // every row we kept and can't appear in the slice.
  const FAST_PATH_LIMIT = 100;
  const wantedRecords = offset + limit;
  if (wantedRecords <= FAST_PATH_LIMIT) {
    const recordsPageSize = Math.min(FAST_PATH_LIMIT, Math.max(50, wantedRecords));
    // Quantize the 24h hourly window to the minute, same reason as
    // defaultStartTs — keeps the cache key stable across requests.
    const hourly24hStartTs = Math.floor(
      (Math.floor(Date.now() / 60_000) * 60_000 - 24 * 3600 * 1000) / 1000,
    );
    const recordsPageKey = `${username}|${startTs ?? ''}|${endTs ?? ''}|${recordsPageSize}`;
    const statKey = `${username}|${startTs ?? ''}|${endTs ?? ''}`;

    const [recordsPage, statRes, hourly24hLogs] = await Promise.all([
      consumeRecentPageCache.getOrFetch(recordsPageKey, async () => {
        const res = await newapi.getLogs({
          page: 0,
          per_page: recordsPageSize,
          type: 2,
          username,
          start_timestamp: startTs,
          end_timestamp: endTs,
        });
        return {
          items: res?.items ?? [],
          total: typeof res?.total === 'number' ? res.total : (res?.items?.length ?? 0),
        };
      }),
      consumeStatCache.getOrFetch(statKey, async () => {
        const s = await newapi.getLogStat({
          type: 2,
          username,
          start_timestamp: startTs,
          end_timestamp: endTs,
        });
        return { quota: s?.quota ?? 0 };
      }),
      fetchAllConsumeLogs({
        username,
        start_timestamp: hourly24hStartTs,
        end_timestamp: endTs,
      }),
    ]);

    const sourceByEntryId = attachSourcesToLogEntries(userId, recordsPage.items);
    const consumeRecords = recordsPage.items.map((entry) =>
      mapNewapiLog(entry, userId, sourceByEntryId.get(entry.id) ?? 'other'),
    );
    const merged = [...consumeRecords, ...resetRecords].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
    );
    const records = merged.slice(offset, offset + limit);

    return jsonResponse(200, {
      records,
      totals: {
        consumed: round6(newapiQuotaToUsd(statRes.quota)),
        // `calls` is consume-only across the full window — newapi
        // returns the upstream total even when we only fetch one page.
        calls: recordsPage.total,
        // `records` is consume total + synthesized resets in the window.
        records: recordsPage.total + resetRecords.length,
      },
      hourly24h: buildHourly24h(hourly24hLogs),
    });
  }

  // Slow path — deep pagination (offset+limit > FAST_PATH_LIMIT). Pull
  // the full window once (60s cached + single-flighted) and slice the
  // merged consume + reset list ourselves. Newapi's own pagination would
  // only paginate consume rows, leaving every page padded with the same
  // full set of reset rows.
  const all = await fetchAllConsumeLogs({
    username,
    start_timestamp: startTs,
    end_timestamp: endTs,
  });

  const sourceByEntryId = attachSourcesToLogEntries(userId, all);
  const consumeRecords = all.map((entry) =>
    mapNewapiLog(entry, userId, sourceByEntryId.get(entry.id) ?? 'other'),
  );

  const merged = [...consumeRecords, ...resetRecords].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
  const records = merged.slice(offset, offset + limit);

  const totalConsumed = all.reduce((s, e) => s + newapiQuotaToUsd(e.quota), 0);
  const hourly24h = buildHourly24h(all);

  return jsonResponse(200, {
    records,
    totals: {
      consumed: round6(totalConsumed),
      calls: all.length,
      records: merged.length,
    },
    hourly24h,
  });
};

// ---------- Hourly chart helpers ----------

// Hour-bucket shape returned to the client. `hour` (UTC string) is kept
// for backward compatibility with older bundles, but `hourStartMs` is
// the canonical field — the frontend converts it to the user's local
// timezone with `new Date(hourStartMs).getHours()` so the chart's X
// axis matches the user's wall clock, not the server's UTC.
type HourBucket = { hour: string; hourStartMs: number; consumed: number };

function emptyHourly24h(): HourBucket[] {
  const now = new Date();
  const out: HourBucket[] = [];
  for (let i = 23; i >= 0; i--) {
    const hourStart = new Date(now.getTime() - i * 3600e3);
    hourStart.setUTCMinutes(0, 0, 0);
    out.push({
      hour: `${hourStart.getUTCHours().toString().padStart(2, "0")}:00`,
      hourStartMs: hourStart.getTime(),
      consumed: 0,
    });
  }
  return out;
}

function buildHourly24h(
  entries: NewapiLogEntry[],
): HourBucket[] {
  const now = Date.now();
  const buckets: HourBucket[] = [];
  for (let i = 23; i >= 0; i--) {
    const start = now - i * 3600e3;
    const hourStart = new Date(start);
    hourStart.setUTCMinutes(0, 0, 0);
    const hourStartMs = hourStart.getTime();
    const hourEndMs = hourStartMs + 3600e3;
    let consumed = 0;
    for (const e of entries) {
      const t = e.created_at * 1000;
      if (t >= hourStartMs && t < hourEndMs) {
        consumed += newapiQuotaToUsd(e.quota);
      }
    }
    buckets.push({
      hour: `${hourStart.getUTCHours().toString().padStart(2, "0")}:00`,
      hourStartMs,
      consumed: round6(consumed),
    });
  }
  return buckets;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

// ---------- Reset / expire event synthesis ----------

/** Convert one detected reset snapshot into the (expire, reset) record
 *  pair that the UI renders. The expire record is timestamped 1ms
 *  EARLIER than the reset record so a DESC-by-createdAt sort puts
 *  reset above expire — that puts the "+ new cycle" notification
 *  visually on top, matching the user's mental order ("作废了 X，
 *  然后给了 Y"). */
function snapshotToRecords(
  snap: SubscriptionSnapshot,
): UsageRecordShape[] {
  if (snap.resetExpiredUsd === null) return [];
  const resetMs = new Date(snap.observedAt).getTime();
  const tier = snap.planTier;
  const tierLabel = tier ? `${tier} 周期` : null;
  return [
    {
      id: `reset-${snap.id}`,
      userId: snap.userId,
      bucketId: null,
      eventType: 'reset',
      amountUsd: round6(snap.amountTotalUsd),
      model: null,
      source: null,
      keyHint: tierLabel,
      tokensIn: null,
      tokensOut: null,
      createdAt: new Date(resetMs).toISOString(),
    },
    {
      id: `expire-${snap.id}`,
      userId: snap.userId,
      bucketId: null,
      eventType: 'expire',
      amountUsd: round6(snap.resetExpiredUsd),
      model: null,
      source: null,
      keyHint: tierLabel,
      tokensIn: null,
      tokensOut: null,
      createdAt: new Date(resetMs - 1).toISOString(),
    },
  ];
}
