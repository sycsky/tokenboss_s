---
name: tokenboss
version: 0.4.0
description: TokenBoss — one API key gives access to OpenAI (Responses API), Anthropic Claude (native messages API), and Google Gemini models. Configures OpenClaw with three providers (`tokenboss-gpt`, `tokenboss-claude`, `tokenboss-gemini`) under `models.providers.*`.
homepage: https://tokenboss.co
api_endpoint: https://api.tokenboss.co
config_file: ~/.openclaw/openclaw.json
last_updated: 2026-04-27
metadata:
  openclaw:
    emoji: 🪙
    requires:
      config:
        - models.providers.tokenboss-claude
        - models.providers.tokenboss-gpt
        - models.providers.tokenboss-gemini
        - agents.defaults.model.primary
        - gateway
    api_key:
      required: true
      prompt: "Paste your TokenBoss API key (from https://tokenboss.co/console)"
      placeholder: "TOKENBOSS_API_KEY"
---

# TokenBoss for OpenClaw

Adds TokenBoss as three OpenClaw providers — `tokenboss-gpt` (OpenAI Responses API), `tokenboss-claude` (Anthropic native messages), `tokenboss-gemini` (OpenAI Chat Completions surface for Gemini). One TokenBoss API key authenticates all three.

## Install

In OpenClaw, run:

```
set up tokenboss.co/skill.md
```

OpenClaw will:
1. Fetch this skill
2. Prompt for `TOKENBOSS_API_KEY`
3. Merge the JSON below into `~/.openclaw/openclaw.json`
4. Set `agents.defaults.model.primary` to `tokenboss-gpt/gpt-5.5` (override anytime)
5. **Restart the gateway** so the new providers and gateway config take effect:
   ```bash
   openclaw gateway restart
   ```
   If your OpenClaw version auto-restarts the gateway after `set up`, this step is a no-op. Otherwise run it manually.

## Configuration to merge into `~/.openclaw/openclaw.json`

**Never blanket-overwrite the file.** Update only the `agents`, `models`, and `gateway` nodes per the rules below. Leave any other top-level keys (`skills`, `wizard`, etc.) and any user-set fields you don't recognise alone. Replace `${TOKENBOSS_API_KEY}` with the value supplied during `set up`.

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "tokenboss-gpt/gpt-5.5"
      }
    }
  },
  "gateway": {
    "mode": "local",
    "port": 18789,
    "bind": "loopback"
  },
  "models": {
    "providers": {
      "tokenboss-claude": {
        "baseUrl": "https://api.tokenboss.co/anthropic",
        "apiKey": "${TOKENBOSS_API_KEY}",
        "api": "anthropic-messages",
        "models": [
          { "id": "claude-sonnet-4-6", "name": "Claude Sonnet 4.6" },
          { "id": "claude-opus-4-7", "name": "Claude Opus 4.7" },
          { "id": "claude-opus-4-5-20251101", "name": "Claude Opus 4.5" },
          { "id": "claude-haiku-4-5-20251001", "name": "Claude Haiku 4.5" }
        ]
      },
      "tokenboss-gpt": {
        "baseUrl": "https://api.tokenboss.co/openai",
        "apiKey": "${TOKENBOSS_API_KEY}",
        "api": "openai-responses",
        "models": [
          { "id": "gpt-5.5", "name": "GPT-5.5" },
          { "id": "gpt-5.4", "name": "GPT-5.4" },
          { "id": "gpt-5.3-codex", "name": "GPT-5.3 Codex" },
          { "id": "gpt-5.1-codex-max", "name": "GPT-5.1 Codex Max" }
        ]
      },
      "tokenboss-gemini": {
        "baseUrl": "https://api.tokenboss.co/openai/v1",
        "apiKey": "${TOKENBOSS_API_KEY}",
        "api": "openai-completions",
        "models": [
          { "id": "gemini-3.1-pro-preview", "name": "Gemini 3.1 Pro" },
          { "id": "gemini-3-flash-preview", "name": "Gemini 3 Flash" }
        ]
      }
    }
  }
}
```

## Merge rules (for the agent applying this skill)

**Golden rule:** if OpenClaw is already configured, do **not** blanket-overwrite. Update only the three nodes below.

- If `~/.openclaw/openclaw.json` does not exist → create it with the JSON above (with `${TOKENBOSS_API_KEY}` substituted).
- If it exists → deep-merge per node:
  - `models.providers.tokenboss-claude` / `tokenboss-gpt` / `tokenboss-gemini` — **overwrite** these three keys (skill-owned; declared in `metadata.openclaw.requires.config`). Other entries already inside `models.providers.*` (e.g. user's existing providers) — preserve.
  - `agents.defaults.model.primary` — set to `tokenboss-gpt/gpt-5.5` only if absent or user confirms; do **not** silently change a user's existing primary model. Other `agents.defaults.*` fields (`maxConcurrent`, `subagents`, `compaction`, `workspace`, etc.) — preserve.
  - `gateway` — if absent, write `{ "mode": "local", "port": 18789, "bind": "loopback" }`. If present, leave it alone unless any field is missing; only fill in missing fields. Never overwrite a user's `port` or `bind` without confirmation.
  - All other top-level keys (`skills`, `wizard`, anything you don't recognise) — preserve verbatim.
- Do not log the API key. Do not echo it to stdout. Store it only in the `apiKey` fields of the three providers.
- After merge:
  - **Always run `openclaw gateway restart`** so provider and gateway changes take effect (unless OpenClaw auto-restarts on `set up`).
  - `agents.defaults` may also require a fresh OpenClaw session.

## Available models

| Provider key | Protocol (`api`) | Base URL | Model IDs |
|---|---|---|---|
| `tokenboss-gpt` | `openai-responses` | `https://api.tokenboss.co/openai` | `gpt-5.5`, `gpt-5.4`, `gpt-5.3-codex`, `gpt-5.1-codex-max` |
| `tokenboss-claude` | `anthropic-messages` | `https://api.tokenboss.co/anthropic` | `claude-sonnet-4-6`, `claude-opus-4-7`, `claude-opus-4-5-20251101`, `claude-haiku-4-5-20251001` |
| `tokenboss-gemini` | `openai-completions` | `https://api.tokenboss.co/openai/v1` | `gemini-3.1-pro-preview`, `gemini-3-flash-preview` |

