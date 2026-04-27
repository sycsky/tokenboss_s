/**
 * GET /v1/usage — dashboard usage history with event-type filtering and
 * 24-hour hourly aggregation.
 *
 * Auth: reads `x-tb-user-id` header (Task 3.4 pattern). Falls back to
 * session-JWT via `verifySessionHeader` so the endpoint also works from
 * the browser dashboard.
 *
 * Query params:
 *   eventType  — filter records to a single event type (e.g. "consume")
 *   from       — ISO timestamp lower bound (inclusive)
 *   to         — ISO timestamp upper bound (inclusive)
 *   limit      — max records returned (default 50)
 *   offset     — pagination offset (default 0)
 *
 * Response shape:
 *   {
 *     records:   UsageRecord[],
 *     totals:    { consumed: number, calls: number },
 *     hourly24h: { hour: "HH:00", consumed: number }[]
 *   }
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

import { isAuthFailure, verifySessionHeader } from "../lib/auth.js";
import {
  getUsageForUser,
  getHourlyUsage24h,
  aggregateUsageForUser,
  type EventType,
} from "../lib/store.js";

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

const VALID_EVENT_TYPES: EventType[] = [
  "consume",
  "reset",
  "expire",
  "topup",
  "refund",
];

function isValidEventType(v: string): v is EventType {
  return VALID_EVENT_TYPES.includes(v as EventType);
}

// ---------- Handler ----------

export const usageHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  // Auth: prefer x-tb-user-id header (Task 3.4 pattern / internal gateway),
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

  // Parse query params
  const qs = event.queryStringParameters ?? {};

  // Aggregation mode: ?aggregateBy=source | keyHint
  // Returns groupKey / callCount / totalConsumedUsd / lastUsedAt for
  // each distinct value, replacing the per-record records[] payload.
  // Lets the dashboard show "Agent X used Y times" without pulling the
  // full record list and reducing client-side.
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
    const groups = aggregateUsageForUser(userId, aggBy, {
      from: qs.from,
      to: qs.to,
      limit,
    });
    return jsonResponse(200, { groups });
  }

  const eventTypeRaw = qs.eventType;
  let eventTypes: EventType[] | undefined;
  if (eventTypeRaw) {
    if (!isValidEventType(eventTypeRaw)) {
      return jsonError(
        400,
        "validation_error",
        `Invalid eventType: ${eventTypeRaw}`,
        "invalid_event_type",
      );
    }
    eventTypes = [eventTypeRaw];
  }

  const from = qs.from;
  const to = qs.to;
  const limitRaw = qs.limit ? parseInt(qs.limit, 10) : 50;
  const offsetRaw = qs.offset ? parseInt(qs.offset, 10) : 0;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50;
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

  // Fetch paginated records (with filter)
  const records = getUsageForUser(userId, {
    eventTypes,
    from,
    to,
    limit,
    offset,
  });

  // Compute totals: always across ALL consume events (not limited by
  // pagination/filter so the totals reflect the full account history).
  const allConsumeRecords = getUsageForUser(userId, {
    eventTypes: ["consume"],
    from,
    to,
    limit: 100_000, // effectively unbounded
    offset: 0,
  });
  const totalConsumed = allConsumeRecords.reduce(
    (sum, r) => sum + r.amountUsd,
    0,
  );

  // 24-hour hourly chart
  const hourly24h = getHourlyUsage24h(userId);

  return jsonResponse(200, {
    records,
    totals: {
      consumed: Math.round(totalConsumed * 1e6) / 1e6,
      calls: allConsumeRecords.length,
    },
    hourly24h,
  });
};
