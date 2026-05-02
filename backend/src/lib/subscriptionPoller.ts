/**
 * Periodic subscription snapshot poller.
 *
 * Newapi auto-resets a subscription's `amount_used` back to 0 every
 * `quota_reset_period` (daily for paid plans), but doesn't log those
 * resets in any of its log types — we probed types 1/3/4/5 and only
 * found topup/manage entries. So we poll periodically and snapshot
 * every active subscription's `(amount_total, amount_used)` ourselves.
 *
 * Reset detection: when this poll's `amount_used` drops compared to the
 * last snapshot for the same `(userId, subId)`, a reset just happened
 * inside newapi. The unused remainder of the prior cycle equals
 * `prev.amountTotal - prev.amountUsed` — that's the "expired" amount
 * the user wants to see in /console/history.
 *
 * Frequency: 5 minutes by default. Reset cadence is daily, so
 * 5-minute granularity costs us at most ~5 minutes of ambiguity around
 * the exact reset moment — well below the user's perception threshold.
 *
 * Failure mode: each user is processed independently. A failed newapi
 * call for one user logs and continues — the others still get
 * snapshotted. Snapshots are idempotent in spirit (no UNIQUE constraint
 * — duplicates are harmless because reset detection compares against
 * the most recent row).
 */

import { newapi, NewapiError, newapiQuotaToUsd } from './newapi.js';
import { getNewapiPlanId } from './plans.js';
import {
  listUsersWithNewapiLink,
  getLastSubscriptionSnapshot,
  writeSubscriptionSnapshot,
} from './store.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let _pollerHandle: NodeJS.Timeout | null = null;

export function startSubscriptionPoller(): void {
  if (_pollerHandle) return; // Already running.

  // Kick off an immediate first pass so a freshly-deployed instance
  // captures baseline snapshots without waiting POLL_INTERVAL_MS.
  void runOneCycle();

  _pollerHandle = setInterval(() => {
    void runOneCycle();
  }, POLL_INTERVAL_MS);
  // Don't keep the event loop alive just for the poller — the HTTP
  // server is the real anchor. Lets clean shutdown work.
  _pollerHandle.unref?.();
}

export function stopSubscriptionPoller(): void {
  if (_pollerHandle) {
    clearInterval(_pollerHandle);
    _pollerHandle = null;
  }
}

/** One full sweep: every user with a newapi link gets their active
 *  subscriptions snapshotted, and any detected reset writes a
 *  reset-marker snapshot row. Exported for tests + ops endpoint. */
export async function runOneCycle(): Promise<void> {
  let users: { userId: string; newapiUserId: number }[];
  try {
    users = listUsersWithNewapiLink();
  } catch (err) {
    console.warn(
      `[sub-poller] enumerate users failed: ${(err as Error).message}`,
    );
    return;
  }

  for (const user of users) {
    try {
      await pollOneUser(user.userId, user.newapiUserId);
    } catch (err) {
      // listUserSubscriptions already raises NewapiError on transport
      // failures. Don't let one bad user kill the entire sweep.
      const msg = err instanceof NewapiError ? err.message : (err as Error).message;
      console.warn(
        `[sub-poller] user=${user.userId} skipped: ${msg}`,
      );
    }
  }
}

async function pollOneUser(userId: string, newapiUserId: number): Promise<void> {
  const subs = await newapi.listUserSubscriptions(newapiUserId);
  const tierByPlanId = buildTierMap();

  for (const sub of subs) {
    if (sub.status !== 'active') continue;
    const amountTotalUsd = newapiQuotaToUsd(sub.amount_total);
    const amountUsedUsd = newapiQuotaToUsd(sub.amount_used);
    const last = getLastSubscriptionSnapshot(userId, sub.id);

    // Reset detection: amount_used dropped between observations.
    // Prior cycle's unused budget got zeroed — record the expired
    // delta so /console/history can render it as a real event.
    let resetExpiredUsd: number | null = null;
    if (last && amountUsedUsd < last.amountUsedUsd - 1e-6) {
      resetExpiredUsd = Math.max(0, last.amountTotalUsd - last.amountUsedUsd);
    }

    writeSubscriptionSnapshot({
      userId,
      subId: sub.id,
      observedAt: new Date().toISOString(),
      amountTotalUsd,
      amountUsedUsd,
      resetExpiredUsd,
      planTier: tierByPlanId.get(sub.plan_id) ?? null,
    });

    if (resetExpiredUsd !== null) {
      console.info(
        `[sub-poller] reset detected user=${userId} sub=${sub.id} expired=$${resetExpiredUsd.toFixed(4)} new=$${amountTotalUsd.toFixed(4)}`,
      );
    }
  }
}

/** Reverse-lookup newapi plan_id → TokenBoss tier label so snapshot
 *  rows carry the tier (used by history rendering for chip color). */
function buildTierMap(): Map<number, string> {
  const m = new Map<number, string>();
  for (const tier of ['trial', 'plus', 'super', 'ultra'] as const) {
    const id = getNewapiPlanId(tier);
    if (id !== null) m.set(id, tier);
  }
  return m;
}
