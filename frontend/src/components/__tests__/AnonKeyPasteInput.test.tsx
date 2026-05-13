import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnonKeyPasteInput } from "../AnonKeyPasteInput";
import * as triggerModule from "../../lib/triggerDeepLink";

/**
 * Spy on `triggerDeepLinkBatch` (the lib that internally creates hidden
 * iframes per URL — see lib/triggerDeepLink.ts). We don't reach into iframe
 * DOM in tests; we verify the component calls the batch with all 5 unique
 * ccswitch:// URLs.
 */

beforeEach(() => {
  vi.restoreAllMocks();
});

// 48 alphanumeric chars — matches the production sk- + 48 chars format.
const VALID_KEY = "sk-" + "A".repeat(48);
const SHORT_KEY = "sk-too-short";
const NO_PREFIX = "A".repeat(48);

describe("AnonKeyPasteInput", () => {
  it("submit button is disabled while the input is empty or invalid", async () => {
    vi.spyOn(triggerModule, "triggerDeepLinkBatch").mockResolvedValue();
    render(<AnonKeyPasteInput />);
    const user = userEvent.setup();

    // The visible button text varies per state; locate it by its role +
    // a stable accessible-name pattern.
    const button = screen.getByRole("button", { name: /导入到 CC Switch/ });
    expect(button).toBeDisabled();

    const input = screen.getByLabelText(/API Key/);
    await user.type(input, SHORT_KEY);
    expect(button).toBeDisabled();
    expect(screen.getByText(/格式不对/)).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, NO_PREFIX);
    expect(button).toBeDisabled();
    expect(screen.getByText(/格式不对/)).toBeInTheDocument();
  });

  it("once a valid sk- + 48-char key is typed, button enables and clicking fires triggerDeepLinkBatch with 5 unique URLs", async () => {
    const batchSpy = vi.spyOn(triggerModule, "triggerDeepLinkBatch").mockResolvedValue();
    render(<AnonKeyPasteInput />);
    const user = userEvent.setup();

    const input = screen.getByLabelText(/API Key/);
    // Use paste rather than type — much faster for a 51-char string and
    // closer to the real-world flow (user copies key from somewhere).
    await user.click(input);
    await user.paste(VALID_KEY);

    const button = screen.getByRole("button", { name: /导入到 CC Switch/ });
    await waitFor(() => expect(button).not.toBeDisabled());

    await user.click(button);

    await waitFor(() => expect(batchSpy).toHaveBeenCalledTimes(1));
    const urls = batchSpy.mock.calls[0][0] as readonly string[];
    expect(urls).toHaveLength(5);
    expect(urls.every((u) => u.startsWith("ccswitch://v1/import?"))).toBe(true);
    // Each URL is unique per app (so 5 distinct, not 5 copies of the same).
    expect(new Set(urls).size).toBe(5);
  });
});
