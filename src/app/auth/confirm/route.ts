import { type EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Verifies an email link (recovery / invite / magiclink) SERVER-SIDE from its
// token_hash and sets the session cookie, then redirects to `next`. This is the
// robust @supabase/ssr pattern: it does NOT depend on client-side fragment parsing
// or the PKCE code-verifier (which admin-generated invite links don't carry), nor on
// the Supabase Site-URL / redirect allow-list. The invite link points here:
//   /auth/confirm?token_hash=<hash>&type=recovery&next=/auth/set-password
export async function GET(request: NextRequest) {
  const token_hash = request.nextUrl.searchParams.get('token_hash');
  const type = request.nextUrl.searchParams.get('type') as EmailOtpType | null;
  const nextParam = request.nextUrl.searchParams.get('next') || '/';

  // Build the redirect on the same (public) origin, stripping the token params.
  const redirectTo = request.nextUrl.clone();
  redirectTo.searchParams.delete('token_hash');
  redirectTo.searchParams.delete('type');
  redirectTo.searchParams.delete('next');

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      redirectTo.pathname = nextParam.startsWith('/') ? nextParam : '/';
      return NextResponse.redirect(redirectTo);
    }
    redirectTo.pathname = '/login';
    redirectTo.searchParams.set('error', error.message);
    return NextResponse.redirect(redirectTo);
  }

  redirectTo.pathname = '/login';
  redirectTo.searchParams.set('error', 'Invalid or expired link');
  return NextResponse.redirect(redirectTo);
}
