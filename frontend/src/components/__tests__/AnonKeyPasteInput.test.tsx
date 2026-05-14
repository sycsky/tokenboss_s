import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnonKeyPasteInput } from "../AnonKeyPasteInput";
import * as triggerModule from "../../lib/triggerDeepLink";

/**
 * AnonKeyPasteInput renders the paste input + (when key is valid) the
 * AgentImportGrid below. Tests focus on:
 * 1. Key format validation (button / grid hidden until valid)
 * 2. Once valid, the grid appears and per-card clicks fire ccswitch:// URLs
 *    built client-side from the pasted key.
 */

beforeEach(() => {
  vi.restoreAllMocks();
});

// 48 alphanumeric chars — matches the production sk- + 48 chars format.
const VALID_KEY = "sk-" + "A".repeat(48);
const SHORT_KEY = "sk-too-short";
const NO_PREFIX = "A".repeat(48);

describe("AnonKeyPasteInput", () => {
  it("does NOT render the agent grid while input is empty or invalid", async () => {
    render(<AnonKeyPasteInput />);
    const user = userEvent.setup();

    // No agent buttons visible until a valid key is typed.
    expect(screen.queryByRole("button", { name: /导入到 OpenClaw/ })).toBeNull();

    const input = screen.getByLabelText(/API Key/);
    await user.type(input, SHORT_KEY);
    expect(screen.queryByRole("button", { name: /导入到 OpenClaw/ })).toBeNull();
    expect(screen.getByText(/格式不对/)).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, NO_PREFIX);
    expect(screen.queryByRole("button", { name: /导入到 OpenClaw/ })).toBeNull();
    expect(screen.getByText(/格式不对/)).toBeInTheDocument();
  });

  it("once a valid sk- + 48-char key is pasted, agent grid appears and per-card clicks fire ccswitch:// URLs", async () => {
    const triggerSpy = vi
      .spyOn(triggerModule, "triggerDeepLink")
      .mockImplementation(() => {});
    render(<AnonKeyPasteInput />);
    const user = userEvent.setup();

    const input = screen.getByLabelText(/API Key/);
    // Use paste rather than type — much faster for a 51-char string and
    // closer to the real-world flow (user copies key from somewhere).
    await user.click(input);
    await user.paste(VALID_KEY);

    // Grid + 5 cards appear.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /导入到 OpenClaw/ })).toBeInTheDocument();
    });

    // Click OpenClaw card → triggerDeepLink fires with a URL containing the pasted key.
    await user.click(screen.getByRole("button", { name: /导入到 OpenClaw/ }));
    await waitFor(() => expect(triggerSpy).toHaveBeenCalledTimes(1));
    const firstUrl = triggerSpy.mock.calls[0][0] as string;
    expect(firstUrl).toMatch(/^ccswitch:\/\/v1\/import\?/);
    expect(firstUrl).toContain("app=openclaw");
    // URL contains the pasted key (URL-encoded).
    expect(firstUrl).toContain(encodeURIComponent(VALID_KEY));

    // Click a second card → cache reused, no second URL-building round-trip needed.
    await user.click(screen.getByRole("button", { name: /导入到 Codex CLI/ }));
    await waitFor(() => expect(triggerSpy).toHaveBeenCalledTimes(2));
    expect(triggerSpy.mock.calls[1][0]).toContain("app=codex");
  });
});
