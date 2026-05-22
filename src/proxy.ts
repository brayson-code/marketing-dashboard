import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

function isHostAllowedByLock(hostName: string): boolean {
  const mode = (process.env.HERMES_HOST_LOCK || 'local').trim().toLowerCase();
  if (mode === 'off' || mode === 'disabled' || mode === 'false' || mode === '0') {
    return true;
  }

  if (mode === 'local') {
    const isLocalhost = hostName === 'localhost' || hostName === '127.0.0.1';
    const isTailscale = hostName.startsWith('100.') || hostName.endsWith('.ts.net');
    return isLocalhost || isTailscale;
  }

  // allowlist mode (comma-separated hostnames)
  const allowed = mode
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return false;
  return allowed.includes(hostName.toLowerCase());
}

// The Vercel Cron *runner* endpoints. These are hit by Vercel's cron pinger
// (Authorization: Bearer CRON_SECRET), not a browser, so they can't carry a
// Supabase session cookie — they must bypass the auth gate and self-protect
// with verifyCron(). NOTE: the cron *management* routes (/api/cron,
// /api/cron/jobs, /api/cron/runs, /api/cron/templates) are deliberately NOT
// here — those are called by the logged-in owner's browser and must require
// auth, or anyone could create jobs / trigger token-spending agent runs.
const CRON_RUNNER_PATHS = new Set([
  '/api/cron/dispatch',
  '/api/cron/proactive',
  '/api/cron/improve',
  '/api/cron/compact',
  '/api/cron/triage',
]);

// Paths that never require an authenticated Supabase user.
function isPublicPath(pathname: string): boolean {
  if (pathname === '/login') return true;
  if (pathname.startsWith('/auth/')) return true; // Supabase OAuth/callback routes
  if (pathname.startsWith('/api/webhook/')) return true; // auth enforced in-handler
  if (CRON_RUNNER_PATHS.has(pathname)) return true; // CRON_SECRET enforced in-handler
  if (pathname === '/api/errors') return true; // client error reporting (may fire pre-login)
  return false;
}

export async function proxy(request: NextRequest) {
  const host = request.headers.get('host') || '';
  const hostName = host.split(':')[0];
  if (!isHostAllowedByLock(hostName)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  // Refresh the Supabase session and read the current user. `supabaseResponse`
  // carries any refreshed auth cookies and must be the response we return on
  // the happy path.
  const { supabaseResponse, user } = await updateSession(request);

  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return supabaseResponse;
  }

  if (user) {
    return supabaseResponse;
  }

  // No authenticated user. API routes get a 401; everything else redirects to
  // the login page (preserving the original path so we can return after login).
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.searchParams.set('from', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Match everything except static assets and image optimizer files.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
