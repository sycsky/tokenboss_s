/**
 * Per-user, per-keyId localStorage cache for the plaintext value of an
 * API key the user has already authorized themselves to see (via the
 * /v1/keys/{id}/reveal flow).
 *
 * Why cache: the /console "接入" spell always wires up the same default
 * key. Once the user has successfully revealed it on this browser, the
 * value won't change unless they delete + recreate it (which produces a
 * new keyId, missing the cache automatically). Caching it lets repeat
 * /console visits show the full key in the spell with zero newapi
 * roundtrips, which is the dominant source of upstream rate-limit hits.
 *
 * Why localStorage and not a stronger store: this is the same user's
 * own key in their own browser — the threat model is "someone who can
 * already read this user's localStorage", at which point they can
 * impersonate the session entirely. No additional risk over the auth
 * cookie sitting in the same place.
 */
const NS = 'tb_key_v1';

function cacheKey(email: string, keyId: string): string {
  return `${NS}:${email}:${keyId}`;
}

export function getCachedKey(email: string, keyId: string): string | null {
  try {
    return localStorage.getItem(cacheKey(email, keyId));
  } catch {
    // Private mode / disabled storage — caller falls back to lazy reveal.
    return null;
  }
}

export function setCachedKey(email: string, keyId: string, plain: string): void {
  try {
    localStorage.setItem(cacheKey(email, keyId), plain);
  } catch {
    // Quota / private mode — caller still got the plaintext from the
    // network call, just won't benefit from cache on future visits.
  }
}

export function clearCachedKey(email: string, keyId: string): void {
  try {
    localStorage.removeItem(cacheKey(email, keyId));
  } catch {
    /* noop */
  }
}
