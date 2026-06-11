import { NextResponse, after } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { tenantId, currentUserId, runWithTenant } from '@/lib/tenant';
import { insertScan, listScans } from '@/lib/reel-scans';
import { runScan } from '@/lib/optimizer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120; // insert returns fast; the scan fans out in after()

// Goals the report can tailor to. Anything else collapses to 'general'.
const GOALS = ['views', 'retention', 'sales', 'engagement', 'general'] as const;
type Goal = (typeof GOALS)[number];

function normalizeGoal(raw: unknown): Goal {
  const g = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return (GOALS as readonly string[]).includes(g) ? (g as Goal) : 'general';
}

// POST /api/content-lab/scan — kick off an "Optimize my reel" scan. Inserts the
// row as 'scanning' and returns it immediately; the slow pipeline (scrape +
// transcribe + insights + optimizer) runs in the background via after(). after()
// runs OUTSIDE the request's tenant context, so we capture the tenant inside the
// handler and re-enter it via runWithTenant for the background work.
export async function POST(request: Request) {
  enterTenant(await resolveTenant());
  const ctx = { tenantId: tenantId(), userId: currentUserId() };

  let body: { url?: unknown; goal?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });
    const goal = normalizeGoal(body.goal);

    const scan = await insertScan({ url, goal });

    after(() => runWithTenant(ctx, () => runScan(scan.id).catch(console.error)));

    return NextResponse.json({ scan });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// GET /api/content-lab/scan — recent scans for this tenant (newest first).
export async function GET() {
  enterTenant(await resolveTenant());
  try {
    const scans = await listScans({ limit: 40 });
    return NextResponse.json({ scans });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
