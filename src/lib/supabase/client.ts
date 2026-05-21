// Browser-side Supabase client for use inside client components.
// Reads the public URL + anon key from NEXT_PUBLIC_* env vars.

import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
