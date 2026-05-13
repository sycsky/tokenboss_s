/**
 * Frontend mirror of `backend/src/lib/ccSwitchUrl.ts`.
 *
 * The anonymous-paste flow on /install/manual builds 5 `ccswitch://` URLs
 * client-side from a key the user pasted — no backend round-trip. To stay
 * faithful to the schema the backend already proved out (and the schema
 * CC Switch desktop expects), we mirror the same builder here.
 *
 * Differences vs Node:
 *   - `Buffer.from(...).toString("base64")` → `utf8ToBase64(...)`. The
 *     JSON we encode is ASCII (URLs, env var names, English keys), but
 *     wrapping `btoa` with a UTF-8 safe encoder costs nothing and
 *     prevents future surprises if anyone adds Chinese to the config.
 *   - No `URLSearchParams.toString()` differences worth noting — both
 *     environments percent-encode the same way.
 *
 * Yes, this is duplicated code with backend. Intentional — the file
 * crosses the Node/browser boundary and there's no shared package to
 * hang it on. The two ccSwitchUrl tests (here + backend) guard against
 * drift.
 *
 * 参考: openspec/changes/gh-3-tokenboss-cc-switch-integration/design.md §5
 */

export type CCSwitchApp = "openclaw" | "hermes" | "codex" | "opencode" | "claude";

export const CC_SWITCH_APPS = [
  { app: "openclaw", displayName: "OpenClaw", schema: "simple" },
  { app: "hermes", displayName: "Hermes Agent", schema: "simple" },
  { app: "codex", displayName: "Codex CLI", schema: "full" },
  { app: "opencode", displayName: "OpenCode", schema: "simple" },
  { app: "claude", displayName: "Claude Code", schema: "full" },
] as const;

export interface CCSwitchUrlParams {
  app: CCSwitchApp;
  name: string;
  endpoint: string;
  homepage: string;
  apiKey: string;
}

/** UTF-8 safe base64 encode for the browser. `btoa` alone throws on any
 *  code point > 0xFF, which would bite us the first time someone adds a
 *  Chinese label or a smart-quote to a config payload. */
function utf8ToBase64(input: string): string {
  // encodeURIComponent → percent-encoded UTF-8 → decode each %XX as a
  // raw byte → feed to btoa. Classic pattern; cheap. The TextEncoder
  // alternative pulls a 2-step loop and is no faster for our scale.
  return btoa(
    encodeURIComponent(input).replace(/%([0-9A-F]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    ),
  );
}

export function buildCCSwitchUrl(p: CCSwitchUrlParams): string {
  const baseUrlNoV1 = p.endpoint.replace(/\/v1\/?$/, "");
  switch (p.app) {
    case "openclaw":
    case "hermes":
    case "opencode": {
      const q = new URLSearchParams({
        resource: "provider",
        app: p.app,
        name: p.name,
        endpoint: p.endpoint,
        homepage: p.homepage,
        apiKey: p.apiKey,
      });
      return `ccswitch://v1/import?${q.toString()}`;
    }
    case "codex": {
      const config = {
        auth: { OPENAI_API_KEY: p.apiKey },
        config: `[model_providers.tokenboss]\nbase_url = "${p.endpoint}"\n\n[general]\nmodel = "claude-sonnet-4-5"`,
      };
      const b64 = utf8ToBase64(JSON.stringify(config));
      const q = new URLSearchParams({
        resource: "provider",
        app: "codex",
        name: p.name,
        configFormat: "json",
        config: b64,
      });
      return `ccswitch://v1/import?${q.toString()}`;
    }
    case "claude": {
      const config = {
        env: {
          ANTHROPIC_AUTH_TOKEN: p.apiKey,
          ANTHROPIC_BASE_URL: baseUrlNoV1, // D8: 不带 /v1
          ANTHROPIC_MODEL: "claude-sonnet-4-5",
          ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-4-5",
          ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-4-5",
          ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-4",
        },
      };
      const b64 = utf8ToBase64(JSON.stringify(config));
      const q = new URLSearchParams({
        resource: "provider",
        app: "claude",
        name: p.name,
        configFormat: "json",
        config: b64,
      });
      return `ccswitch://v1/import?${q.toString()}`;
    }
    default:
      throw new Error(`buildCCSwitchUrl: unsupported app "${p.app as string}"`);
  }
}

// ---------- hard-coded TokenBoss defaults ----------
//
// These are the same constants the backend `deepLink.ts` route plugs in
// when it calls buildCCSwitchUrl. Centralized here so the
// AnonKeyPasteInput component doesn't have to repeat them.

export const TOKENBOSS_ENDPOINT = "https://api.tokenboss.co/v1";
export const TOKENBOSS_HOMEPAGE = "https://www.tokenboss.co";
export const TOKENBOSS_PROFILE_NAME = "TokenBoss";

/** Build all 5 deep-link URLs for a single apiKey — convenience wrapper
 *  matching the backend `/v1/deep-link` response shape (minus the
 *  user_id / key_id / issued_at metadata, which only the logged-in path
 *  carries). */
export function buildAllCCSwitchUrls(apiKey: string): Array<{ app: CCSwitchApp; displayName: string; url: string }> {
  return CC_SWITCH_APPS.map((a) => ({
    app: a.app,
    displayName: a.displayName,
    url: buildCCSwitchUrl({
      app: a.app,
      name: TOKENBOSS_PROFILE_NAME,
      endpoint: TOKENBOSS_ENDPOINT,
      homepage: TOKENBOSS_HOMEPAGE,
      apiKey,
    }),
  }));
}
