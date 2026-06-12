# Load-test scripts

> **WARNING: Run these scripts against a preview deploy or `localhost` ONLY.**
> Never target the production URL (the live Vercel prod alias). A 100-VU k6 run
> against prod WILL spike the Supabase connection pooler and may take the site
> down for real tenants (a prod outage already happened once from rapid deploys —
> the same logic applies to connection floods).

---

## Credit-safety guarantees

These scripts can never trigger Claude API spend because:

1. **No Anthropic key is ever written.** `seed-synthetic-tenants.ts` hard-codes a
   skip of any `client_integrations` insert. `getAnthropicKey()` (the app's
   load-bearing gate in `src/lib/anthropic-key.ts`) will return nothing for
   synthetic tenants and every agent call will abort before reaching the API.

2. **Crons are seeded disabled.** The `on_new_tenant_seed` trigger seeds C-suite
   crons with `enabled = false` and `next_run_at = NULL`. The seed script
   **asserts** this after seeding and throws if any enabled row exists.

3. **k6 hits read-only GET endpoints only.** No POST/PUT routes are exercised, so
   no agent tasks are spawned.

4. **Teardown removes everything.** After testing, run teardown to remove the
   synthetic tenants so they never accidentally become active.

---

## Environment variables

All scripts read these from `.env.local` (pass via `--env-file=.env.local`):

| Variable                    | Required for          | Description                                   |
|-----------------------------|----------------------|-----------------------------------------------|
| `NEXT_PUBLIC_SUPABASE_URL`  | seed + teardown       | Supabase project URL                          |
| `SUPABASE_SERVICE_ROLE_KEY` | seed + teardown       | Service-role key (admin, bypasses RLS)        |
| `BASE_URL`                  | k6 (env var, not .env)| App URL to load-test (default: localhost:3000)|
| `SESSION_COOKIE`            | k6 (env var, not .env)| Browser cookie for authenticated requests     |

---

## Run order

### Step 1 — Seed synthetic tenants

```bash
pnpm tsx --env-file=.env.local scripts/loadtest/seed-synthetic-tenants.ts \
  --confirm \
  --count 100 \
  --stamp 2026-06-12 \
  --kg-per-tenant 50 \
  --tasks-per-tenant 30 \
  --drafts-per-tenant 5
```

Wait for the summary. It will print:
```
  Tenants created  : 100
  Anthropic keys   : 0  (NONE written — no spend possible)
  Enabled crons    : 0  (assertion passed)
```

If the assertion fails the script throws. Do not continue until it passes.

---

### Step 2 — Get a session cookie

1. Open the target app URL in a browser (local or preview deploy).
2. Log in as a real test user (e.g. the HQ account).
3. Open DevTools → Application → Cookies → find the Supabase cookie
   (`sb-zgtiviorskkcuzxnpvha-auth-token`).
4. Copy the cookie **name=value** pair (the whole thing, including the name).

---

### Step 3 — Run k6

Make sure k6 is installed as a standalone binary (NOT via npm):
```bash
# macOS
brew install k6

# Windows
winget install k6 --source winget

# Linux — see https://k6.io/docs/get-started/installation/
```

Run against local dev:
```bash
BASE_URL=http://localhost:3000 \
SESSION_COOKIE="sb-zgtiviorskkcuzxnpvha-auth-token=<paste value here>" \
k6 run scripts/loadtest/hot-paths.k6.js
```

Run against a Vercel preview:
```bash
BASE_URL=https://marketing-dashboard-<hash>.vercel.app \
SESSION_COOKIE="sb-zgtiviorskkcuzxnpvha-auth-token=<paste value here>" \
k6 run scripts/loadtest/hot-paths.k6.js
```

---

### Step 4 — Read the p95 results

k6 will print a summary after the run. Look at:

| Metric              | Threshold | Meaning                                    |
|---------------------|-----------|--------------------------------------------|
| `http_req_duration` | p95 < 800ms | 95% of all requests complete under 800ms |
| `http_req_failed`   | rate < 1% | Less than 1% network errors / non-2xx     |
| `p95_squad`         | p95 < 800ms | `/api/squad` specifically                |
| `p95_kg`            | p95 < 800ms | `/api/kg` specifically                   |
| `p95_missions`      | p95 < 800ms | `/api/missions` specifically             |

A green `✓` means the threshold passed. A red `✗` means you have a slow path to
optimize before launch.

---

### Step 5 — Teardown synthetic tenants

First do a dry run to see what will be deleted:
```bash
pnpm tsx --env-file=.env.local scripts/loadtest/teardown-synthetic-tenants.ts
```

Then delete for real:
```bash
pnpm tsx --env-file=.env.local scripts/loadtest/teardown-synthetic-tenants.ts --confirm
```

The script prints a row count per table and refuses to touch the HQ tenant
(`fff35ccb-d1da-4fef-b8cb-e363fe1b8e14`) under any circumstances.

---

## Idempotency notes

- **Seed**: skips users whose email already exists. Safe to re-run with the same
  `--stamp` to top up after a partial run.
- **Teardown**: matches on `business_profile->>'synthetic' = 'true'` — any tenant
  without that marker is untouched, including real client tenants.
