/**
 * Guarded api-key minting — the ONE way session-authed handlers create
 * newapi tokens.
 *
 * Every mint re-checks the caller's tokenVersion AFTER the upstream token
 * exists: if the account's version moved while the request was in flight
 * (logout-everywhere, or the pre-registration takeover guard reclaiming
 * the account), the session that authenticated this request is dead — and
 * the takeover's revocation sweep may already have verified "no tokens"
 * and completed. So the request destroys its own just-minted token and
 * throws StaleSessionError. This closes the minting side of the takeover
 * race for every endpoint that goes through here; any new key-issuing
 * route MUST use this helper rather than calling createAndRevealToken
 * directly.
 */

import type { AuthContext } from "./auth.js";
import { newapi } from "./newapi.js";
import { getUser } from "./store.js";

/** Maps to 401 invalid_session at the HTTP layer. */
export class StaleSessionError extends Error {
  constructor() {
    super("Session token invalid or expired. Please log in again.");
    this.name = "StaleSessionError";
  }
}

export async function mintKeyGuarded(
  auth: AuthContext,
  session: { cookie: string; userId: number },
  opts: { name: string; expired_time: number },
): Promise<{ tokenId: number; apiKey: string }> {
  const created = await newapi.createAndRevealToken({
    session,
    name: opts.name,
    unlimited_quota: true,
    expired_time: opts.expired_time,
    // Pin newly minted user tokens to newapi's "auto" group so the
    // upstream router picks the auto-tier channel.
    group: "auto",
  });

  const fresh = await getUser(auth.userId);
  if ((fresh?.tokenVersion ?? 0) !== (auth.user.tokenVersion ?? 0)) {
    try {
      await newapi.deleteUserToken(session, created.tokenId);
    } catch (cleanupErr) {
      console.error("[keyMinting] stale-session key cleanup failed", {
        userId: auth.userId,
        tokenId: created.tokenId,
        err: (cleanupErr as Error).message,
      });
    }
    throw new StaleSessionError();
  }
  return created;
}
