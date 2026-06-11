import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';
import { getSquad } from '@/lib/squad';
import { tenantId } from '@/lib/db/client';
import { memo } from '@/lib/cache';

export const dynamic = 'force-dynamic';

// The real agent roster + live stats. Auth enforced by the Supabase middleware.
export async function GET() {
  enterTenant(await resolveTenant());
  try {
    const agents = await memo(`squad:${tenantId()}`, 15000, () => getSquad());
    return NextResponse.json({ agents });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, agents: [] }, { status: 500 });
  }
}
