import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';
import { listReelScripts } from '@/lib/drafts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/scripts — reel scripts (Hyperframes drafts) for the Script Studio.
export async function GET() {
  try {
    enterTenant(await resolveTenant());
    const scripts = await listReelScripts(60);
    return NextResponse.json({ scripts });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
