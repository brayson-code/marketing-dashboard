import { NextRequest, NextResponse } from 'next/server';
import { listRuns } from '@/lib/cron-store';

export const dynamic = 'force-dynamic';

// GET /api/cron/runs?id=<jobId> — recent runs for one job (newest first).
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  try {
    const runs = await listRuns(id, 10);
    return NextResponse.json({ runs });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
