import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Cloud deployment is single-tenant: one logical instance. (The legacy
// multi-instance OpenClaw filesystem model doesn't apply here.) Auth is enforced
// by the Supabase middleware.
export async function GET() {
  return NextResponse.json({
    default_instance: 'default',
    instances: [{ id: 'default', label: 'KeyPlayers' }],
  });
}
