/**
 * Shared in-memory cache for /v1/buckets responses.
 *
 * Both Dashboard and UsageHistory render the user's subscription /
 * wallet remaining, and each used to fire its own `api.getBuckets()`
 * on mount — navigating between the two pages tripled the upstream
 * newapi calls (each `/v1/buckets` does a Promise.allSettled of
 * listUserSubscriptions + getUser). This module gives both pages one
 * cached result and coalesces concurrent fetches, mirroring the backend
 * memo-cache pattern in usageHandlers.ts.
 *
 * Scoped by `userId` so a logout/login in the same SPA session can't
 * leak the prior account's buckets — `clearBucketsCache()` is also
 * called from auth.tsx on logout as a belt-and-braces measure.
 */

import { api, type BucketsResponse } from './api';

interface Entry {
  userId: string;
  data: BucketsResponse;
  expiresAt: number;
}

const TTL_MS = 60_000;

let entry: Entry | undefined;
let inFlight: Promise<BucketsResponse> | undefined;
let inFlightUserId: string | undefined;

/**
 * Synchronous read — returns the cached buckets payload if it's for
 * `userId` and still fresh, else undefined. Use for first-paint default
 * state so a re-mount doesn't flash empty values before the fetch
 * resolves.
 */
export function peekBuckets(userId: string | undefined): BucketsResponse | undefined {
  if (!userId) return undefined;
  if (!entry) return undefined;
  if (entry.userId !== userId) return undefined;
  if (entry.expiresAt <= Date.now()) return undefined;
  return entry.data;
}

/**
 * Cache-aware fetch. Returns cached result if fresh; otherwise issues
 * one `api.getBuckets()` (single-flighted across concurrent callers)
 * and updates the cache on success. Failures bubble out unchanged so
 * callers can render their own error state — the cache stays
 * untouched, leaving the next caller free to retry.
 */
export async function getBucketsCached(userId: string | undefined): Promise<BucketsResponse> {
  if (!userId) return api.getBuckets();
  const fresh = peekBuckets(userId);
  if (fresh) return fresh;
  if (inFlight && inFlightUserId === userId) return inFlight;

  const p = api.getBuckets().then((data) => {
    entry = { userId, data, expiresAt: Date.now() + TTL_MS };
    return data;
  });
  inFlight = p;
  inFlightUserId = userId;
  // Always clear the in-flight slot, success or failure. Use a no-op
  // catch so unhandled-rejection warnings don't fire on the duplicate
  // promise consumers attach later — original `p` still rejects them.
  void p.catch(() => undefined).finally(() => {
    if (inFlight === p) {
      inFlight = undefined;
      inFlightUserId = undefined;
    }
  });
  return p;
}

/** Wipe the cache. Called on logout / detected cross-account drift. */
export function clearBucketsCache(): void {
  entry = undefined;
  inFlight = undefined;
  inFlightUserId = undefined;
}
