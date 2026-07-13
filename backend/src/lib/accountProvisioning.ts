/**
 * Shared "create a TokenBoss user + provision the matching newapi account"
 * routine. Used by every signup path that has already proven inbox
 * ownership (email OTP, OAuth with a provider-verified email) — as opposed
 * to /v1/auth/register, which collects a password and sends its own
 * verification link.
 *
 * Stop-loss: accounts created here must NOT auto-bind the Trial
 * subscription or any free credit — quota starts at 0 and money only
 * arrives via paid orders / redemption codes.
 */

import { randomBytes } from "node:crypto";

import { isNewapiConfigured, newapi, NewapiError } from "./newapi.js";
import { newapiUsername } from "./newapiIdentity.js";
import {
  deleteApiKeyIndex,
  getUser,
  getUserIdByEmail,
  insertUser,
  isUniqueConstraintError,
  listApiKeyIndex,
  markEmailVerified,
  revokePasswordCredentials,
  type UserRecord,
} from "./store.js";

/**
 * Full pre-registration takeover revocation: whoever held this
 * never-verified account (password registrant) loses every capability the
 * registration session could mint — password, browser sessions, AND api
 * keys. Keys matter because the attacker could have created `sk-...`
 * tokens before the real inbox owner showed up; those would silently
 * spend the victim's future balance.
 *
 * The UPSTREAM state is the only thing that matters: the chat proxy
 * forwards bearer keys straight to newapi (api_key_index is attribution
 * bookkeeping, and may be INCOMPLETE — createKeyHandler deliberately
 * keeps the upstream key when the index write fails). So revocation
 * enumerates the owner's tokens from newapi itself, deletes them through
 * the OWNER's session (`deleteUserToken` — the admin-scoped DELETE is
 * silently ignored / soft-deletes on many newapi forks, see newapi.ts),
 * and then RE-LISTS to verify the set is empty. The verify pass also
 * catches keys minted by a createKey request that was already in flight
 * when the tokenVersion bump cut off new dashboard sessions. Any failure
 * THROWS and aborts the takeover — we never complete a takeover while an
 * attacker key could still be usable.
 */
export async function revokeTakeoverCredentials(userId: string): Promise<void> {
  // Bump FIRST: invalidates every outstanding dashboard session, so no
  // NEW key-creation request can authenticate past this point.
  revokePasswordCredentials(userId);

  const user = await getUser(userId);
  // No newapi account → nothing upstream to revoke. (Indexed rows without
  // an account can't exist: createKeyHandler requires the link.)
  if (user?.newapiUserId === undefined) return;
  if (!user.newapiPassword) {
    // Upstream account exists but we hold no owner credentials — we cannot
    // PROVE revocation, so the takeover must not complete.
    throw new Error(`cannot revoke api keys for ${userId}: no newapi credentials on file`);
  }

  const session = await newapi.loginUser({
    username: newapiUsername(userId),
    password: user.newapiPassword,
  });
  // Delete-and-verify loop: each pass re-lists from the authoritative
  // upstream; only an EMPTY listing completes the takeover. Bounded so a
  // fork that resurrects tokens can't loop us forever.
  for (let pass = 0; pass < 3; pass++) {
    const tokens = await newapi.listUserTokens(session);
    if (tokens.length === 0) {
      for (const { newapiTokenId } of listApiKeyIndex(userId)) {
        deleteApiKeyIndex(userId, newapiTokenId);
      }
      return;
    }
    for (const t of tokens) {
      await newapi.deleteUserToken(session, t.id);
    }
  }
  throw new Error(`api keys for ${userId} kept reappearing during takeover revocation`);
}

/** Thrown when the newapi-side account could not be created. Callers map
 *  this to a 502 (JSON routes) or an error redirect (OAuth callback). */
export class ProvisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvisionError";
  }
}

/**
 * Create a user whose email is already proven (OTP consumed / OAuth
 * provider says verified). Provisions the newapi account first so a
 * metering-service outage never leaves a TokenBoss user that can't call
 * the proxy; nothing is persisted when provisioning throws.
 */
export async function createVerifiedUser(input: {
  email: string;
  displayName?: string;
}): Promise<UserRecord> {
  const userId = `u_${randomBytes(10).toString("hex")}`;

  let newapiUserId: number | undefined;
  let newapiPassword: string | undefined;
  if (isNewapiConfigured()) {
    const newapiUsername = userId.slice(2);
    newapiPassword = randomBytes(12).toString("base64url");
    try {
      const provisioned = await newapi.provisionUser({
        username: newapiUsername,
        password: newapiPassword,
        // newapi caps display_name length; the ≤20-char newapi username is
        // always a safe fallback (and cap the provider-supplied name too).
        display_name: input.displayName?.slice(0, 20) || newapiUsername,
        email: input.email,
        group: "default",
        quota: 0,
      });
      newapiUserId = provisioned.newapiUserId;
    } catch (err) {
      const msg = err instanceof NewapiError ? err.message : (err as Error).message;
      throw new ProvisionError(msg);
    }
  }

  const user: UserRecord = {
    userId,
    email: input.email,
    displayName: input.displayName,
    phone: undefined,
    passwordHash: undefined,
    createdAt: new Date().toISOString(),
    // The caller has already proven inbox ownership.
    emailVerified: true,
    newapiUserId,
    newapiPassword,
  };
  try {
    insertUser(user);
  } catch (err) {
    // A concurrent signup for the same email won the race while we were
    // provisioning. Their row is the account — return it instead of
    // overwriting. Our newapi account (if any) is orphaned; log it so ops
    // can clean up, but don't fail the login over it.
    if (isUniqueConstraintError(err)) {
      const winnerId = getUserIdByEmail(input.email);
      let winner = winnerId ? await getUser(winnerId) : null;
      if (winner) {
        if (newapiUserId !== undefined) {
          console.warn(
            `[provision] duplicate signup race for ${input.email}: newapi user ${newapiUserId} orphaned, using ${winner.userId}`,
          );
        }
        // Callers treat our return value as "verified account" — so the
        // winner must satisfy the same takeover guard as the callers'
        // merge paths: a never-verified row (e.g. a concurrent password
        // registration) forfeits its password + sessions before this
        // proven inbox owner gets it.
        if (!winner.emailVerified) {
          await revokeTakeoverCredentials(winner.userId);
          markEmailVerified(winner.userId);
          winner = await getUser(winner.userId) ?? winner;
        }
        return winner;
      }
    }
    throw err;
  }
  return user;
}
