/**
 * GET /v1/usage — dashboard usage history.
 *
 * Reads from the upstream newapi instance (the canonical source-of-truth
 * for consume events) instead of TokenBoss's local DB. Local usage_log is
 * no longer written; this handler reshapes `newapi.getLogs` output into
 * the same `UsageRecord` / `UsageAggregate` / `hourly24h` shapes the
 * dashboard already expects, so frontend code is unchanged.
 *
 * Auth: prefers `x-tb-user-id` header (internal-gateway pattern) and falls
 * back to the session JWT for browser clients.
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
import { newapi, newapiQuotaToUsd, type NewapiLogEntry } from "../lib/newapi.js";

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

/** Mirror of keysHandlers.newapiUsername — derived deterministically from userId. */
function newapiUsername(userId: string): string {
  return userId.startsWith("u_") ? userId.slice(2) : userId.slice(0, 20);
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

  const minTs = Math.min(...entries.map((e) => e.created_at));
  const maxTs = Math.max(...entries.map((e) => e.created_at));
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

interface FetchAllParams {
  username: string;
  start_timestamp?: number;
  end_timestamp?: number;
  per_page?: number;
}

/** Pull every consume entry for `username` in the given window. Caps at 5000. */
async function fetchAllConsumeLogs(p: FetchAllParams): Promise<NewapiLogEntry[]> {
  const perPage = Math.min(p.per_page ?? 1000, 1000);
  const all: NewapiLogEntry[] = [];
  for (let page = 0; page < 5; page++) {
    const res = await newapi.getLogs({
      page,
      per_page: perPage,
      type: 2, // consume only
      username: p.username,
      start_timestamp: p.start_timestamp,
      end_timestamp: p.end_timestamp,
    });
    const items = res?.items ?? [];
    all.push(...items);
    if (items.length < perPage) break;
  }
  return all;
}

// ---------- Handler ----------

export const usageHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  // Auth: prefer x-tb-user-id header (internal-gateway pattern), else
  // fall back to session JWT for browser clients.
  const headers = event.headers ?? {};
  const headerUserId =
    headers["x-tb-user-id"] ?? headers["X-Tb-User-Id"] ?? undefined;

  let userId: string;

  if (headerUserId) {
    userId = headerUserId;
  } else {
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
    userId = auth.userId;
  }

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
  const startTs = isoToTimestamp(qs.from);
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

  // newapi pages by 0-indexed `p` and `size`; convert offset → page when
  // possible. For typical limit=50 this maps cleanly.
  const page = Math.floor(offset / limit);
  const pageRes = await newapi.getLogs({
    page,
    per_page: limit,
    type: 2,
    username,
    start_timestamp: startTs,
    end_timestamp: endTs,
  });
  const pageItems = pageRes.items ?? [];
  const sourceByEntryId = attachSourcesToLogEntries(userId, pageItems);
  const consumeRecords = pageItems.map((entry) =>
    mapNewapiLog(entry, userId, sourceByEntryId.get(entry.id) ?? 'other'),
  );

  // Synthesize subscription reset/expire records from the snapshot table
  // so /console/history shows the periodic "作废 + 重置" pair newapi
  // doesn't log natively. Window matches the consume window so the merge
  // stays time-coherent. listResetSnapshots returns ONLY rows with
  // resetExpiredUsd set (= rows that detected a reset), so we don't
  // double-count ordinary observation snapshots.
  const resetSnapshots = listResetSnapshots(
    userId,
    startTs ? new Date(startTs * 1000).toISOString() : undefined,
    endTs ? new Date(endTs * 1000).toISOString() : undefined,
  );
  const resetRecords = resetSnapshots.flatMap(snapshotToRecords);

  // Merge + sort newest-first. consumeRecords are already paginated by
  // newapi so they're at most `limit` long; reset rows in a normal
  // window are ≤ 30 (one per day for monthly, one per cycle for others).
  // No re-pagination needed at this size.
  const records = [...consumeRecords, ...resetRecords].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );

  // Pull the full window for totals + hourly chart. Reasonable cap.
  const all = await fetchAllConsumeLogs({
    username,
    start_timestamp: startTs,
    end_timestamp: endTs,
  });
  const totalConsumed = all.reduce((s, e) => s + newapiQuotaToUsd(e.quota), 0);

  const hourly24h = buildHourly24h(all);

  return jsonResponse(200, {
    records,
    totals: {
      consumed: round6(totalConsumed),
      calls: all.length,
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
