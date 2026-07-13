/**
 * OAuth-callback fragment handling, split out of the React tree on purpose.
 *
 * The backend hands the session JWT over in the URL fragment
 * (`/oauth/callback#token=...`). If we waited for a React effect to scrub
 * it, anything that runs earlier — Sentry.init capturing
 * `window.location.href` on a startup error, a render crash — could ship
 * the bearer token to telemetry. So `captureOAuthFragment()` is called at
 * module-eval time in main.tsx, BEFORE Sentry.init and before the first
 * render: it moves the credentials out of the URL into a module-level
 * stash that the OAuthCallback screen then consumes.
 */

export interface OAuthFragment {
  token: string;
  isNew: boolean;
}

let stash: OAuthFragment | null = null;

/** Idempotent: only acts when the current URL is the OAuth callback with a
 *  token fragment; otherwise a no-op. Scrubs the fragment from the address
 *  bar + history synchronously. */
export function captureOAuthFragment(): void {
  if (window.location.pathname !== "/oauth/callback") return;
  const frag = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const token = frag.get("token");
  if (!token) return;
  stash = { token, isNew: frag.get("isNew") === "1" };
  window.history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );
}

/** One-shot read: returns the captured credentials and clears the stash. */
export function takeOAuthFragment(): OAuthFragment | null {
  const s = stash;
  stash = null;
  return s;
}
