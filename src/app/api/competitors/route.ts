import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { listCompetitors, addCompetitor, listReels } from '@/lib/competitors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/competitors — the watchlist + the tenant's recent reels (limit ~40).
export async function GET() {
  enterTenant(await resolveTenant());
  try {
    const [competitors, reels] = await Promise.all([
      listCompetitors(),
      listReels({ limit: 40 }),
    ]);
    return NextResponse.json({ competitors, reels });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// POST /api/competitors — add (or re-adopt) a watched competitor handle.
export async function POST(request: Request) {
  enterTenant(await resolveTenant());
  let body: { handle?: string; platform?: string; display_name?: string; schedule?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  try {
    const handle = typeof body.handle === 'string' ? body.handle.trim() : '';
    if (!handle) return NextResponse.json({ error: 'handle required' }, { status: 400 });
    const competitor = await addCompetitor({
      handle,
      platform: body.platform,
      display_name: body.display_name,
      schedule: body.schedule,
    });
    return NextResponse.json({ competitor });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
