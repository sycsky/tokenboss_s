/**
 * CLI app catalog — single source of truth for the 5 agent CLIs that can
 * one-click import a TokenBoss key via a `ccswitch://` deep link.
 *
 * Pure-data module: no JSX, no async, no IO. Components decide how to
 * resolve `iconKey` to an actual asset import — this keeps the data
 * stable across web/mobile/electron consumers without depending on
 * Vite's asset pipeline.
 *
 * Protocol families:
 *   openai-compat   — talks to /v1/chat/completions on the gateway directly.
 *   anthropic-shim  — Claude Code; routed through TokenBoss's Anthropic
 *                     conversion layer (Messages API ↔ OpenAI Chat
 *                     Completions). Same key works, different base URL.
 *   gemini-proxy    — reserved for future Gemini CLI integration. NOT in
 *                     the deep-link import list today; referenced only by
 *                     docs/manual-setup routes.
 */

export type CLIAppId = "openclaw" | "hermes" | "codex" | "opencode" | "claude";

export interface CLIAppDef {
  id: CLIAppId;
  displayName: string;
  homepage: string;
  /** Stable token consumers map to an asset import. Decoupled from any
   *  bundler so this module stays pure data. */
  iconKey: "openclaw" | "hermes" | "codex" | "opencode" | "claude";
  protocolFamily: "openai-compat" | "anthropic-shim" | "gemini-proxy";
  /** 1-line 中文介绍, surfaced in the CLI selector card under displayName. */
  description: string;
}

export const CLI_APPS: CLIAppDef[] = [
  {
    id: "openclaw",
    displayName: "OpenClaw",
    homepage: "https://openclaw.ai",
    iconKey: "openclaw",
    protocolFamily: "openai-compat",
    description: "本地 Agent + Gateway",
  },
  {
    id: "hermes",
    displayName: "Hermes Agent",
    homepage: "https://hermes.ai",
    iconKey: "hermes",
    protocolFamily: "openai-compat",
    description: "桌面端 AI 协作 Agent",
  },
  {
    id: "codex",
    displayName: "Codex CLI",
    homepage: "https://github.com/openai/codex",
    iconKey: "codex",
    protocolFamily: "openai-compat",
    description: "OpenAI 官方 CLI",
  },
  {
    id: "opencode",
    displayName: "OpenCode",
    homepage: "https://opencode.ai",
    iconKey: "opencode",
    protocolFamily: "openai-compat",
    description: "开源终端 Agent",
  },
  {
    id: "claude",
    displayName: "Claude Code",
    homepage: "https://www.anthropic.com/claude-code",
    iconKey: "claude",
    protocolFamily: "anthropic-shim",
    description: "经 TokenBoss Anthropic 转换层",
  },
];
