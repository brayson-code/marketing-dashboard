import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

// TODO(supabase-migration): the seed_registry table does not exist in Supabase.
// The seed concept is a no-op now — nothing is tracked as seeded demo data — so
// this endpoint always reports no seed data.
export async function GET(request: Request) {
  const auth = requireApiUser(request as Request);
  if (auth) return auth;

  return NextResponse.json({
    has_seed_data: false,
    seed_count: 0,
    breakdown: [],
  });
}
