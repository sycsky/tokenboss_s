/**
 * Per-user, per-keyId localStorage cache for the plaintext value of an
 * API key. Plaintext is written here at exactly two moments — both right
 * after the user has just seen it themselves:
 *   1. RevealKeyModal's "我已保存好" acknowledge button (manual create flow)
 *   2. OnboardInstall after createKey returns (onboarding flow)
 * The platform never re-fetches plaintext from the server; this cache is
 * the only place it lives between create-time and chat-time.
 *
 * Why cache at all: the /console "接入" spell needs the full key inline
 * for one-click copy, and we don't want every page load to hit newapi.
 * Keep the cache, just promise it stays on this device only.
 *
 * Why localStorage and not a stronger store: this is the same user's
 * own key in their own browser — the threat model is "someone who can
 * already read this user's localStorage", at which point they can
 * impersonate the session entirely. No additional risk over the auth
 * cookie sitting in the same place. logout / 401 / clearAllCachedKeys
 * wipe these entries to keep the "缓存只在你这台设备" promise honest.
 */
export const NS = 'tb_key_v1';

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

/**
 * Iterate all cache entries belonging to one user. Internal helper used by
 * `clearAllCachedKeys` and `sweepCachedKeys` so they share one place that
 * knows the prefix shape.
 */
function forEachCachedKeyId(email: string, fn: (keyId: string) => void): void {
  const prefix = `${NS}:${email}:`;
  try {
    const collected: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const lk = localStorage.key(i);
      if (lk && lk.startsWith(prefix)) collected.push(lk.slice(prefix.length));
    }
    // Iterate AFTER collecting — mutating localStorage mid-loop shifts
    // indices and would skip entries.
    collected.forEach(fn);
  } catch {
    /* private mode / disabled storage — nothing to do */
  }
}

/**
 * Clear ALL cached plaintext keys for one user. Used at logout to keep
 * the "缓存只在你这台设备" promise honest — sign out wipes the local copy.
 *
 * No-op when email is missing (e.g., logout fired before user hydrated).
 */
export function clearAllCachedKeys(email: string | undefined): void {
  if (!email) return;
  forEachCachedKeyId(email, (keyId) => clearCachedKey(email, keyId));
}

/**
 * Clear cache entries whose keyId is no longer in `presentIds`. Called
 * after `listKeys` to drop entries for keys deleted on another device.
 * No-op when email is missing.
 */
export function sweepCachedKeys(
  email: string | undefined,
  presentIds: ReadonlySet<string>,
): void {
  if (!email) return;
  forEachCachedKeyId(email, (keyId) => {
    if (!presentIds.has(keyId)) clearCachedKey(email, keyId);
  });
}
