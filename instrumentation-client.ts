// Sentry — browser/client init (Next 16 instrumentation-client entrypoint).
//
// DSN-GATED on the PUBLIC DSN (NEXT_PUBLIC_SENTRY_DSN) because this runs in the
// browser bundle: the server-only SENTRY_DSN is not available client-side. When
// the public DSN is unset this file is a complete no-op — Sentry.init() never
// runs, so the browser ships no Sentry transport and no behavior changes.
//
// NOTE: this is separate from KeyWatch's own client error capture (the in-app
// /issues pipeline). Sentry is an additive, opt-in second sink; KeyWatch keeps
// working regardless of whether the Sentry DSN is set.
import * as Sentry from '@sentry/nextjs';

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development',
  });
}

// Next 16 navigation instrumentation. Sentry.captureRouterTransitionStart is a
// no-op when Sentry was never initialized (DSN unset), so exporting it
// unconditionally is safe.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
