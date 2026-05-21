import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Returns the current Supabase-authenticated user. V1 single-tenant: the owner
// is treated as 'admin' (full access). Replace `role` with the user's
// tenant_members.role when multi-tenant RBAC lands. No better-sqlite3.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const response = NextResponse.json({
    user: { id: user.id, username: user.email, email: user.email, role: 'admin' },
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
