/**
 * Next.js instrumentation hook — runs once at server boot.
 * Schedules KeyPlayer's background work:
 *  - proactive sweep (stalled goals, pending drafts, long tasks → owner ping)
 *  - memory compaction (roll up chat history → memory.md)
 *
 * Both are opt-in via env vars. Manual `/api/triggers/*` endpoints work either way.
 */
// KeyWatch server-side capture: Next.js calls this for any error thrown in a
// Server Component, route handler, or middleware. We feed it into the same
// dedupe/alert pipeline as client errors.
//
// Sentry is wired in ADDITIVELY here (DSN-gated): when SENTRY_DSN is set we ALSO
// forward the error to Sentry via captureRequestError. KeyWatch capture always
// runs first and is unaffected; with no DSN the Sentry branch is a complete no-op.
export async function onRequestError(
  error: unknown,
  request: { path?: string; method?: string; headers?: Record<string, string | string[] | undefined> },
  context: { routerKind?: string; routePath?: string; renderSource?: string },
) {
  try {
    const { captureError } = await import('./src/lib/observability');
    const err = error as Error & { digest?: string };
    const ua = request.headers?.['user-agent'];
    await captureError({
      source: process.env.NEXT_RUNTIME === 'edge' ? 'edge' : 'server',
      level: 'error',
      message: err?.message || String(error),
      stack: err?.stack ?? null,
      route: context?.routePath || request.path || null,
      method: request.method ?? null,
      userAgent: Array.isArray(ua) ? ua[0] : ua ?? null,
      release: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      context: { digest: err?.digest ?? null, renderSource: context?.renderSource, routerKind: context?.routerKind },
    });
  } catch (e) {
    console.error('[keywatch] onRequestError capture failed:', (e as Error).message);
  }

  // Additive Sentry forward — only when a DSN is configured. Sentry's own
  // captureRequestError expects the same (error, request, context) triple Next
  // passes us, so we hand them through verbatim. Guarded so absent-DSN is a no-op
  // and a Sentry failure never masks the KeyWatch capture above.
  if (process.env.SENTRY_DSN) {
    try {
      const Sentry = await import('@sentry/nextjs');
      // Next's onRequestError request/context types are slightly looser than
      // Sentry's RequestInfo/ErrorContext; the runtime shapes are compatible, so
      // we forward via the typed signature with a narrow cast.
      const capture = Sentry.captureRequestError as
        | ((e: unknown, r: typeof request, c: typeof context) => unknown)
        | undefined;
      await capture?.(error, request, context);
    } catch (e) {
      console.error('[sentry] captureRequestError failed:', (e as Error).message);
    }
  }
}

export async function register() {
  // Sentry init — DSN-gated, runtime-split (nodejs vs edge). Loaded BEFORE the
  // nodejs-only early-return below so the edge runtime gets its Sentry init too.
  // With SENTRY_DSN unset, both config modules are no-ops (their Sentry.init is
  // itself DSN-guarded), so this whole block costs nothing.
  if (process.env.SENTRY_DSN) {
    if (process.env.NEXT_RUNTIME === 'edge') {
      await import('./sentry.edge.config');
    } else {
      // nodejs runtime — OR NEXT_RUNTIME unset, which Vercel's Node functions can be
      // at register() time. Gating strictly on === 'nodejs' left the server SDK
      // uninitialized (getClient() === undefined) whenever the var was absent, so
      // captured events minted an id but never shipped. Default to the server init.
      await import('./sentry.server.config');
    }
  }

  // The KeyPlayers background schedulers only run on the nodejs runtime.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  schedule({
    label: 'proactive',
    envVar: 'KEYPLAYERS_PROACTIVE_INTERVAL_MIN',
    minIntervalMin: 5,
    run: async () => {
      const { runProactiveSweep } = await import('./src/lib/proactive');
      const r = await runProactiveSweep();
      if (r.invoked) {
        console.log(`[proactive] swept ${r.signals.length} signal(s) — ${r.text ? 'pinged owner' : '(no-op)'}`);
      }
    },
  });

  schedule({
    label: 'memory-compactor',
    envVar: 'KEYPLAYERS_COMPACTOR_INTERVAL_MIN',
    minIntervalMin: 15,
    run: async () => {
      const { spawnSubAgent } = await import('./src/lib/subagent');
      const r = await spawnSubAgent(
        'memory-compactor',
        'Compact the recent boardroom + task activity into a structured rollup using your output schema.',
      );
      if (r.ok) {
        console.log(`[compactor] rollup written (${r.usage?.output ?? '?'} tokens out)`);
      } else {
        console.error('[compactor] failed:', r.error);
      }
    },
  });
}

function schedule(opts: {
  label: string;
  envVar: string;
  minIntervalMin: number;
  run: () => Promise<void>;
}) {
  const minutes = Number(process.env[opts.envVar] ?? 0);
  if (!minutes || minutes < opts.minIntervalMin) {
    console.log(
      `[instrumentation] ${opts.label} scheduler disabled (set ${opts.envVar} >=${opts.minIntervalMin} to enable)`,
    );
    return;
  }
  console.log(`[instrumentation] ${opts.label} scheduler ON — every ${minutes} min`);

  const tick = async () => {
    try {
      await opts.run();
    } catch (err) {
      console.error(`[${opts.label}] tick error:`, (err as Error).message);
    }
  };

  // Stagger first tick by 60s so dev boot is clean.
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), minutes * 60 * 1000);
  }, 60_000);
}
