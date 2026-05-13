/**
 * E2E coverage for `/install/manual` — the gh-3 one-click CC Switch flow.
 *
 * Two scenarios:
 *
 *   1. Logged-in user → PrimaryImportButton fires 5 × `window.location.assign`
 *      with the deep-link URLs returned by `POST /v1/deep-link`. We mock
 *      both `/v1/me` (so AuthProvider hydrates as logged-in) and
 *      `/v1/deep-link` (so the test doesn't depend on the backend) and
 *      observe the 5 navigation attempts via Playwright's `request`
 *      event — Chromium's real `Location.assign` can't be JS-overridden,
 *      so we lean on the navigation side effect each call produces.
 *
 *   2. Anonymous user → AnonKeyPasteInput. No session, so the auth path
 *      falls through to the paste-key UI. Verify the format gate:
 *      button disabled until the user types a valid `sk-` + 48 alphanum
 *      key (matches the regex in AnonKeyPasteInput.tsx).
 *
 * Why we mock `/v1/me`: the AuthProvider boots with `user: undefined`
 * (hydrating) and the KeyInjectionFlow renders the anon path during
 * that window. If `/v1/me` 401s or times out, the user stays anon and
 * the LoggedIn path never renders — defeating the whole "logged-in"
 * test. Mocking with a real user shape flips us to LoggedIn on first
 * render after auth hydration.
 *
 * 参考: openspec/changes/gh-3-tokenboss-cc-switch-integration/design.md §2 + §7
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

test.describe("/install/manual 一键导入", () => {
  test("登录态用户点按钮 → 5 个 window.location.assign 调用", async ({ page }) => {
    // Surface page-side failures (e.g. unhandled promise rejections in
    // PrimaryImportButton's click handler) to the test logs so a silent
    // mismatch on `/v1/deep-link` doesn't look like a timing bug.
    page.on("pageerror", (err) => console.error("[page error]", err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") console.error("[console error]", msg.text());
    });

    // Intercept the backend calls BEFORE any navigation so AuthProvider's
    // initial /v1/me on mount hits the mock.
    await page.route("**/v1/me", (route) =>
      route.fulfill({ json: { user: FAKE_USER } }),
    );
    await page.route("**/v1/deep-link", (route) =>
      route.fulfill({ json: DEEP_LINK_RESPONSE }),
    );

    // Fake a session: AuthProvider reads `tb_session` from localStorage
    // on mount, then calls `/v1/me` to hydrate the profile.
    await page.addInitScript(
      ([sessionKey, token]) => {
        localStorage.setItem(sessionKey, token);
      },
      ["tb_session", FAKE_TOKEN],
    );

    // Capture `window.location.assign` calls. Chromium's real `Location`
    // resists every JS-level override (`Object.defineProperty` on the
    // instance, the prototype, or `window.location` itself all
    // silently fail because Location is a WebIDL host object with
    // internal slots). So instead we observe the SIDE EFFECT: each
    // `assign(ccswitch://…)` triggers a main-frame navigation request,
    // which Playwright's `page.on("request")` event fires for
    // regardless of whether the scheme has a registered handler.
    const capturedUrls: string[] = [];
    page.on("request", (req) => {
      const u = req.url();
      if (u.startsWith("ccswitch://")) {
        capturedUrls.push(u);
      }
    });

    await page.goto("/install/manual");

    // PrimaryImportButton's idle label — verbatim from
    // PrimaryImportButton.tsx so a copy change here surfaces fast.
    const importBtn = page.getByRole("button", {
      name: "一键导入到 CC Switch（5 个 CLI 全部）",
    });
    await expect(importBtn).toBeVisible();
    await importBtn.click();

    // 5 assigns × 200ms gap ≈ 1s + fetch round trip. 5s gives slack
    // without making a healthy run wait too long. Poll `capturedUrls`
    // length because the request events fire asynchronously.
    await expect
      .poll(() => capturedUrls.length, { timeout: 5_000, intervals: [100, 200, 500] })
      .toBe(5);

    expect(capturedUrls).toHaveLength(5);
    expect(capturedUrls[0]).toContain("app=openclaw");
    expect(capturedUrls[1]).toContain("app=hermes");
    expect(capturedUrls[2]).toContain("app=codex");
    expect(capturedUrls[3]).toContain("app=opencode");
    expect(capturedUrls[4]).toContain("app=claude");
    for (const url of capturedUrls) {
      expect(url.startsWith("ccswitch://")).toBe(true);
    }
  });

  test("未登录用户走贴 key 兜底 + 校验格式", async ({ page }) => {
    // No session, but we still need `/v1/me` to resolve so the
    // AuthProvider settles into `user: null` instead of hanging on
    // `undefined` (which renders anon path too, but cleaner to short-circuit
    // via 401). Returning 401 mirrors the real "no token" backend behavior.
    await page.route("**/v1/me", (route) =>
      route.fulfill({
        status: 401,
        json: { error: { type: "auth_error", message: "missing session" } },
      }),
    );

    await page.goto("/install/manual");

    // AnonKeyPasteInput renders an <input placeholder="sk-XXX…"> next to
    // the disabled CTA. Use the placeholder regex — robust to copy tweaks
    // that keep the `sk-` prefix.
    const keyInput = page.getByPlaceholder(/^sk-/);
    await expect(keyInput).toBeVisible();

    // Anon button label — distinct from PrimaryImportButton's "一键导入"
    // by leading verb. Using exact match would lock us to the idle copy;
    // partial via getByRole + name regex tolerates "正在发送…" state.
    const anonBtn = page.getByRole("button", {
      name: "导入到 CC Switch（5 个 CLI 全部）",
    });
    await expect(anonBtn).toBeVisible();
    // Starts disabled — empty input fails the regex.
    await expect(anonBtn).toBeDisabled();

    // Invalid key — passes the "non-empty" check, still fails regex.
    await keyInput.fill("not-a-real-key");
    await expect(anonBtn).toBeDisabled();
    // The help text flips to the error variant once the user types.
    await expect(page.getByText(/格式不对/)).toBeVisible();

    // Valid key — `sk-` + 48 alphanum chars. Anything longer/shorter
    // or with non-alphanum gets rejected.
    const validKey = "sk-" + "a".repeat(48);
    await keyInput.fill(validKey);
    await expect(anonBtn).toBeEnabled();
  });
});
