import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import OnboardWelcome from "../OnboardWelcome";
import { AuthProvider } from "../../lib/auth";

describe("OnboardWelcome footnote (gh-3 P1 fix)", () => {
  it("renders 'I AM A HUMAN' card with CC Switch one-click footnote", () => {
    render(<MemoryRouter><AuthProvider><OnboardWelcome /></AuthProvider></MemoryRouter>);
    expect(screen.getByText("我是人类")).toBeInTheDocument();
    expect(screen.getByText("含 CC Switch 一键导入 · 支持 5 个 CLI")).toBeInTheDocument();
    expect(
      screen.getByText("已支持 OpenClaw · Hermes Agent"),
    ).toBeInTheDocument();
  });
});
