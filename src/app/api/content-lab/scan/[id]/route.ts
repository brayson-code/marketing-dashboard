import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { getScan } from '@/lib/reel-scans';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/content-lab/scan/[id] — one scan's status + scores + report. The UI
// polls this while status is 'scanning' to fill the report in live.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  enterTenant(await resolveTenant());
  const { id } = await params;
  try {
    const scan = await getScan(Number(id));
    if (!scan) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ scan });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
