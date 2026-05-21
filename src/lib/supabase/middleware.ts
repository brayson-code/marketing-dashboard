// Session-refresh helper for Next.js middleware, following the official
// @supabase/ssr App Router guide. `updateSession` creates a server client
// bound to the incoming request cookies, refreshes the auth token, and copies
// the updated cookies onto the outgoing response.
//
// This file deliberately imports ONLY @supabase/ssr + next/server so the
// middleware bundle never pulls in better-sqlite3 or any old auth code.

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: Do NOT run code between createServerClient and getUser().
  // getUser() revalidates the token and refreshes the session.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabaseResponse, user };
}
