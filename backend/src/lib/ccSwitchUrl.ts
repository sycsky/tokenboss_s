/**
 * CC Switch deep link URL builder.
 *
 * Generates `ccswitch://v1/import?...` URLs that the CC Switch desktop app
 * intercepts to one-click import a provider profile into one of 5 supported
 * AI agent apps.
 *
 * Two schemas (实证调研得来):
 *
 *   1. Simple schema (openclaw / hermes / opencode):
 *      app + name + endpoint + homepage + apiKey 5 字段直接放在 query string.
 *
 *   2. Full schema (codex / claude):
 *      name + configFormat=json + config=base64(JSON). config 内含 app-specific
 *      env vars / TOML 片段; CC Switch 把它原样写到 app 的 config 文件。
 *
 * D8 关键决策: Claude `ANTHROPIC_BASE_URL` 故意不带 `/v1` —— Claude Code
 * 客户端会自动拼 `/v1/messages`. 我们的 `endpoint` 入参带 `/v1`(给 OpenAI
 * 兼容 app 用), 所以这里手动剥掉.
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
        config: `[model_providers.tokenboss]\nbase_url = "${p.endpoint}"\n\n[general]\nmodel = "claude-sonnet-4-6"`,
      };
      const b64 = Buffer.from(JSON.stringify(config)).toString("base64");
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
          // SD-7: model names 必须跟 TokenBoss newapi 实际 channel 一致。
          // 实测可用 claude 模型: claude-sonnet-4-6 / claude-opus-4-6 /
          // claude-opus-4-7。没有 haiku — 拿 sonnet 顶（slower 但 work），
          // 用户可在 CC Switch UI 内自调。
          ANTHROPIC_MODEL: "claude-sonnet-4-6",
          ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-sonnet-4-6",
          ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-4-6",
          ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-4-7",
        },
      };
      const b64 = Buffer.from(JSON.stringify(config)).toString("base64");
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
