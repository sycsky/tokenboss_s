/**
 * Derive the newapi-side username from a TokenBoss userId.
 *
 * TokenBoss userIds are `u_<20 hex chars>`. newapi has its own users table
 * with usernames unique within that instance, so when we provision a newapi
 * account for a TokenBoss user we strip the `u_` prefix and use the hex tail
 * as the newapi username. Any caller that needs to log into newapi as the
 * user (token mgmt, top-up redemption, usage queries) must compute the
 * username the same way — extract this here so the rule has one home.
 *
 * Legacy callers passing a string without the `u_` prefix get the first 20
 * chars truncated, matching the behaviour the original duplicates had.
 */
export function newapiUsername(userId: string): string {
  return userId.startsWith("u_") ? userId.slice(2) : userId.slice(0, 20);
}