Reference any model as `<provider-key>/<model-id>`, e.g. `tokenboss-claude/claude-sonnet-4-6`.

## Apply changes

Configuration writes alone are not enough — OpenClaw must reload the gateway to pick up new providers and any `gateway.*` field changes:

```bash
openclaw gateway restart
```

If `set up` did this for you automatically, calling it again is harmless.

## Quick verification

After install + restart:

```bash
# Confirm gateway came back up
openclaw gateway status

# Show current config
openclaw config show models.providers.tokenboss-gpt

# Switch primary model
openclaw models set tokenboss-claude/claude-sonnet-4-6

# Smoke test
openclaw chat "Say hello"
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `401 Unauthorized` | Missing or wrong key | Re-run `set up tokenboss.co/skill.md` to refresh, or `openclaw config set models.providers.tokenboss-gpt.apiKey <KEY>` (repeat for all three providers) |
| `Unknown model id` | Wrong namespace | Use `tokenboss-gpt/...`, `tokenboss-claude/...`, or `tokenboss-gemini/...` |
| `Provider not found` | Skill applied partially | Re-run `set up`; check `~/.openclaw/openclaw.json` has all three provider keys |
| `4xx on /anthropic endpoint` | Wrong `api` field | `tokenboss-claude` must use `api: "anthropic-messages"` |
| `4xx on /openai endpoint` | Wrong `api` field | `tokenboss-gpt` uses `api: "openai-responses"`; `tokenboss-gemini` uses `api: "openai-completions"` |

## Agent Discovery Metadata

```json
{
  "service": "TokenBoss",
  "providers": [
    {"key": "tokenboss-gpt",     "base_url": "https://api.tokenboss.co/openai",    "api": "openai-responses"},
    {"key": "tokenboss-claude",  "base_url": "https://api.tokenboss.co/anthropic", "api": "anthropic-messages"},
    {"key": "tokenboss-gemini",  "base_url": "https://api.tokenboss.co/openai/v1", "api": "openai-completions"}
  ],
  "auth": "single Bearer token across all three providers",
  "config_file": "~/.openclaw/openclaw.json",
  "install": "set up tokenboss.co/skill.md",
  "get_key": "https://tokenboss.co/console"
}
```

---

Get your key: <https://tokenboss.co/console>
