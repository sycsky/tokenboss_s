---
name: tokenboss
version: 0.8.1
description: TokenBoss — one API key, one OpenAI-compatible endpoint, six curated models (three GPT, three Claude). Configure as a custom provider on OpenClaw, Hermes Agent, Codex CLI (pin 0.80.0), or any other agent that speaks OpenAI Chat Completions. Use when setting up TokenBoss, switching LLM provider, or configuring AI routing.
homepage: https://tokenboss.co
api_endpoint: https://api.tokenboss.co/v1
last_updated: 2026-04-30
metadata:
  api_key:
    required: true
    env_var: TOKENBOSS_API_KEY
    placeholder: TOKENBOSS_API_KEY
    prompt: "Paste your TokenBoss API key (from https://tokenboss.co/console)"
  openclaw:
    config_file: ~/.openclaw/openclaw.json
    provider_key: tokenboss
  hermes:
    config_file: ~/.hermes/config.yaml
    env_file: ~/.hermes/.env
  codex:
    config_file: ~/.codex/config.toml
    # Lock to 0.80.0 — newer Codex versions removed `wire_api = "chat"` and
    # force the OpenAI Responses API; TokenBoss only exposes Chat Completions
    # (/v1/chat/completions), so the protocol mismatch makes anything > 0.80
    # unable to talk to the endpoint. Lifts when the backend adds Responses.
    install_command: "npm install -g @openai/codex@0.80.0"
    version_pin: "0.80.0"
    requires: "Node.js 18+"
    # Codex hard-codes the env var lookup; key_env in the provider table
    # tells it which name to read from. Default to OPENAI_API_KEY since
    # that's the muscle-memory variable for Codex users.
    env_var: OPENAI_API_KEY
    wire_api: chat
---

# TokenBoss

One API key, one OpenAI-compatible endpoint, six curated models. Configure TokenBoss as a custom provider on **OpenClaw**, **Hermes Agent**, **Codex CLI**, or any other agent that speaks OpenAI Chat Completions.

