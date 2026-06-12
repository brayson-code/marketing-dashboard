import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sql } from '@/lib/db/client';
import { NO_TENANT_ID } from '@/lib/tenant';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// OAuth (PKCE) callback — Supabase redirects here after Google with ?code=.
// We exchange the code for a session SERVER-SIDE (the @supabase/ssr pattern:
// the browser client stored the PKCE code-verifier in a cookie, so the server
// client can complete the exchange and set the session cookies), then send the
// user on to `next`.
//
// NOTE: like /auth/confirm, this route deliberately does NOT call
// enterTenant(resolveTenant()) — it runs BEFORE a session/tenant exists.
//
// Invite-only gate: this platform has no self-serve signup. A brand-new Google
// user authenticates fine at Google/Supabase but has no workspace_members row
// and no app_metadata.tenant_id claim, so every tenant surface would fail
// closed on them. Rather than strand them on an empty shell, we sign them out
// and bounce to /login with a clear "ask your admin for an invite" message.

/** Sanitize ?next= to a same-origin relative path (never an open redirect). */
function resolveNext(request: NextRequest): URL {
  const fallback = request.nextUrl.clone();
  fallback.pathname = '/';
  fallback.search = '';

  const raw = request.nextUrl.searchParams.get('next');
  // Must be a relative path with exactly one leading slash — '//evil.com' and
  // '/\evil.com' are protocol-relative open redirects browsers will follow.
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  try {
    const url = new URL(raw, request.nextUrl.origin);
    if (url.origin !== request.nextUrl.origin) return fallback;
    return url;
  } catch {
    return fallback;
  }
}

function loginWithError(request: NextRequest, message: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  url.searchParams.set('error', message);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');

  // Provider bounced back with an error (user denied consent, misconfig, …).
  if (!code) {
    const providerError =
      request.nextUrl.searchParams.get('error_description') ||
      request.nextUrl.searchParams.get('error');
    return loginWithError(request, providerError || 'Sign-in was cancelled or the link is invalid');
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data?.user) {
    return loginWithError(request, error?.message || 'Could not complete sign-in');
  }

  // Invite-only gate (see header). The JWT tenant claim is the fast path; a
  // freshly-invited user whose claim hasn't been minted yet still passes via
  // their workspace_members row — same order resolveTenant() uses.
  const user = data.user;
  // The nil-uuid sentinel marks a half-finished provisioning attempt, not a
  // real workspace — treat it the same as no claim (the membership-row check
  // below decides).
  const claim = (user.app_metadata as Record<string, unknown> | undefined)?.tenant_id;
  let hasWorkspace = typeof claim === 'string' && claim.length > 0 && claim !== NO_TENANT_ID;
  if (!hasWorkspace) {
    try {
      const rows = (await sql()`
        SELECT workspace_id FROM public.workspace_members
        WHERE user_id = ${user.id}
        LIMIT 1
      `) as unknown as Array<{ workspace_id: string }>;
      hasWorkspace = rows.length > 0;
    } catch {
      hasWorkspace = false; // fail closed — never assume a workspace
    }
  }
  if (!hasWorkspace) {
    // Sign out so they aren't stuck half-authenticated on the no-workspace wall.
    try {
      await supabase.auth.signOut();
    } catch {
      /* best-effort — the bounce below still keeps them out of tenant data */
    }
    return loginWithError(request, 'No workspace yet — ask your admin for an invite');
  }

  return NextResponse.redirect(resolveNext(request));
}
