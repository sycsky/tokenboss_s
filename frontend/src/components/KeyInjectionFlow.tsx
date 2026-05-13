/**
 * Auth-aware switch between the two key-injection paths on
 * `/install/manual`:
 *
 *   - Logged in  → LoggedInKeyPicker (calls POST /v1/deep-link, gets 5
 *                  URLs back, fires them).
 *   - Anonymous  → AnonKeyPasteInput (user pastes an existing key, we
 *                  build the same 5 URLs client-side).
 *
 * While the AuthProvider is still hydrating (user === undefined), we
 * render the anon path. Reasoning: most anon visitors never had a
 * session in the first place, and showing the logged-in CTA briefly
 * before falling back to "paste your key" is worse UX than the reverse.
 *
 * 参考: openspec/changes/gh-3-tokenboss-cc-switch-integration/design.md §2 + §7
 */

import { useAuth } from "../lib/auth";
import { LoggedInKeyPicker } from "./LoggedInKeyPicker";
import { AnonKeyPasteInput } from "./AnonKeyPasteInput";

export function KeyInjectionFlow() {
  const { user } = useAuth();
  // user === undefined while hydrating → treat as anon.
  if (user) {
    return <LoggedInKeyPicker />;
  }
  return <AnonKeyPasteInput />;
}