> **Protocol** — OpenAI Chat Completions only (`/v1/chat/completions`). The Anthropic-native `/v1/messages` endpoint is **not** available; Claude models (`claude-*`) are reached through `/v1/chat/completions` like any OpenAI model. See [Claude Code users](#claude-code-users) for a workaround.

## The spell

The user pastes two lines — copied from <https://tokenboss.co/console>:

```
set up tokenboss.co/skill.md
TOKENBOSS_API_KEY=sk-XXXXXXXX
```

- Line 1 = "fetch this URL and apply the section that matches me."
- Line 2 = the user's API key in `KEY=VALUE` form; use it as the bearer credential and **do not ask the user again**.

If only Line 1 was pasted, prompt once for the key.

## Persisting the key

Edit the target file directly — never `echo >>`, which leaks the value into shell history.

```
# ~/.hermes/.env
TOKENBOSS_API_KEY=<key>
```

```
# ~/.zshrc or ~/.bashrc (for OpenClaw)
export TOKENBOSS_API_KEY=<key>
```

If the target file is git-tracked, abort and ask the user to `.gitignore` it first. Never log, print, or copy the key value into chat output.

## Supported models

| Model ID | Family | Notes |
|---|---|---|
| `gpt-5.5` | OpenAI | Default primary |
| `gpt-5.4` | OpenAI | |
| `gpt-5.4-mini` | OpenAI | Lower-cost |
| `claude-sonnet-4-6` | Anthropic | |
| `claude-opus-4-6` | Anthropic | Runs in thinking mode by default — the response `model` field reports `claude-opus-4-6-thinking` and reasoning tokens are billed |
| `claude-opus-4-7` | Anthropic | Newest Anthropic tier; if you receive `503 No available channel`, the model is being provisioned for your group — check the console or fall through to `claude-opus-4-6` |

### Model discovery

```bash
curl -s https://api.tokenboss.co/v1/models \
  -H "Authorization: Bearer $TOKENBOSS_API_KEY" | jq '.data[].id'
```

`/v1/models` returns the live catalog. In addition to the six curated models above, free community models (e.g. `nemotron-3-super-120b-a12b`, `hy3-preview`) may appear; their availability depends on upstream free-tier capacity and they may return `429` without warning. The six curated IDs above are the supported, billed models — prefer them in production.

### Feature compatibility

- ✅ Streaming (`stream: true`, server-sent events)
- ✅ Tool / function calling (`tools`, `tool_choice`)
- ✅ JSON mode (`response_format: { "type": "json_object" }`)
- ✅ System messages (passed through verbatim, including for `claude-*`)
- ❌ Embeddings, image generation, audio (`/v1/embeddings`, `/v1/images`, `/v1/audio` are not exposed)
- ❌ Anthropic-native `/v1/messages`
- ❌ OpenAI Responses API (`/v1/responses`)

---

## For OpenClaw

Merge into `~/.openclaw/openclaw.json`. **Never blanket-overwrite the file.** Update only the keys called out below — preserve every other top-level key (`skills`, `wizard`, etc.) and every other entry already inside `models.providers`.

### Provider block

In `models.providers`, add or overwrite the key `"tokenboss"`:

```json
"tokenboss": {
  "baseUrl": "https://api.tokenboss.co/v1",
  "api": "openai-completions",
  "apiKey": "${TOKENBOSS_API_KEY}",
  "models": [
    { "id": "gpt-5.5",            "name": "GPT 5.5" },
    { "id": "gpt-5.4",            "name": "GPT 5.4" },
    { "id": "gpt-5.4-mini",       "name": "GPT 5.4 Mini" },
    { "id": "claude-sonnet-4-6",  "name": "Claude Sonnet 4.6" },
    { "id": "claude-opus-4-6",    "name": "Claude Opus 4.6 (thinking)" },
    { "id": "claude-opus-4-7",    "name": "Claude Opus 4.7" }
  ]
}
```

If your OpenClaw build expects an explicit `contextWindow` per model, fetch the value from the upstream provider's published spec and add it — TokenBoss does not advertise per-model limits via `/v1/models`.

### Default model + fallback chain

In `agents.defaults.model`, merge:

```json
"model": {
  "primary": "tokenboss/gpt-5.5",
  "fallbacks": [
    "tokenboss/gpt-5.4",
    "tokenboss/gpt-5.4-mini",
    "tokenboss/claude-sonnet-4-6",
    "tokenboss/claude-opus-4-6",
    "tokenboss/claude-opus-4-7"
  ]
}
```

The fallback order ends with `claude-opus-4-6` ahead of `claude-opus-4-7` so a temporary 503 on 4.7 still resolves to the closest equivalent.

Merge rules:
- Set `primary` only if absent — do **not** silently change a user's existing primary model.
- Append missing fallback entries; do not remove ones the user already has.
- Other `agents.defaults.*` fields (`maxConcurrent`, `compaction`, `workspace`, etc.) — preserve verbatim.

If `primary` returns 4xx/5xx, OpenClaw walks the fallbacks in order. Models the user's key isn't entitled to (or that return `503 No available channel`) are skipped automatically.

### Apply

OpenClaw watches `~/.openclaw/openclaw.json` and reloads provider config automatically. If your version doesn't, restart the gateway (use whatever command your OpenClaw build documents — typically `openclaw gateway restart` or a tray-app menu item).

Verify by listing models from inside OpenClaw, or directly:

```bash
curl -s https://api.tokenboss.co/v1/models \
  -H "Authorization: Bearer $TOKENBOSS_API_KEY" | jq '.data[].id'
```

---

## For Hermes Agent

Edit `~/.hermes/config.yaml` (top-level keys) and write `TOKENBOSS_API_KEY` to `~/.hermes/.env`. Hermes picks up `model:` changes on the next session — no daemon to restart.

### Config block

In `~/.hermes/config.yaml`, set the top-level `model:` and `fallback_model:` blocks. **If the user already has a non-default `model:`, ask before replacing it.** Other top-level keys (`providers`, `toolsets`, `agent`, etc.) — leave alone.

```yaml
model:
  default: gpt-5.5
  provider: custom
  base_url: https://api.tokenboss.co/v1
  api_mode: chat_completions
  key_env: TOKENBOSS_API_KEY

fallback_model:
  provider: custom
  model: claude-sonnet-4-6
  base_url: https://api.tokenboss.co/v1
  key_env: TOKENBOSS_API_KEY
```

> Hermes supports exactly **one** `fallback_model` per session. The example falls back from GPT to Claude so a primary outage on either family still leaves the user with something to talk to. Swap to `gpt-5.4` if you'd rather keep both on the same family.

### Switch model mid-session

Use the slash command shape Hermes documents for custom providers — typical forms:

```
/model custom:gpt-5.4
/model custom:gpt-5.4-mini
/model custom:claude-sonnet-4-6
/model custom:claude-opus-4-6
/model custom:claude-opus-4-7
```

---

## For Codex CLI

OpenAI's official CLI. Configuration is TOML-based and the bearer credential is read from an environment variable named in the provider table.

### Install

> **Pin to 0.80.0.** Codex versions after 0.80 removed the `wire_api = "chat"` provider option and force the OpenAI Responses API. TokenBoss only exposes Chat Completions (`/v1/chat/completions`), so newer Codex can't talk to it at the protocol layer. This pin can be lifted once the backend adds a Responses-API surface.

```bash
# Requires Node.js 18+. The version pin is load-bearing — see note above.
npm install -g @openai/codex@0.80.0
```

### Config block

Edit `~/.codex/config.toml`. Add the `tokenboss` provider table and set the top-level `model_provider` / `model` to point at it. **Preserve any existing `[model_providers.*]` tables** — Codex supports multiple providers side by side.

```toml
model_provider = "tokenboss"
model = "gpt-5.5"

[model_providers.tokenboss]
name = "TokenBoss"
base_url = "https://api.tokenboss.co/v1"
env_key = "OPENAI_API_KEY"
wire_api = "chat"
```

`wire_api = "chat"` selects the OpenAI Chat Completions surface — required because TokenBoss exposes that protocol only (the newer Codex Responses API surface is **not** supported, see the Protocol note at the top of this file).

### Persist the key

Codex reads its bearer credential from the env var named in `env_key` — `OPENAI_API_KEY` by convention. Append it to the shell profile so every `codex` run picks it up:

```
# Add to ~/.zshrc or ~/.bashrc — open in an editor; do NOT echo >> the file
# (that writes the key into shell history). Then re-source the profile.
export OPENAI_API_KEY=<key>
```

> If the user already uses Codex against the real OpenAI API and you don't want to clobber their existing `OPENAI_API_KEY`, switch `env_key` in the provider table to a TokenBoss-specific name (e.g. `TOKENBOSS_API_KEY`) and persist that instead.

### Switch model mid-session

Codex doesn't have a runtime `/model` switch — model is config-driven. To change models, edit `model = "..."` in `~/.codex/config.toml` (any of `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `claude-sonnet-4-6`, `claude-opus-4-6`, `claude-opus-4-7`) and rerun `codex`.

---

## For any other agent

If the agent supports an **OpenAI-compatible custom endpoint** (Cherry Studio, Chatbox, LobeChat, NextChat, Cursor, Continue, Cline, OpenAI SDK, etc.), point it at:

| Field | Value |
|---|---|
| Base URL | `https://api.tokenboss.co/v1` |
| API key | the user's TokenBoss key |
| Auth header | `Authorization: Bearer <key>` |
| Model IDs | `gpt-5.5` · `gpt-5.4` · `gpt-5.4-mini` · `claude-sonnet-4-6` · `claude-opus-4-6` · `claude-opus-4-7` |

### Claude Code users

Claude Code defaults to Anthropic-native `/v1/messages`, which TokenBoss does not expose. To use TokenBoss from Claude Code, run an OpenAI ↔ Anthropic protocol shim locally (e.g. `claude-code-router`) and point Claude Code at the shim.

---

## Quick verification

```bash
# 1. Catalog reachable + key valid
curl -s https://api.tokenboss.co/v1/models \
  -H "Authorization: Bearer $TOKENBOSS_API_KEY" | jq '.data[].id'

# 2. End-to-end chat completion
curl -s https://api.tokenboss.co/v1/chat/completions \
  -H "Authorization: Bearer $TOKENBOSS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.5","messages":[{"role":"user","content":"ping"}]}'
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `401 Unauthorized` | Missing or wrong key | Reissue at <https://tokenboss.co/console>; update `~/.hermes/.env` (Hermes) or re-export `TOKENBOSS_API_KEY` and restart the gateway (OpenClaw) |
| `Unknown model` / `model not found` (client-side) | Wrong namespace | OpenClaw uses `tokenboss/<model-id>`. Hermes uses `custom:<model-id>`. Other agents use the bare model id (`gpt-5.5`, `claude-opus-4-7`, …) |
| `503 No available channel for model X under group Y` | The model isn't bound to a live channel for your group right now (provisioning, temporary capacity issue, or upstream outage) | Retry; if persistent, fall back to a sibling model (e.g. `claude-opus-4-6` instead of `claude-opus-4-7`) and ping support via the console |
| `429 Provider returned error ... :free is temporarily ...` | Free community model upstream is rate-limited or off | Switch to a curated model (any of the six above) — free community IDs are best-effort only |
| `200` with empty `choices[].message.content` | Model returned an empty completion (often `max_tokens` too low or model-specific quirk) | Raise `max_tokens`, give a more direct prompt, or switch to a different model |
| `404 /v1/v1/...` | Base URL has trailing `/v1` and the agent appended its own | Base URL **must** end with `/v1`. For clients that auto-append `/v1`, drop the trailing `/v1` |
| `404 POST /v1/messages` | Client is using Anthropic-native protocol | TokenBoss exposes OpenAI Chat Completions only — see [Claude Code users](#claude-code-users) for the shim approach |
