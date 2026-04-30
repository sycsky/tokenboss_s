# SDK Source Attribution Contract

## What this is

TokenBoss tracks which Agent (OpenClaw / Hermes / Claude Code / Codex /
third-party) made each `POST /v1/chat/completions` call so the user's
`/console/history` can show real attribution instead of generic API-key
labels.

## What an SDK should do

Send a `X-Source` header on every chat completion request:

```http
POST /v1/chat/completions
X-Source: openclaw
Authorization: Bearer sk-xxx
Content-Type: application/json
```

### Header value

- Charset: `[a-z0-9-]`
- Length: 1-32 chars (longer is silently truncated)
- Lowercase (uppercase is silently lowercased)

### Canonical slugs (TokenBoss-recognized)

| Slug | Display |
|---|---|
| `openclaw` | OpenClaw |
| `hermes` | Hermes |
| `claude-code` | Claude Code |
| `codex` | Codex |

Third-party Agents pick their own slug; TokenBoss titlecases it for
display (e.g. `my-bot` → "My Bot").

## Fallback: User-Agent sniffing

If no `X-Source` header is present, TokenBoss falls back to scanning
the `User-Agent` header:

| UA pattern | → slug |
|---|---|
| `/openclaw/i` | `openclaw` |
| `/hermes/i` | `hermes` |
| `/claude.?code/i` | `claude-code` |
| `/codex/i` | `codex` |

This is best-effort — explicit `X-Source` is **strongly recommended**
for accurate attribution.

## Last fallback: 'other'

Calls with neither matching `X-Source` nor recognized UA appear in the
dashboard as "Other". This is expected for hand-`curl`'d requests,
unknown integrations, etc.

## Privacy

`X-Source` values are stored on TokenBoss-side for 30 days, then
purged. No PII; just the agent slug.
