/**
 * POST /v1/deep-link — generate 5 CC Switch one-click import URLs.
 *
 * Flow (D7 删旧建新):
 *   1. Auth + newapi link guard (reused from keysHandlers).
 *   2. Log into newapi as the caller.
 *   3. List the caller's tokens; if a `name="CC Switch"` token already
 *      exists, delete it. This keeps the per-user reserved-key invariant
 *      (max 1 token named "CC Switch" per newapi account) and means the
 *      plaintext we hand back is always the freshest one — previously
 *      revealed keys are immediately revoked.
 *   4. Create a fresh `name="CC Switch"`, unlimited-quota, never-expires
 *      token and capture the plaintext (`sk-xxx`) via createAndRevealToken.
 *   5. Build 5 `ccswitch://v1/import?...` URLs (one per supported app) and
 *      return them. The plaintext is embedded inline — frontend must NOT
 *      log the response body.
 *
 * The endpoint is intentionally idempotent on repeat call: each invocation
 * delete-then-creates, so the "current" CC Switch key always reflects the
 * URLs we just handed back.
 *
 * See: openspec/changes/gh-3-tokenboss-cc-switch-integration/design.md §3.1 + §6
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

import { isAuthFailure, verifySessionHeader } from "../lib/auth.js";
import { newapi } from "../lib/newapi.js";
import { newapiUsername } from "../lib/newapiIdentity.js";
import { buildCCSwitchUrl, CC_SWITCH_APPS } from "../lib/ccSwitchUrl.js";
import {
  handleNewapiError,
  jsonError,
  jsonResponse,
  requireNewapiLink,
} from "./keysHandlers.js";

const TOKENBOSS_API_BASE = "https://api.tokenboss.co/v1";
const TOKENBOSS_HOMEPAGE = "https://www.tokenboss.co";
const RESERVED_KEY_NAME = "CC Switch";

export const deepLinkHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const authHeader =
    event.headers?.authorization ?? event.headers?.Authorization ?? undefined;
  const auth = await verifySessionHeader(authHeader);
  if (isAuthFailure(auth)) {
    return jsonError(auth.status, "authentication_error", auth.message, auth.code);
  }
  const guard = requireNewapiLink(auth);
  if (guard) return guard;

  try {
    const session = await newapi.loginUser({
      username: newapiUsername(auth.userId),
      password: auth.user.newapiPassword as string,
    });

    // D7: delete-then-create. If a previous "CC Switch" token exists,
    // revoke it before minting a new one so the plaintext we return is
    // the only valid key for this app from now on.
    const tokens = await newapi.listUserTokens(session);
    const existing = tokens.find((t) => t.name === RESERVED_KEY_NAME);
    if (existing) {
      await newapi.deleteUserToken(session, existing.id);
    }

    const created = await newapi.createAndRevealToken({
      session,
      name: RESERVED_KEY_NAME,
      unlimited_quota: true,
      expired_time: -1,
      group: "auto",
    });

    const deep_links = CC_SWITCH_APPS.map(({ app, displayName }) => ({
      app,
      display_name: displayName,
      url: buildCCSwitchUrl({
        app,
        name: "TokenBoss",
        endpoint: TOKENBOSS_API_BASE,
        homepage: TOKENBOSS_HOMEPAGE,
        apiKey: created.apiKey,
      }),
    }));

    return jsonResponse(200, {
      user_id: auth.userId,
      key_name: RESERVED_KEY_NAME,
      key_id: created.tokenId,
      deep_links,
      issued_at: new Date().toISOString(),
    });
  } catch (err) {
    return handleNewapiError(err);
  }
};
