import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Supabase session sign-out with optional GLOBAL revocation (audit finding #7: a
// stolen JWT is otherwise valid until it expires).
//
//   POST /api/auth/signout            → local sign-out (this device/session)
//   POST /api/auth/signout {scope:'global'} → revoke ALL of the user's sessions
//
// 'global' calls supabase.auth.signOut({ scope: 'global' }), which revokes every
// refresh token server-side, so other devices can no longer refresh — the kill
// switch for a compromised credential. The access token already issued elsewhere
// stays valid only until its short TTL (~1h) lapses; refresh is dead immediately.
//
// This is the REAL (Supabase) session. The legacy /api/auth/logout endpoint clears
// the retired better-sqlite3 `hermes-session` cookie and is independent of this.
//
// Cookie hygiene: createServerClient (@supabase/ssr) writes the auth cookies through
// the Next cookie store with httpOnly + secure + sameSite by default; signOut()
// removes them via the same store, so the response carries the cleared cookies.

type Scope = 'global' | 'local' | 'others';

export async function POST(request: Request) {
  let scope: Scope = 'local';
  try {
    const body = (await request.json()) as { scope?: Scope } | null;
    if (body?.scope === 'global' || body?.scope === 'others') scope = body.scope;
  } catch {
    // No/invalid body → default 'local'. Sign-out must never fail on a bad payload.
  }

  const supabase = await createClient();
  // getUser() revalidates the session before we act on it; harmless if already gone.
  await supabase.auth.getUser();

  const { error } = await supabase.auth.signOut({ scope });

  const response = NextResponse.json(
    { ok: !error, scope, ...(error ? { error: error.message } : {}) },
    { status: error ? 500 : 200 },
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
