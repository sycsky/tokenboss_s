import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnonKeyPasteInput } from "../AnonKeyPasteInput";
import * as triggerModule from "../../lib/triggerDeepLink";

/**
 * AnonKeyPasteInput renders the paste input + AgentImportGrid below. The
 * grid is always visible (Step 2 framing) but disabled until a valid key
 * is pasted. Tests focus on:
 * 1. Disabled state: grid renders, hint banner shown, card clicks no-op.
 * 2. Cold-start CTAs: register + login links open in new tab.
 * 3. Once valid, hint disappears and per-card clicks fire ccswitch:// URLs.
 */

beforeEach(() => {
  vi.restoreAllMocks();
});

// 48 alphanumeric chars — matches the production sk- + 48 chars format.
const VALID_KEY = "sk-" + "A".repeat(48);
const SHORT_KEY = "sk-too-short";
const NO_PREFIX = "A".repeat(48);

describe("AnonKeyPasteInput", () => {
  it("renders the agent grid in a disabled preview state when no valid key is pasted", async () => {
    const triggerSpy = vi
      .spyOn(triggerModule, "triggerDeepLink")
      .mockImplementation(() => {});
    render(<AnonKeyPasteInput />);
    const user = userEvent.setup();

    // Grid is visible up-front (Step 2 framing) so users see the 5
    // target CLIs before they've pasted anything.
    const openclawBtn = screen.getByRole("button", { name: /导入到 OpenClaw/ });
    expect(openclawBtn).toBeInTheDocument();
    expect(openclawBtn).toBeDisabled();
    expect(screen.getByText(/粘 Key 后启用/)).toBeInTheDocument();

    // Clicking a disabled card must NOT fire a ccswitch:// URL.
    await user.click(openclawBtn);
    expect(triggerSpy).not.toHaveBeenCalled();

    // Format errors keep the grid disabled.
    const input = screen.getByLabelText(/API Key/);
    await user.type(input, SHORT_KEY);
    expect(screen.getByRole("button", { name: /导入到 OpenClaw/ })).toBeDisabled();
    expect(screen.getByText(/^格式：/)).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, NO_PREFIX);
    expect(screen.getByRole("button", { name: /导入到 OpenClaw/ })).toBeDisabled();
    expect(screen.getByText(/^格式：/)).toBeInTheDocument();
  });

  it("renders cold-start CTAs (register + login) opening in a new tab", () => {
    render(<AnonKeyPasteInput />);
    const register = screen.getByRole("link", { name: /注册送/ });
    const login = screen.getByRole("link", { name: /登录看我的 Keys/ });
    expect(register).toHaveAttribute("href", "/register");
    expect(register).toHaveAttribute("target", "_blank");
    expect(login).toHaveAttribute("href", "/login");
    expect(login).toHaveAttribute("target", "_blank");
  });

  it("once a valid sk- + 48-char key is pasted, agent grid becomes enabled and per-card clicks fire ccswitch:// URLs", async () => {
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

    // Grid 5 cards transition from disabled to enabled, hint disappears.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /导入到 OpenClaw/ })).not.toBeDisabled();
    });
    expect(screen.queryByText(/粘 Key 后启用/)).toBeNull();

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
