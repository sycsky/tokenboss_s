/**
 * Logged-in branch of the KeyInjectionFlow.
 *
 * Renders the AgentImportGrid with a server-side URL fetcher: each first
 * card click triggers POST /v1/deep-link which mints a fresh "CC Switch"
 * reserved newapi token (per D7 delete-and-recreate). All 5 URLs share
 * that fresh key. Cached for the rest of the user's session.
 *
 * 参考: openspec/changes/gh-3-tokenboss-cc-switch-integration/design.md §2 + §7
 */

import { api } from "../lib/api";
import { AgentImportGrid } from "./AgentImportGrid";
import type { CLIAppId } from "../lib/agentDefs";

async function fetchLoggedInUrls(): Promise<Map<CLIAppId, string>> {
  const r = await api.getDeepLink();
  return new Map(r.deep_links.map((dl) => [dl.app, dl.url]));
}

export function LoggedInKeyPicker() {
  return <AgentImportGrid getUrls={fetchLoggedInUrls} />;
}
