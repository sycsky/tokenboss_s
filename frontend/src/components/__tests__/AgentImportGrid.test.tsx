import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentImportGrid } from "../AgentImportGrid";
import { CLI_APPS, type CLIAppId } from "../../lib/agentDefs";
import * as triggerModule from "../../lib/triggerDeepLink";

/**
 * Per-card click model: each card click = 1 user gesture = 1 triggerDeepLink
 * call. The grid lazily fetches URLs on the FIRST click (any card) and
 * caches them — D7 backend means /v1/deep-link N times = N different keys,
 * of which only the last works. Cache prevents that.
 */

function makeUrls(): Map<CLIAppId, string> {
  return new Map(
    CLI_APPS.map((a) => [a.id, `ccswitch://v1/import?app=${a.id}`]),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("AgentImportGrid", () => {
  it("renders 5 agent cards by default", () => {
    const getUrls = vi.fn().mockResolvedValue(makeUrls());
    render(<AgentImportGrid getUrls={getUrls} />);

    // Each app's displayName should show up as a card heading.
    for (const app of CLI_APPS) {
      expect(
        screen.getByRole("heading", { name: new RegExp(app.displayName) }),
      ).toBeInTheDocument();
    }
    expect(screen.getByText(/0\/5 已导入/)).toBeInTheDocument();
  });

  it("first card click: fetches URLs once, triggers that one URL, marks done", async () => {
    const triggerSpy = vi.spyOn(triggerModule, "triggerDeepLink").mockImplementation(() => {});
    const getUrls = vi.fn().mockResolvedValue(makeUrls());
    render(<AgentImportGrid getUrls={getUrls} />);
    const user = userEvent.setup();

    // Click the OpenClaw card's import button.
    const openclawButton = screen.getByRole("button", { name: /导入到 OpenClaw/ });
    await user.click(openclawButton);

    await waitFor(() => expect(triggerSpy).toHaveBeenCalledTimes(1));
    expect(triggerSpy).toHaveBeenCalledWith("ccswitch://v1/import?app=openclaw");
    expect(getUrls).toHaveBeenCalledTimes(1);

    // Card now shows "再发一次给 CC Switch" (done state).
    expect(
      screen.getByRole("button", { name: /再发一次给 CC Switch/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/1\/5 已导入/)).toBeInTheDocument();
  });

  it("subsequent card clicks use cached URLs (getUrls NOT called again)", async () => {
    const triggerSpy = vi.spyOn(triggerModule, "triggerDeepLink").mockImplementation(() => {});
    const getUrls = vi.fn().mockResolvedValue(makeUrls());
    render(<AgentImportGrid getUrls={getUrls} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /导入到 OpenClaw/ }));
    await waitFor(() => expect(triggerSpy).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: /导入到 Codex CLI/ }));
    await waitFor(() => expect(triggerSpy).toHaveBeenCalledTimes(2));

    // getUrls only ever called once — second click used cache.
    expect(getUrls).toHaveBeenCalledTimes(1);
    expect(triggerSpy.mock.calls[1][0]).toBe("ccswitch://v1/import?app=codex");
    expect(screen.getByText(/2\/5 已导入/)).toBeInTheDocument();
  });

  it("shows celebration block after all 5 cards triggered", async () => {
    vi.spyOn(triggerModule, "triggerDeepLink").mockImplementation(() => {});
    render(<AgentImportGrid getUrls={vi.fn().mockResolvedValue(makeUrls())} />);
    const user = userEvent.setup();

    for (const app of CLI_APPS) {
      await user.click(screen.getByRole("button", { name: new RegExp(`导入到 ${app.displayName}`) }));
    }

    await waitFor(() => expect(screen.getByText(/5\/5 已导入/)).toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent(/都发到 CC Switch/);
  });

  it("shows error and remains retryable when getUrls fails", async () => {
    const triggerSpy = vi.spyOn(triggerModule, "triggerDeepLink").mockImplementation(() => {});
    const getUrls = vi.fn().mockRejectedValueOnce(new Error("network down"));
    render(<AgentImportGrid getUrls={getUrls} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /导入到 OpenClaw/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/失败|network/i);

    // triggerDeepLink not called since fetch failed.
    expect(triggerSpy).not.toHaveBeenCalled();
    // Card returned to idle so user can retry.
    expect(
      screen.getByRole("button", { name: /导入到 OpenClaw/ }),
    ).not.toBeDisabled();
  });
});
