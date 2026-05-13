import { describe, it, expect } from "vitest";
import { buildCCSwitchUrl, type CCSwitchUrlParams } from "../ccSwitchUrl.js";

const baseParams: Omit<CCSwitchUrlParams, "app"> = {
  name: "TokenBoss",
  endpoint: "https://api.tokenboss.co/v1",
  homepage: "https://www.tokenboss.co",
  apiKey: "sk-testtoken123456789012345678901234567890ABCDEF12",
};

describe("buildCCSwitchUrl", () => {
  it.each([
    ["openclaw", "simple" as const],
    ["hermes", "simple" as const],
    ["opencode", "simple" as const],
  ])("generates simple-schema URL for %s", (app) => {
    const url = buildCCSwitchUrl({ ...baseParams, app: app as any });
    expect(url).toMatch(/^ccswitch:\/\/v1\/import\?resource=provider&app=/);
    expect(url).toContain(`app=${app}`);
    expect(url).toContain(`name=TokenBoss`);
    expect(url).toContain(`endpoint=${encodeURIComponent(baseParams.endpoint)}`);
    expect(url).toContain(`apiKey=${encodeURIComponent(baseParams.apiKey)}`);
  });

  it("generates Codex full-schema URL with base64 JSON config containing TOML", () => {
    const url = buildCCSwitchUrl({ ...baseParams, app: "codex" });
    expect(url).toContain("app=codex");
    expect(url).toContain("configFormat=json");
    const configParam = new URL(url.replace("ccswitch://", "https://x/")).searchParams.get("config")!;
    const decoded = JSON.parse(Buffer.from(configParam, "base64").toString());
    expect(decoded.auth.OPENAI_API_KEY).toBe(baseParams.apiKey);
    expect(decoded.config).toContain('base_url = "https://api.tokenboss.co/v1"');
  });

  it("generates Claude full-schema URL with ANTHROPIC_BASE_URL stripped of /v1 (D8)", () => {
    const url = buildCCSwitchUrl({ ...baseParams, app: "claude" });
    const configParam = new URL(url.replace("ccswitch://", "https://x/")).searchParams.get("config")!;
    const decoded = JSON.parse(Buffer.from(configParam, "base64").toString());
    expect(decoded.env.ANTHROPIC_AUTH_TOKEN).toBe(baseParams.apiKey);
    expect(decoded.env.ANTHROPIC_BASE_URL).toBe("https://api.tokenboss.co"); // 不带 /v1
    expect(decoded.env.ANTHROPIC_MODEL).toBe("claude-sonnet-4-5");
  });

  it("URL-encodes the API key", () => {
    const url = buildCCSwitchUrl({ ...baseParams, app: "openclaw", apiKey: "sk-with/special&chars" });
    expect(url).toContain(`apiKey=${encodeURIComponent("sk-with/special&chars")}`);
  });

  it("throws on unsupported app", () => {
    expect(() => buildCCSwitchUrl({ ...baseParams, app: "gemini" as any })).toThrow(/unsupported/i);
  });
});
