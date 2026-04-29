---
name: tokenboss
version: 0.6.0
description: TokenBoss — one API key, one OpenAI-compatible endpoint, six models (three GPT, three Claude). Configure as a custom provider on OpenClaw, Hermes Agent, or any other agent that speaks OpenAI Chat Completions. Use when setting up TokenBoss, switching LLM provider, or configuring AI routing.
homepage: https://tokenboss.co
api_endpoint: https://api.tokenboss.co/v1
last_updated: 2026-04-29
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
---

# TokenBoss

One API key, one OpenAI-compatible endpoint, six models. Configure TokenBoss as a custom provider on **OpenClaw**, **Hermes Agent**, or any other agent that speaks OpenAI Chat Completions.

- API base URL: `https://api.tokenboss.co/v1`
- Auth: `Authorization: Bearer ${TOKENBOSS_API_KEY}`
- Protocol: OpenAI Chat Completions (`/v1/chat/completions`)
- Get your key: <https://tokenboss.co/console>

## The spell

The user pastes a two-line spell — copied from <https://tokenboss.co/console>:

```
set up tokenboss.co/skill.md
TOKENBOSS_API_KEY=sk-XXXXXXXX
```

- **Line 1** — `set up <skill-url>`. OpenClaw treats this as native grammar and runs the fetch + merge automatically. For agents that don't recognise the `set up` keyword (Hermes, Cherry, Codex, Claude Code, etc.), interpret Line 1 as: *fetch this URL and apply the section that matches me*.
- **Line 2** — `KEY=VALUE` shell-style assignment. The value after `=` is the user's TokenBoss API key. Use it as the bearer credential for every merge below. **Do not ask the user again.**

If the user pasted only Line 1 (no key on Line 2), prompt them once for their key.

For agents that only accept a natural-language prompt, the equivalent trigger is:

> Fetch https://tokenboss.co/skill.md and follow the section for the agent I'm using. The user has pasted `TOKENBOSS_API_KEY=...` along with this prompt — use that value, don't ask again.

## Persisting the key

The key from Line 2 needs to live somewhere the runtime can read it on every call:

```bash
# Hermes
echo 'TOKENBOSS_API_KEY=<key>' >> ~/.hermes/.env

# OpenClaw — append to the shell profile so the gateway picks it up on launch
echo 'export TOKENBOSS_API_KEY=<key>' >> ~/.zshrc   # or ~/.bashrc
```

Never log the key value. If `~/.hermes/.env` is git-tracked, abort and ask the user to add `.env` to `.gitignore` first.

## Supported models

| Model ID | Family | Context |
|---|---|---|
| `gpt-5.5` | OpenAI | 200K |
| `gpt-5.4` | OpenAI | 200K |
| `gpt-5.4-mini` | OpenAI | 128K |
| `claude-opus-4-7` | Anthropic | 200K |
| `claude-opus-4-6` | Anthropic | 200K |
| `claude-sonnet-4-6` | Anthropic | 200K |

All six are reachable through the same OpenAI Chat Completions endpoint — pick by the `model` field in the request body.

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
    { "id": "gpt-5.5",            "name": "GPT 5.5",            "contextWindow": 200000 },
    { "id": "gpt-5.4",            "name": "GPT 5.4",            "contextWindow": 200000 },
    { "id": "gpt-5.4-mini",       "name": "GPT 5.4 Mini",       "contextWindow": 128000 },
    { "id": "claude-opus-4-7",    "name": "Claude Opus 4.7",    "contextWindow": 200000 },
    { "id": "claude-opus-4-6",    "name": "Claude Opus 4.6",    "contextWindow": 200000 },
    { "id": "claude-sonnet-4-6",  "name": "Claude Sonnet 4.6",  "contextWindow": 200000 }
  ]
}
```

### Default model + fallback chain

In `agents.defaults.model`, merge:

```json
"model": {
  "primary": "tokenboss/gpt-5.5",
  "fallbacks": [
    "tokenboss/gpt-5.4",
    "tokenboss/gpt-5.4-mini",
    "tokenboss/claude-opus-4-7",
    "tokenboss/claude-opus-4-6",
    "tokenboss/claude-sonnet-4-6"
  ]
}
```

Merge rules:
- Set `primary` only if absent — do **not** silently change a user's existing primary model.
- Append missing fallback entries; do not remove ones the user already has.
- Other `agents.defaults.*` fields (`maxConcurrent`, `compaction`, `workspace`, etc.) — preserve verbatim.

If `primary` returns 4xx/5xx, OpenClaw walks the fallbacks in order. Models the user's key isn't entitled to are auto-skipped.

### Apply

OpenClaw watches `~/.openclaw/openclaw.json` and reloads provider config automatically. If your version doesn't, restart the gateway:

```bash
openclaw gateway restart
```

Verify:

```bash
openclaw models list
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
  model: gpt-5.4
  base_url: https://api.tokenboss.co/v1
  key_env: TOKENBOSS_API_KEY
```

> Hermes supports exactly **one** `fallback_model` per session. `gpt-5.4` keeps primary + fallback on the same endpoint. Pick a different model id (e.g. `claude-sonnet-4-6`) if you'd rather fall back across families.

### Env

```bash
echo 'TOKENBOSS_API_KEY=<key>' >> ~/.hermes/.env
```

If `~/.hermes/.env` is git-tracked, abort and ask the user to add `.env` to `.gitignore` first.

### Switch model mid-session

```
/model custom:gpt-5.4
/model custom:gpt-5.4-mini
/model custom:claude-opus-4-7
/model custom:claude-sonnet-4-6
```

Verify:

```bash
hermes model
```

---

## For any other agent

If the agent supports an **OpenAI-compatible custom endpoint** (Cherry Studio, Chatbox, LobeChat, NextChat, OpenAI SDK, etc.), point it at:

| Field | Value |
|---|---|
| Base URL | `https://api.tokenboss.co/v1` |
| API key | the user's TokenBoss key |
| Model IDs | `gpt-5.5` · `gpt-5.4` · `gpt-5.4-mini` · `claude-opus-4-7` · `claude-opus-4-6` · `claude-sonnet-4-6` |
| Auth header | `Authorization: Bearer <key>` |

The same Bearer token works for every model.

---

## Quick verification

```bash
curl -s https://api.tokenboss.co/v1/chat/completions \
  -H "Authorization: Bearer $TOKENBOSS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.5","messages":[{"role":"user","content":"ping"}]}'
```

A 200 with a chat completion in the body means the endpoint, key, and model are all good.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `401 Unauthorized` | Missing or wrong key | Reissue at <https://tokenboss.co/console>; update `~/.hermes/.env` (Hermes) or re-export `TOKENBOSS_API_KEY` and restart the gateway (OpenClaw) |
| `Unknown model` / `model not found` | Wrong namespace | OpenClaw uses `tokenboss/<model-id>`. Hermes uses `custom:<model-id>`. Other agents use the bare model id (`gpt-5.5`, `claude-opus-4-7`, …) |
| `404 /v1/v1/...` | Base URL has trailing `/v1` and the agent appended its own | Base URL **must** end with `/v1`. For clients that auto-append `/v1`, drop the trailing `/v1` |

---

Get your key: <https://tokenboss.co/console>
