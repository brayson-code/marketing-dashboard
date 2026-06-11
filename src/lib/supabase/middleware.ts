// Session-refresh helper for Next.js middleware, following the official
// @supabase/ssr App Router guide. `updateSession` creates a server client
// bound to the incoming request cookies, refreshes the auth token, reads the
// authenticated user, and copies the updated cookies onto the outgoing response.
//
// It also resolves the request's TENANT here — once — from the validated user's
// JWT app_metadata, and forwards it to the route handler as request headers
// (x-tenant-id / x-user-id). The handler's resolveTenant() reads those headers
// (no extra Auth round-trip). Any client-supplied x-tenant-id/x-user-id headers
// are stripped first so they cannot be spoofed.
//
// This file deliberately imports ONLY @supabase/ssr + next/server so the
// middleware bundle never pulls in better-sqlite3 or any old auth code.

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

type PendingCookie = { name: string; value: string; options: Record<string, unknown> };

export async function updateSession(request: NextRequest) {
  // Buffer any cookies Supabase wants to set during token refresh; we apply them
  // to the final response after we've also folded in the tenant headers.
  const pending: PendingCookie[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            pending.push({ name, value, options: (options ?? {}) as Record<string, unknown> });
          });
        },
      },
    },
  );

  // IMPORTANT: Do NOT run code between createServerClient and getUser().
  // getUser() revalidates the token (and returns the user's live app_metadata).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Forward the resolved tenant to the handler via request headers. Strip any
  // inbound x-tenant-id/x-user-id first — only values we derive from the
  // validated user are trustworthy.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete('x-tenant-id');
  requestHeaders.delete('x-user-id');
  if (user) {
    requestHeaders.set('x-user-id', user.id);
    const claim = (user.app_metadata as Record<string, unknown> | undefined)?.tenant_id;
    if (typeof claim === 'string' && claim) requestHeaders.set('x-tenant-id', claim);
  }

  // Nonce-based CSP. Set the nonce + CSP on the REQUEST headers so Next.js stamps the
  // nonce onto the scripts it renders, then mirror the CSP onto the response so the
  // browser enforces it. script-src is strict (nonce + 'strict-dynamic', NO
  // 'unsafe-inline') — the real XSS hardening; the rest stays permissive enough not to
  // break Supabase, reel embeds, or the app's many inline style={{}} attributes
  // (style-src keeps 'unsafe-inline' since nonces can't cover style attributes).
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });
  supabaseResponse.headers.set('content-security-policy', csp);
  pending.forEach(({ name, value, options }) =>
    supabaseResponse.cookies.set(name, value, options),
  );

  return { supabaseResponse, user };
}

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    "frame-src 'self' https:",
    "media-src 'self' blob: https:",
  ].join('; ');
}
