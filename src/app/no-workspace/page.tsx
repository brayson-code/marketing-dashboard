'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// Landing for an AUTHENTICATED user who has no assigned workspace (no JWT tenant
// claim). The middleware sends them here and 403s their API calls, so they can
// never see another tenant's (e.g. HQ's) data. Invite-only: an admin provisions
// their workspace, after which they sign in again and resolve into it.
export default function NoWorkspacePage() {
  const router = useRouter();

  async function signOut() {
    try { await createClient().auth.signOut(); } catch { /* ignore */ }
    router.replace('/login');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--background)] p-6">
      <div className="w-full max-w-md p-8 rounded-xl border border-[var(--border)] bg-[var(--card)] text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-xl bg-primary text-primary-foreground flex items-center justify-center text-lg font-semibold">K</div>
        <h1 className="text-h1 text-[var(--foreground)]">No workspace yet</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Your account isn&rsquo;t assigned to a workspace. Ask your administrator to invite you, then sign in again to pick up your access.
        </p>
        <button onClick={signOut} className="btn btn-ghost btn-sm">Sign out</button>
      </div>
    </div>
  );
}
