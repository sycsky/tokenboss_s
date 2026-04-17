/**
 * GET /v1/usage?range=today|week|month — dashboard usage history.
 *
 * Session-authed. Reads newapi's log endpoint — the single source of truth
 * for consumption. Results are newest-first. `range` defaults to `today`.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

import { isAuthFailure, verifySessionHeader } from "../lib/auth.js";
import { isNewapiConfigured, newapi, NewapiError } from "../lib/newapi.js";
import { getUser } from "../lib/store.js";
import { getTier } from "../lib/tiers.js";

type Range = "today" | "week" | "month";

/**
 * Compute [from, to) as ISO strings for a given range, relative to `now`.
 * The bounds are aligned to UTC day/week/month starts — good enough for
 * an MVP dashboard; timezone-aware bucketing can come later.
 */
function rangeBounds(range: Range, now: Date): { fromIso: string; toIso: string } {
  const end = new Date(now);
  end.setUTCSeconds(end.getUTCSeconds() + 1);

  const start = new Date(now);
  switch (range) {
    case "today": {
      start.setUTCHours(0, 0, 0, 0);
      break;
    }
    case "week": {
      start.setUTCDate(start.getUTCDate() - 6);
      start.setUTCHours(0, 0, 0, 0);
      break;
    }
    case "month": {
      start.setUTCDate(1);
      start.setUTCHours(0, 0, 0, 0);
      break;
    }
  }
  return { fromIso: start.toISOString(), toIso: end.toISOString() };
}

function parseRange(raw: string | undefined): Range {
  if (raw === "week" || raw === "month" || raw === "today") return raw;
  return "today";
}

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

interface UsageView {
  id: string;
  model: string;
  tier: number;
  at: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  creditsCharged: number;
}

export const usageHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const authHeader =
    event.headers?.authorization ?? event.headers?.Authorization ?? undefined;
  const auth = await verifySessionHeader(authHeader);
  if (isAuthFailure(auth)) {
    return jsonError(auth.status, "authentication_error", auth.message, auth.code);
  }

  const rangeRaw = event.queryStringParameters?.range;
  const range = parseRange(rangeRaw);
  const { fromIso, toIso } = rangeBounds(range, new Date());

  // When newapi is not configured (e.g. local dev with MOCK_UPSTREAM=1 and
  // no self-hosted newapi), there's no consumption data to read. Return an
  // empty window rather than 501 so the dashboard still renders.
  const userRec = await getUser(auth.userId);
  if (!isNewapiConfigured() || !userRec?.newapiUserId) {
    return jsonResponse(200, {
      range,
      from: fromIso,
      to: toIso,
      totalCreditsCharged: 0,
      totalTokens: 0,
      count: 0,
      records: [],
    });
  }

  const startSec = Math.floor(new Date(fromIso).getTime() / 1000);
  const endSec = Math.floor(new Date(toIso).getTime() / 1000);

  let page;
  try {
    page = await newapi.getLogs({
      page: 0,
      // 200 rows covers a month of moderate use without pagination and
      // keeps the request cheap. Users who exceed this see a truncated
      // list — fine for the MVP dashboard; deep history can page later.
      per_page: 200,
      start_timestamp: startSec,
      end_timestamp: endSec,
      username: newapiUsername(auth.userId),
      type: 2, // consumption logs only
    });
  } catch (err) {
    const msg = err instanceof NewapiError ? err.message : (err as Error).message;
    console.error(`[usage] newapi query failed:`, msg);
    return jsonError(502, "upstream_error", "Could not read usage from metering service.", "newapi_query_failed");
  }

  const items = page.items ?? [];
  const records: UsageView[] = items.map((e) => ({
    id: String(e.id),
    model: e.model_name,
    tier: getTier(e.model_name),
    at: new Date(e.created_at * 1000).toISOString(),
    promptTokens: e.prompt_tokens,
    completionTokens: e.completion_tokens,
    totalTokens: (e.prompt_tokens ?? 0) + (e.completion_tokens ?? 0),
    // newapi's `quota` unit is its internal billing unit (500,000 ≈ $1).
    // We surface it raw and let the dashboard format it.
    creditsCharged: e.quota,
  }));

  const totalCreditsCharged = records.reduce((s, r) => s + r.creditsCharged, 0);
  const totalTokens = records.reduce((s, r) => s + r.totalTokens, 0);

  return jsonResponse(200, {
    range,
    from: fromIso,
    to: toIso,
    totalCreditsCharged,
    totalTokens,
    count: records.length,
    records,
  });
};

/**
 * Translate a TokenBoss userId into the newapi username we provisioned it
 * under. Must mirror the scheme in authHandlers#register exactly, otherwise
 * the log filter returns zero rows.
 */
function newapiUsername(userId: string): string {
  return userId.startsWith("u_") ? userId.slice(2) : userId.slice(0, 20);
}
