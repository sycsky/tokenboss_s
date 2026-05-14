/**
 * E2E coverage for `/install/manual` — the gh-3 per-agent CC Switch import.
 *
 * Two scenarios:
 *
 *   1. Logged-in user → AgentImportGrid: 5 per-agent cards. Each click
 *      fires ONE `ccswitch://` deep link for that CLI. We click all 5 in
 *      sequence and verify each fired the correct URL. The first click
 *      lazily fetches /v1/deep-link and caches all 5 URLs (D7 backend
 *      "delete-and-recreate" means we MUST fetch only once per session).
 *
 *   2. Anonymous user → AnonKeyPasteInput. No session, so the auth path
 *      falls through to the paste-key UI. Verify the format gate: agent
 *      grid hidden until a valid `sk-` + 48 alphanum key is typed; once
 *      valid, the grid appears and each per-card click fires a
 *      client-side-built `ccswitch://` URL.
 *
 * Why mock `/v1/me`: the AuthProvider boots with `user: undefined`
 * (hydrating) and the KeyInjectionFlow renders the anon path during
 * that window. If `/v1/me` 401s or times out, the user stays anon. We
 * mock with a real user shape (test 1) to flip us to LoggedIn on first
 * render after auth hydration, or 401 (test 2) to confirm the anon path.
 *
 * Why we observe via page.on("request") instead of overriding
 * triggerDeepLink: Chromium navigation requests (including iframe.src
 * navigation to custom schemes) fire request events regardless of
 * whether the scheme has a registered handler. This gives us a stable
 * observation point that doesn't depend on JS-level mocking of our own
 * internal lib.
 *
 * 参考: openspec/changes/gh-3-tokenboss-cc-switch-integration/design.md §2 + §7 + SD-5/SD-6
 */

import { test, expect } from "@playwright/test";

const FAKE_TOKEN = "fake-jwt-for-e2e";
const FAKE_USER = {
  userId: "user_e2e",
  email: "e2e@tokenboss.test",
  displayName: "E2E Tester",
  emailVerified: true,
  balance: 12.34,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const DEEP_LINK_RESPONSE = {
  user_id: "user_e2e",
  key_name: "CC Switch",
  key_id: 99,
  deep_links: ["openclaw", "hermes", "codex", "opencode", "claude"].map((app) => ({
    app,
    display_name: app,
    url: `ccswitch://v1/import?app=${app}&key=sk-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee`,
  })),
  issued_at: "2026-05-13T00:00:00.000Z",
};

const APP_DISPLAY_NAMES: Record<string, string> = {
  openclaw: "OpenClaw",
  hermes: "Hermes Agent",
  codex: "Codex CLI",
  opencode: "OpenCode",
  claude: "Claude Code",
};

test.describe("/install/manual per-agent import", () => {
  test("登录态用户依次点 5 张卡片 → 5 个 ccswitch:// 触发 + fetch 只 1 次", async ({ page }) => {
    page.on("pageerror", (err) => console.error("[page error]", err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") console.error("[console error]", msg.text());
    });

    // Track how many times /v1/deep-link was hit — must be exactly 1
    // (D7: each call mints a fresh key + invalidates the previous, so
    // calling N times would leave only the last key valid).
    let deepLinkCallCount = 0;

    await page.route("**/v1/me", (route) =>
      route.fulfill({ json: { user: FAKE_USER } }),
    );
    await page.route("**/v1/deep-link", (route) => {
      deepLinkCallCount += 1;
      return route.fulfill({ json: DEEP_LINK_RESPONSE });
    });

    await page.addInitScript(
      ([sessionKey, token]) => {
        localStorage.setItem(sessionKey, token);
      },
      ["tb_session", FAKE_TOKEN],
    );

    // See lib/triggerDeepLink.ts — we render a hidden iframe with
    // src=ccswitch://… and Playwright fires a request event for that
    // navigation, even though the scheme has no real handler in CI.
    const capturedUrls: string[] = [];
    page.on("request", (req) => {
      const u = req.url();
      if (u.startsWith("ccswitch://")) {
        capturedUrls.push(u);
      }
    });

    await page.goto("/install/manual");

    // Click each of the 5 agent cards in turn. Click order matters for
    // the captured-URL ordering assertion below.
    const appsInOrder = ["openclaw", "hermes", "codex", "opencode", "claude"] as const;
    for (const app of appsInOrder) {
      const btn = page.getByRole("button", {
        name: new RegExp(`导入到 ${APP_DISPLAY_NAMES[app]}`),
      });
      await expect(btn).toBeVisible();
      await btn.click();
      // Wait until that card's URL shows up in our captured stream,
      // so subsequent clicks don't race ahead.
      await expect
        .poll(() => capturedUrls.some((u) => u.includes(`app=${app}`)), {
          timeout: 3_000,
          intervals: [50, 100, 200],
        })
        .toBe(true);
    }

    expect(capturedUrls).toHaveLength(5);
    expect(capturedUrls[0]).toContain("app=openclaw");
    expect(capturedUrls[4]).toContain("app=claude");

    // D7 cache contract: fetch ONLY ONCE across all 5 card clicks.
    expect(deepLinkCallCount).toBe(1);

    // Progress indicator should read 5/5 and celebration block visible.
    await expect(page.getByText(/5\/5 已导入/)).toBeVisible();
    await expect(page.getByRole("status")).toContainText(/都发到 CC Switch/);
  });

  test("未登录用户走贴 key 兜底 + agent grid 仅 valid key 后才显示", async ({ page }) => {
    await page.route("**/v1/me", (route) =>
      route.fulfill({
        status: 401,
        json: { error: { type: "auth_error", message: "missing session" } },
      }),
    );

    await page.goto("/install/manual");

    const keyInput = page.getByPlaceholder(/^sk-/);
    await expect(keyInput).toBeVisible();

    // Before a valid key is typed, no agent grid is rendered.
    await expect(page.getByRole("button", { name: /导入到 OpenClaw/ })).toHaveCount(0);

    // Invalid key — agent grid stays hidden + error text appears.
    await keyInput.fill("not-a-real-key");
    await expect(page.getByText(/格式不对/)).toBeVisible();
    await expect(page.getByRole("button", { name: /导入到 OpenClaw/ })).toHaveCount(0);

    // Valid key — `sk-` + 48 alphanum chars → grid appears.
    const validKey = "sk-" + "a".repeat(48);
    await keyInput.fill(validKey);
    await expect(page.getByRole("button", { name: /导入到 OpenClaw/ })).toBeVisible();
    await expect(page.getByText(/0\/5 已导入/)).toBeVisible();
  });
});
