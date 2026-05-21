// Browser-side helper to ship an error to KeyWatch (/api/errors). Used by the
// global window hooks and the React error boundaries. Best-effort: swallows its
// own failures and dedupes a burst of identical errors client-side so a render
// loop can't flood the sink.

const recent = new Map<string, number>();
const DEDUPE_MS = 10_000;

export interface ClientErrorReport {
  message: string;
  stack?: string | null;
  componentStack?: string | null;
  level?: 'error' | 'warning' | 'fatal';
  context?: Record<string, unknown>;
}

export function reportClientError(report: ClientErrorReport): void {
  if (typeof window === 'undefined' || !report.message) return;

  const key = `${report.message}|${(report.stack ?? '').slice(0, 120)}`;
  const now = Date.now();
  const last = recent.get(key) ?? 0;
  if (now - last < DEDUPE_MS) return;
  recent.set(key, now);

  const payload = JSON.stringify({
    ...report,
    url: window.location.href,
    route: window.location.pathname,
    release: process.env.NEXT_PUBLIC_RELEASE,
  });

  try {
    // keepalive lets the request survive a navigation / page unload.
    fetch('/api/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* never throw from the reporter */
  }
}
