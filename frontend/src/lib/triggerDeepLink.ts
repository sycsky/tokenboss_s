/**
 * Fire a custom-scheme URL (like `ccswitch://...`) to invoke its OS handler
 * without navigating the current page.
 *
 * **Why iframe, not `window.location.assign`:**
 * Multiple successive `window.location.assign(customScheme)` calls are
 * silently dropped by Chromium and Safari — only the FIRST URL's OS handoff
 * actually fires. The 2nd through Nth assigns land in a navigation-pending
 * state and the browser eats them. Hidden iframes are independent navigation
 * contexts, so each `iframe.src = ccswitch://...` triggers the OS handler
 * reliably even in rapid succession.
 *
 * Discovered: gh-3 Stage 3.5 Vertical Slice — initial PrimaryImportButton
 * + AnonKeyPasteInput used `window.location.assign` in a 200ms-spaced loop
 * and only 1 of 5 CC Switch cards appeared (the openclaw one). Switched
 * to per-URL hidden iframes; all 5 cards now reliably appear.
 *
 * See `openspec/changes/gh-3-tokenboss-cc-switch-integration/design.md` §10 SD-5.
 */

/** Fire one custom-scheme URL via a transient hidden iframe. */
export function triggerDeepLink(url: string): void {
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = url;
  document.body.appendChild(iframe);
  // OS scheme handoff is essentially synchronous on the browser side; the
  // iframe is unnecessary once the navigation request is dispatched. 500ms
  // is a generous cleanup window even for slow-firing handlers.
  setTimeout(() => {
    iframe.remove();
  }, 500);
}

/**
 * Fire N custom-scheme URLs in sequence with a small gap between each.
 * The gap is empirical: 100ms is enough on modern Chromium/Safari, 200ms
 * is a polite default that keeps OS scheme handlers (like CC Switch's
 * confirmation-card emission) from looking like a flood.
 */
export async function triggerDeepLinkBatch(
  urls: readonly string[],
  gapMs = 200,
): Promise<void> {
  for (const url of urls) {
    triggerDeepLink(url);
    await new Promise<void>((resolve) => setTimeout(resolve, gapMs));
  }
}
