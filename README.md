# TokenBoss

AI API proxy with email-code auth, credit bucket billing, and Agent skill integration.

## v1.0 overview

- **Auth**: passwordless email-code (OTP). No passwords stored.
- **Billing**: credit bucket model — plan buckets (daily cap + 28-day expiry) or topup buckets (depleting balance, no expiry). SKUs: `plan_plus`, `plan_super`, `plan_ultra`, `topup`.
- **Agent support**: `tokenboss.co/skill.md` — one-line install for Claude Code / Codex / other Agent users.
- **Stack**: Hono + Cloudflare Workers (backend) · Vite + React 18 (frontend) · SQLite via D1.

## Sub-projects

| Directory | Purpose | Stack |
|---|---|---|
| [`backend/`](./backend) | Auth, billing, proxy | Hono, Cloudflare Workers, SQLite/D1 |
| [`frontend/`](./frontend) | User dashboard + Admin panel | Vite, React 18, TypeScript, Tailwind CSS |
| [`ClawRouter/`](./ClawRouter) | Local proxy / smart routing | TypeScript, Node 20, tsup |

## Local dev

```bash
cd backend && npm install && npm run dev      # backend on :8787
cd frontend && npm install && npm run dev     # frontend on :5173
```

## Email config

```bash
EMAIL_PROVIDER=console            # default; logs OTP codes to stdout
EMAIL_PROVIDER=resend RESEND_API_KEY=re_...   # production
```

## SQL grant for internal beta

Issue credits directly to a user (requires `sqlite3` CLI):

```bash
backend/scripts/grant-bucket.sh user@example.com plan_super
backend/scripts/grant-bucket.sh user@example.com topup 100
```

Available SKUs: `plan_plus` ($30/day · 28d), `plan_super` ($80/day · 28d), `plan_ultra` ($720/day · 28d), `topup <amount>`.

Override DB path: `SQLITE_PATH=/path/to/tokenboss.db ./grant-bucket.sh ...`

## Agent skill install

For Claude Code / Codex users — add TokenBoss as an Agent skill:

```
set up tokenboss.co/skill.md
```

## Tests

```bash
cd backend && npm test    # 50 tests
cd frontend && npm test   # 9 tests
```
