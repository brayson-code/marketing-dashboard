// Sentry — edge runtime init (middleware + edge route handlers).
//
// DSN-GATED: identical no-op-without-DSN contract as sentry.server.config.ts.
// Dynamically imported from instrumentation.ts register() only on the edge runtime.
import * as Sentry from '@sentry/nextjs';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA,
  });
}
