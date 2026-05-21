# Handoff: Spin up Hermes / Marketing Dashboard locally

## Mission
Get this Next.js 16 / React 19 / TypeScript / SQLite dashboard running on `localhost:3000` on this machine. Then stop and wait for me. We'll rebrand and restructure it in a follow-up session.

## Context
- Repo: `builderz-labs/marketing-dashboard` (open-source, MIT, Hermes Dashboard)
- It's a marketing ops control center for AI agent teams
- I want to rebrand it into a multi-tenant executive command center for my agency clients — but **not yet**. Just get it running first.
- I'm on this machine right now and want to click around at `localhost:3000` ASAP.

## Tasks (do these in order, stop on first failure and ask me)

1. **Check prereqs.** Verify these are installed and on PATH:
   - `git --version`
   - `node --version` (must be ≥ 20)
   - `pnpm --version`
   
   If any are missing, install them via the system's package manager (Homebrew on macOS, winget/choco on Windows, apt on Linux). Ask before installing if anything looks off.

2. **Verify clone.** We should already be inside the `marketing-dashboard` repo. Run `pwd` and `ls` to confirm. If not, clone from `https://github.com/builderz-labs/marketing-dashboard.git`.

3. **Install deps.** Run `pnpm install`. Expect 1–3 minutes.

4. **Configure env.** Copy `.env.example` to `.env.local`. Fill in at minimum:
   - `AUTH_USER=admin`
   - `AUTH_PASS=` — generate a 16-char password and put it here. Tell me what you set.
   - `API_KEY=` — generate with `openssl rand -hex 32`
   - `AUTH_COOKIE_SECURE=false` (localhost is HTTP)
   
   Leave OpenClaw, 1Password, OAuth, and connector vars at defaults / empty. Don't try to wire those up — we'll handle them later.

5. **Bootstrap (if exists).** Try `pnpm env:bootstrap`. If the script doesn't exist, skip silently — don't error out.

6. **Boot.** Run `pnpm dev`. Confirm it's serving on `http://localhost:3000`. Tell me when it's up.

7. **Smoke test.** Try logging in with the creds you set. Report whether the dashboard home loads.

## Constraints and preferences

- **Do not** modify any source files yet. We rebrand in a separate session.
- **Do not** add new dependencies.
- **Do not** wire up OpenClaw, OAuth, Plausible, GA4, or any external connectors.
- **Do not** push, commit, or create branches.
- If you hit any error, stop and quote the exact error message back to me. Don't try to fix things on your own beyond the obvious (wrong Node version, missing pnpm, port in use).
- If port 3000 is taken, use 3001 and tell me.

## What I'll ask for after it's running

1. Screenshot/description of what the home page looks like
2. List of every top-level route under `src/app/` (or wherever Next routes live)
3. A summary of the existing color tokens, typography, and the main layout component

Then we'll start Phase 1: rebrand shell.

## When in doubt

Ask me. Don't guess on credentials, don't install global tools without asking, don't refactor "while you're in there." Just get it up, log in once, and hand back.
