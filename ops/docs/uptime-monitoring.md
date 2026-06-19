# Uptime & health monitoring

This is an internal ops runbook. It describes the three layers of liveness
checking shipped in OBSERVABILITY-A and — importantly — the **cadence limitation**
of the Vercel-cron layer and the recommended external pinger.

## The three layers

| Layer | Endpoint / job | Auth | Cadence | Detects |
|---|---|---|---|---|
| 1. External pinger (RECOMMENDED, primary) | `GET /api/health/live` | none (public) | **1–5 min** | App + DB down |
| 2. Vercel cron net (secondary) | `/api/cron/uptime` → `runUptimeCheck()` | `CRON_SECRET` | **hourly only** | DB or Blob down, alerts HQ owner |
| 3. Authenticated nav health card | `GET /api/health` | session | on nav poll (~30s, only while a user is online) | agent/cron/integration health + DB + Blob |

### Layer 1 — `/api/health/live` (the real fast path)

- **Unauthenticated** and **tenant-free** by design (allow-listed in `src/proxy.ts`).
  It returns ONLY booleans + a timestamp — no tenant row, count, or name ever.
- Contract:
  - `200 { ok: true,  db: 'ok',   ts }` — app + database up
  - `503 { ok: false, db: 'down', ts }` — database unreachable
- This is the endpoint an **external monitor should hit every 1 minute**.

### Layer 2 — `/api/cron/uptime` (the in-house net)

- Runs `runUptimeCheck()` (`src/lib/uptime.ts`): probes DB + Blob, and on a
  **newly-detected** failure alerts the HQ owner over the existing channels
  (iMessage via LoopMessage `getOwnerPhone()` + Slack webhook). Edge-triggered
  de-dup means a sustained outage alerts once, not every tick; recovery sends an
  all-clear and re-arms.
- Returns `200` with the verdict in the body even when unhealthy (the cron itself
  succeeded — only a thrown error returns `500`).

## ⚠️ Cadence limitation — read this

**Vercel Cron on this project effectively runs HOURLY at finest.** Sub-hour
schedules round up to the top of the hour (this is the documented behavior of our
cron-board dispatcher; see the `cron-board-live` memory). The uptime cron is
registered in `vercel.json` as `"0 * * * *"` (hourly).

Consequences:

- **Layer 2 alone can take up to ~1 hour to notice an outage.** That is far too
  slow to be the only monitor.
- An in-process `setInterval` (the kind `instrumentation.ts` uses for the
  proactive/compactor schedulers) does **not** reliably tick on serverless: each
  function instance is short-lived and frozen between requests, so a minute-timer
  there fires only while that instance happens to be warm. It is fine for
  single-instance local dev, useless as a production minute-monitor. (Same caveat
  documented in the `self-improving-ecosystem` memory.)

## ✅ Recommendation

**Wire an external pinger against `/api/health/live` at 1-minute granularity.**
Options, any one is fine:

- **Better Uptime / Better Stack** — HTTP monitor, expect `200`, 1-min interval.
- **UptimeRobot** — free tier does 5-min; paid does 1-min. Keyword monitor on
  `"ok":true` or status-code monitor on `200`.
- **Vercel's own monitoring / Checks** — point at `/api/health/live`.

Keep the hourly Layer-2 cron as a belt-and-suspenders net so that even with no
external monitor configured, a sustained outage still produces an owner alert
within the hour.

### Enable / disable

- **Layer 1** is always on (no env required); it just needs an external monitor
  pointed at it.
- **Layer 2** is registered in `vercel.json` and gated by `CRON_SECRET` (set in
  Vercel). To disable, remove the `/api/cron/uptime` entry from `vercel.json`.
- Alerts require `KEYPLAYERS_OWNER_PHONE` (+ LoopMessage connected) and/or
  `SLACK_WEBHOOK_URL`. With neither set, the check still runs and logs, but sends
  nothing (no-op — never errors).
