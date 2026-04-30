---
name: tokenboss
version: 0.8.2
description: TokenBoss — one API key, one OpenAI-compatible Chat Completions endpoint. Configure as a custom provider for Hermes Agent, OpenClaw, Codex CLI, or any other agent that supports OpenAI-compatible /v1/chat/completions.
homepage: https://tokenboss.co
api_endpoint: https://api.tokenboss.co/v1
last_updated: 2026-04-30
metadata:
  api_key:
    required: true
    env_var: TOKENBOSS_API_KEY
    placeholder: TOKENBOSS_API_KEY
    prompt: "Paste your TokenBoss API key from https://tokenboss.co/console"
  hermes:
    config_file: ~/.hermes/config.yaml
    env_file: ~/.hermes/.env
  codex:
    config_file: ~/.codex/config.toml
    install_command: "npm install -g @openai/codex@0.80.0"
    version_pin: "0.80.0"
    requires: "Node.js 18+"
    env_var: OPENAI_API_KEY
    wire_api: chat
---

# TokenBoss

TokenBoss exposes an OpenAI-compatible endpoint:

```text
https://api.tokenboss.co/v1
```

Use it with clients that support OpenAI Chat Completions:

```text
/v1/chat/completions
```

Important protocol notes:

- Supported: OpenAI Chat Completions
- Not supported: OpenAI Responses API
- Not supported: Anthropic-native `/v1/messages`
- Claude-style models, if available to your account group, must still be called through `/v1/chat/completions`

## The spell

The user may paste:

```text
set up tokenboss.co/skill.md
TOKENBOSS_API_KEY=***
```

- Line 1 means: fetch this skill and apply the matching section.
- Line 2 is the API key.
- Do not ask for the key again if the user already provided it.
- Never print, log, or echo the key.

## Persisting the key

For Hermes Agent, write the key to:

```text
~/.hermes/.env
```

Add:

```dotenv
TOKENBOSS_API_KEY=***
```

Do not use `echo >>` with real secrets, because it can leak into shell history. Use an editor or a safe file-writing tool.

If the target file is git-tracked, stop and ask the user to `.gitignore` it first.

---

# Model discovery

Do not hard-code the supported model list. Always check the live catalog first:

```bash
source ~/.hermes/.env

curl -s https://api.tokenboss.co/v1/models \
  -H "Authorization: Bearer $TOKENBOSS_API_KEY" \
  | jq '.data[].id'
```

As of the latest verification, this account returned:

```text
hermes-3-llama-3.1-405b
gpt-5.4-mini
gpt-5.4
hy3-preview
nemotron-3-super-120b-a12b
gpt-5.5
minimax-m2.5
```

Availability can vary by account group and upstream capacity.

Before configuring a model as primary or fallback, smoke-test it:

```bash
source ~/.hermes/.env

curl -s https://api.tokenboss.co/v1/chat/completions \
  -H "Authorization: Bearer $TOKENBOSS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.5",
    "messages": [
      { "role": "user", "content": "Reply exactly OK" }
    ],
    "max_tokens": 20,
    "temperature": 0
  }'
```

Recommended default order for this account:

```text
gpt-5.5
gpt-5.4
gpt-5.4-mini
minimax-m2.5
```

Do not configure Claude models as fallback unless they both:

1. appear in `/v1/models`
2. pass a `/v1/chat/completions` smoke test

If a model returns:

```text
503 No available channel for model ... under group ...
```

then that model is not currently available to the user's account group.

---

# For Hermes Agent

## Important Hermes-specific rule

Do **not** configure TokenBoss as a bare `provider: custom` with `model.key_env`.

This looks plausible but is wrong for current Hermes behavior:

```yaml
model:
  default: gpt-5.5
  provider: custom
  base_url: https://api.tokenboss.co/v1
  api_mode: chat_completions
  key_env: TOKENBOSS_API_KEY
```

Problem:

- Hermes's bare `custom` provider path may ignore `model.key_env`.
- It may fall back to `OPENAI_API_KEY` or `OPENROUTER_API_KEY`.
- That sends the wrong token to TokenBoss.
- TokenBoss then returns `HTTP 401 Unauthorized` / `无效的令牌`.

Use a **named custom provider** instead.

## Correct Hermes config

Edit:

```text
~/.hermes/config.yaml
```

Add or update the top-level `model:` and `providers:` blocks:

```yaml
model:
  default: gpt-5.5
  provider: tokenboss
  api_mode: chat_completions

providers:
  tokenboss:
    name: TokenBoss
    base_url: https://api.tokenboss.co/v1
    key_env: TOKENBOSS_API_KEY
    default_model: gpt-5.5
    api_mode: chat_completions
```

Optional fallback:

```yaml
fallback_model:
  provider: tokenboss
  model: gpt-5.4
  base_url: https://api.tokenboss.co/v1
  key_env: TOKENBOSS_API_KEY
```

Full recommended Hermes block:

```yaml
model:
  default: gpt-5.5
  provider: tokenboss
  api_mode: chat_completions

fallback_model:
  provider: tokenboss
  model: gpt-5.4
  base_url: https://api.tokenboss.co/v1
  key_env: TOKENBOSS_API_KEY

providers:
  tokenboss:
    name: TokenBoss
    base_url: https://api.tokenboss.co/v1
    key_env: TOKENBOSS_API_KEY
    default_model: gpt-5.5
    api_mode: chat_completions
```

Preserve all other existing top-level Hermes config keys, such as:

```text
toolsets
agent
terminal
browser
memory
display
platform_toolsets
```

