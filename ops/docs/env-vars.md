# Observability env vars (OBSERVABILITY-A)

All of the following are **optional**. Every one of them is **DSN-/token-gated to a
complete no-op when unset** — the build passes and the app runs identically with
none of them present. Nothing here is required for local dev.

## Sentry

| Var | Where | Effect when SET | Effect when UNSET |
|---|---|---|---|
| `SENTRY_DSN` | server + edge (`instrumentation.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`) | Initializes server/edge Sentry; forwards `onRequestError` to Sentry; wraps `next.config.ts` with `withSentryConfig` | **No-op.** No init, no Sentry build step, no network calls. |
| `NEXT_PUBLIC_SENTRY_DSN` | browser (`instrumentation-client.ts`) | Initializes browser Sentry + router-transition tracing | **No-op.** No client Sentry bundle behavior. |
| `SENTRY_TRACES_SAMPLE_RATE` | server/edge | Tracing sample rate (default `0.1`) | Defaults to `0.1` (only matters if a DSN is set) |
| `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | browser | Client tracing sample rate (default `0.1`) | Defaults to `0.1` |
| `SENTRY_ORG` | build | Sentry org slug for source-map upload | Upload skipped |
| `SENTRY_PROJECT` | build | Sentry project slug for source-map upload | Upload skipped |
| `SENTRY_AUTH_TOKEN` | build | Enables source-map upload during build | **Source-map upload disabled** (`sourcemaps.disable` is set automatically) — build still succeeds |

Notes:
- The Sentry build plugin (`withSentryConfig`) only runs when `SENTRY_DSN` is set
  (ternary in `next.config.ts`). With no DSN, the `@sentry/cli` binary is never
  invoked, so the install-time "ignored build scripts: @sentry/cli" warning is
  irrelevant to a no-DSN build.
- Sentry is **additive** to the existing in-app KeyWatch error pipeline (`/issues`).
  KeyWatch capture always runs first and is unaffected by whether Sentry is on.
- `environment`/`release` are auto-derived from `VERCEL_ENV` / `VERCEL_GIT_COMMIT_SHA`.

## Uptime / health alerts

| Var | Effect |
|---|---|
| `CRON_SECRET` | Bearer secret the Vercel cron dispatcher sends; gates `/api/cron/uptime` (and the other cron-runner routes). Unset in prod ⇒ cron routes fail closed (503). |
| `KEYPLAYERS_OWNER_PHONE` | HQ owner's cell — the uptime check texts it (via LoopMessage) on a newly-detected outage. Unset ⇒ no iMessage alert (no-op). |
| `SLACK_WEBHOOK_URL` | Incoming-webhook URL — uptime check posts outage/recovery here. Unset ⇒ no Slack alert (no-op). |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token. Drives the `blob` liveness field in `/api/health` and the uptime check. Unset ⇒ blob reports `unconfigured` (not a failure). |

See `ops/docs/uptime-monitoring.md` for the monitoring layers and the
hourly-cron cadence limitation.
