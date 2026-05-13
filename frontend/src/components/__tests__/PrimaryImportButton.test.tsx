import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrimaryImportButton } from "../PrimaryImportButton";
import * as apiModule from "../../lib/api";
import * as triggerModule from "../../lib/triggerDeepLink";

/**
 * Spy on `triggerDeepLinkBatch` (the lib that internally creates hidden
 * iframes per URL — see lib/triggerDeepLink.ts). We don't reach into iframe
 * DOM in tests because that's the lib's concern; this test verifies the
 * component fires the batch with the right URLs in the right order.
 *
 * Background: an earlier impl used `window.location.assign` directly and
 * gh-3 Stage 3.5 Vertical Slice caught that only 1 of 5 URLs ever reached
 * the OS handler. See design.md §10 SD-5.
 */

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("PrimaryImportButton", () => {
  it("calls api.getDeepLink then triggerDeepLinkBatch with all 5 URLs in order", async () => {
    const batchSpy = vi.spyOn(triggerModule, "triggerDeepLinkBatch").mockResolvedValue();
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

    await waitFor(() => expect(batchSpy).toHaveBeenCalledTimes(1));
    const urls = batchSpy.mock.calls[0][0] as readonly string[];
    expect(urls).toHaveLength(5);
    expect(urls[0]).toBe("ccswitch://v1/import?app=openclaw");
    expect(urls[4]).toBe("ccswitch://v1/import?app=claude");
  });

  it("shows an inline error when getDeepLink fails", async () => {
    vi.spyOn(triggerModule, "triggerDeepLinkBatch").mockResolvedValue();
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