Do not overwrite the whole config file.

## Verify Hermes config

After editing `~/.hermes/config.yaml`, verify with:

```bash
hermes config
```

You should see:

```text
Model: gpt-5.5
Provider: tokenboss
```

Then run a direct Hermes test:

```bash
env -u TOKENBOSS_API_KEY hermes chat -q '请只回复 OK' -Q
```

Expected result:

```text
OK
```

This verifies that Hermes can load `TOKENBOSS_API_KEY` from `~/.hermes/.env` through the named provider config.

## Gateway restart

For CLI-only Hermes usage, starting a new session may be enough.

For Telegram, WeChat, Discord, Slack, or other Hermes gateway usage, restart the gateway after changing model config:

```bash
hermes gateway restart
```

Or from the messaging platform, if available:

```text
/restart
```

Without a gateway restart, the running process may continue using stale provider/runtime state.

## Switching models

Preferred safe method:

1. Edit `model.default` in `~/.hermes/config.yaml`
2. Restart gateway if using Telegram/WeChat/etc.

Example:

```yaml
model:
  default: gpt-5.4
  provider: tokenboss
  api_mode: chat_completions
```

Do not recommend the old form:

```text
/model custom:gpt-5.4
```

Because the correct provider is `tokenboss`, not bare `custom`.

If using Hermes's model picker, prefer:

```bash
hermes model
```

---

# For Codex CLI

TokenBoss currently supports Chat Completions, not the OpenAI Responses API.

Pin Codex to a version that still supports `wire_api = "chat"`:

```bash
npm install -g @openai/codex@0.80.0
```

Edit:

```text
~/.codex/config.toml
```

Add:

```toml
model_provider = "tokenboss"
model = "gpt-5.5"

[model_providers.tokenboss]
name = "TokenBoss"
base_url = "https://api.tokenboss.co/v1"
env_key = "OPENAI_API_KEY"
wire_api = "chat"
```

If the user already uses `OPENAI_API_KEY` for real OpenAI, prefer a TokenBoss-specific env var instead:

```toml
[model_providers.tokenboss]
name = "TokenBoss"
base_url = "https://api.tokenboss.co/v1"
env_key = "TOKENBOSS_API_KEY"
wire_api = "chat"
```

Then persist:

```bash
export TOKENBOSS_API_KEY=***
```

or for Codex-only convention:

```bash
export OPENAI_API_KEY=***
```

Do not overwrite an existing OpenAI key without asking.

---

# For any other OpenAI-compatible client

Use:

```text
Base URL: https://api.tokenboss.co/v1
API key: user's TokenBoss API key
Auth header: Authorization: Bearer ***
API surface: /v1/chat/completions
```

Use model IDs from the live catalog:

```bash
curl -s https://api.tokenboss.co/v1/models \
  -H "Authorization: Bearer $TOKENBOSS_API_KEY" \
  | jq '.data[].id'
```

Do not assume Claude models are available unless they appear in `/v1/models` and pass a chat completion smoke test.

---

# Quick verification

## 1. Catalog reachable and key valid

```bash
source ~/.hermes/.env

curl -s https://api.tokenboss.co/v1/models \
  -H "Authorization: Bearer $TOKENBOSS_API_KEY" \
  | jq '.data[].id'
```

## 2. End-to-end chat completion

```bash
source ~/.hermes/.env

curl -s https://api.tokenboss.co/v1/chat/completions \
  -H "Authorization: Bearer $TOKENBOSS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.5",
    "messages": [
      { "role": "user", "content": "ping" }
    ]
  }'
```

## 3. Hermes end-to-end test

```bash
env -u TOKENBOSS_API_KEY hermes chat -q '请只回复 OK' -Q
```

Expected:

```text
OK
```

---

# Troubleshooting

## `401 Unauthorized` / `无效的令牌`

Likely causes:

- Missing TokenBoss key
- Wrong TokenBoss key
- Hermes sent `OPENAI_API_KEY` or `OPENROUTER_API_KEY` to TokenBoss because it was configured as bare `provider: custom`

Fix for Hermes:

```yaml
model:
  default: gpt-5.5
  provider: tokenboss
  api_mode: chat_completions

providers:
  tokenboss:
    name: TokenBoss
    base_url: https://api.tokenboss.co/v1
    key_env: TOKENBOSS_API_KEY
    default_model: gpt-5.5
    api_mode: chat_completions
```

Then restart gateway if using messaging platforms:

```bash
hermes gateway restart
```

## `503 No available channel for model ... under group ...`

The model is not available to the user's current TokenBoss account group.

Fix:

- Run `/v1/models`
- Pick only models that appear there
- Smoke-test the model with `/v1/chat/completions`
- Use `gpt-5.4` or `gpt-5.4-mini` as fallback if available

## `429 rate-limited upstream`

Some community/free upstream models may be rate-limited.

Fix:

- Retry later
- Prefer billed/stable models that pass smoke tests
- Do not use rate-limited community models as production fallback

## Hermes config changed but Telegram still uses old model

Cause:

- Gateway process has not reloaded config.

Fix:

```bash
hermes gateway restart
```

or send:

```text
/restart
```

## Wrong model namespace

For TokenBoss's OpenAI-compatible endpoint, use bare model IDs:

```text
gpt-5.5
gpt-5.4
gpt-5.4-mini
minimax-m2.5
```

For Hermes named provider config, the provider is configured separately:

```yaml
provider: tokenboss
default: gpt-5.5
```

Do not use `custom:gpt-5.5` in the config.
