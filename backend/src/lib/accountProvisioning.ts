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
import {
  getUser,
  getUserIdByEmail,
  insertUser,
  isUniqueConstraintError,
  markEmailVerified,
  revokePasswordCredentials,
  type UserRecord,
} from "./store.js";

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
          revokePasswordCredentials(winner.userId);
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
