/**
 * Logged-in branch of the KeyInjectionFlow.
 *
 * Wraps PrimaryImportButton + ImportScopeNote in a single composition so
 * the parent (KeyInjectionFlow) stays declarative. Currently this is
 * just the button + a static note, but the wrapper exists so future
 * additions (e.g. "let me pick a different key", "import to a subset of
 * CLIs") have a natural home without bloating the flow component.
 *
 * 参考: openspec/changes/gh-3-tokenboss-cc-switch-integration/design.md §2
 */

import { PrimaryImportButton } from "./PrimaryImportButton";
import { ImportScopeNote } from "./ImportScopeNote";

export function LoggedInKeyPicker() {
  return (
    <div>
      <PrimaryImportButton />
      <ImportScopeNote />
    </div>
  );
}
