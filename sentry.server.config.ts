// Sentry — server runtime (Node.js) init.
//
// DSN-GATED: Sentry.init() only runs when SENTRY_DSN is set. With the DSN absent
// (local dev, CI without secrets, any env that hasn't opted in) this file is a
// complete no-op — it imports the SDK but never initializes it, so no transport,
// no network calls, and no behavior change. Dynamically imported from
// instrumentation.ts register() only on the nodejs runtime.
import * as Sentry from '@sentry/nextjs';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    // Tracing is sampled (default 10%); override per env. 0 disables tracing but
    // still captures errors.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA,
  });
}
