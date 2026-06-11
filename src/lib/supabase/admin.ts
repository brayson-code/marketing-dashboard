import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Service-role Supabase client for privileged, SERVER-ONLY operations: admin auth
// (create users, stamp app_metadata, generate links). The service-role key bypasses
// RLS, so this must NEVER be imported into a client component or exposed to the
// browser. Lazily constructed so importing the module can't crash the build when
// the key is absent (e.g. during `next build`).
let _admin: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase admin not configured — set SUPABASE_SERVICE_ROLE_KEY (and NEXT_PUBLIC_SUPABASE_URL).',
    );
  }
  _admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _admin;
}

/** Find an existing auth user by email (admin API has no direct lookup). */
export async function findUserByEmail(email: string): Promise<{ id: string; app_metadata: Record<string, unknown> } | null> {
  const admin = supabaseAdmin();
  const target = email.trim().toLowerCase();
  // Page through users (small user base; invite-only). 1000/page is the max.
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((u) => (u.email ?? '').toLowerCase() === target);
    if (found) return { id: found.id, app_metadata: (found.app_metadata ?? {}) as Record<string, unknown> };
    if (data.users.length < 1000) break;
  }
  return null;
}
