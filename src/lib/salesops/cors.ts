// SalesOps CORS — the /api/salesops/* routes are called by the Chrome extension's
// service worker / offscreen document and by content scripts injected into
// meet.google.com / zoom.us / teams.microsoft.com / webex.com. The CALLER ORIGIN is
// therefore chrome-extension://… or one of those third-party pages — never our own
// domain — so origin-based auth is meaningless here. The PER-TENANT BEARER TOKEN
// (resolveSalesopsToken) is the auth; CORS is intentionally permissive (reflect the
// request Origin, or '*' when none). This mirrors the in-handler-authed posture of the
// webhook routes: the secret is the gate, not the origin.

/** Permissive CORS headers for a SalesOps (extension-facing) response. */
export function salesOpsCors(req: Request): Headers {
  const origin = req.headers.get('origin');
  const headers = new Headers();
  // Reflect the caller's Origin when present (so credentialed-ish fetches work from the
  // extension / call pages); fall back to '*' for origin-less callers.
  headers.set('Access-Control-Allow-Origin', origin || '*');
  headers.set('Vary', 'Origin');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  headers.set('Access-Control-Max-Age', '86400');
  return headers;
}

/** Standard preflight response for an OPTIONS request to a SalesOps route. */
export function preflight(req: Request): Response {
  return new Response(null, { status: 204, headers: salesOpsCors(req) });
}
