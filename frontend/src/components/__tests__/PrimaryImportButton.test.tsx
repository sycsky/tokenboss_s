import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrimaryImportButton } from "../PrimaryImportButton";
import * as apiModule from "../../lib/api";

/**
 * window.location.assign in jsdom is a no-op getter on a non-configurable
 * property — directly spying on it throws "Cannot redefine property:
 * location" in some Node builds. Stubbing the whole `location` with a
 * plain object that has a spyable `assign` works in every recent jsdom.
 */
function mockLocationAssign(): ReturnType<typeof vi.fn> {
  const assign = vi.fn();
  // Use vi.stubGlobal so the original `window.location` is restored after
  // tests via vi.unstubAllGlobals (called in afterEach below).
  vi.stubGlobal("location", { ...window.location, assign });
  return assign;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PrimaryImportButton", () => {
  it("calls api.getDeepLink and fires window.location.assign 5 times (once per CLI app) on click", async () => {
    const assignSpy = mockLocationAssign();
    vi.spyOn(apiModule.api, "getDeepLink").mockResolvedValue({
      user_id: "u1",
      key_name: "CC Switch",
      key_id: 99,
      deep_links: [
        { app: "openclaw", display_name: "OpenClaw", url: "ccswitch://v1/import?app=openclaw" },
        { app: "hermes", display_name: "Hermes Agent", url: "ccswitch://v1/import?app=hermes" },
        { app: "codex", display_name: "Codex CLI", url: "ccswitch://v1/import?app=codex" },
        { app: "opencode", display_name: "OpenCode", url: "ccswitch://v1/import?app=opencode" },
        { app: "claude", display_name: "Claude Code", url: "ccswitch://v1/import?app=claude" },
      ],
      issued_at: "2026-05-13T00:00:00Z",
    });

    render(<PrimaryImportButton />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /一键导入/ }));

    // The component fires 5 assigns with 200ms sleeps between them — give
    // waitFor enough budget (default 1s would be tight; 3s is comfy).
    await waitFor(
      () => {
        expect(assignSpy).toHaveBeenCalledTimes(5);
      },
      { timeout: 3000 },
    );
    expect(assignSpy.mock.calls[0][0]).toBe("ccswitch://v1/import?app=openclaw");
    expect(assignSpy.mock.calls[4][0]).toBe("ccswitch://v1/import?app=claude");
  });

  it("shows an inline error when getDeepLink fails", async () => {
    mockLocationAssign();
    vi.spyOn(apiModule.api, "getDeepLink").mockRejectedValue(new Error("network down"));

    render(<PrimaryImportButton />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /一键导入/ }));

    // The error surface lives in a role=alert region so screen readers
    // catch it; the regex matches either the raw error text or our
    // wrapped 失败/请重试 copy.
    expect(await screen.findByRole("alert")).toHaveTextContent(/失败|网络|network|重试/i);
  });
});
