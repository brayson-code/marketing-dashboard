import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Sets the current user's password, SERVER-SIDE. Used by the invite → set-password
// flow: after /auth/confirm verifies the recovery token and sets the session cookie,
// the set-password page POSTs here. Because the caller holds a recovery session, this
// sets a FIRST password without a current one — even with "Secure password change" on.
export async function POST(request: Request) {
  let body: { password?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Your link has expired — ask for a fresh invite.' }, { status: 401 });
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return NextResponse.json({ error: error.message || 'Could not set password' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
