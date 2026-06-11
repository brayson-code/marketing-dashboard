import { NextResponse, after } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { tenantId, currentUserId, runWithTenant } from '@/lib/tenant';
import { scrapeAndStoreMany, runAnalysis } from '@/lib/reel-intel';
import type { ReelRow } from '@/lib/competitors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300; // one scrape returns fast; teardowns fan out in after()

function teardownOf(analysis: ReelRow['analysis']): string {
  return analysis && typeof analysis === 'object'
    ? String((analysis as Record<string, unknown>).teardown ?? '').trim()
    : '';
}

// POST /api/competitors/analyze — analyze one OR many pasted reels (ad-hoc).
// Accepts { url } (single) or { urls: [...] } (batch). The whole batch is scraped
// in ONE Apify run, the reels are returned immediately (status 'fetched'), and the
// teardowns fan out CONCURRENTLY in the background so the Live Analysis Board shows
// them all progress in real time. after() runs OUTSIDE the request's tenant
// context, so we capture the tenant and re-enter it via runWithTenant.
export async function POST(request: Request) {
  enterTenant(await resolveTenant());
  const ctx = { tenantId: tenantId(), userId: currentUserId() };
  let body: { url?: string; urls?: string[]; withScript?: boolean; deep?: boolean; force?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  try {
    const urls = (Array.isArray(body.urls) ? body.urls : [body.url])
      .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
      .map((u) => u.trim());
    if (urls.length === 0) return NextResponse.json({ error: 'url(s) required' }, { status: 400 });
    const withScript = body.withScript === true;
    const deep = body.deep === true;
    const force = body.force === true; // "Re-analyze": rerun the full teardown even if settled

    // ONE Apify run for the whole batch.
    const scraped = await scrapeAndStoreMany({ urls });
    const reels = scraped.map((s) => s.reel);

    // Schedule a teardown for each reel that needs one. Skip reels already torn
    // down (reuse the stored teardown for a script; otherwise do nothing) —
    // UNLESS force, which always re-runs a fresh teardown (refreshes cover + tags).
    const jobs = scraped
      .map(({ reel, data }) => {
        const existingTeardown = teardownOf(reel.analysis);
        const settled = reel.status === 'analyzed' || reel.status === 'scripted';
        if (settled && existingTeardown && !withScript && !force) return null; // nothing to do
        // force → drop the stored teardown so the analyst runs fresh (new tags).
        return { reel, data, existingTeardown: (settled && existingTeardown && !force) ? existingTeardown : undefined };
      })
      .filter((j): j is { reel: ReelRow; data: typeof scraped[number]['data']; existingTeardown: string | undefined } => j !== null);

    if (jobs.length > 0) {
      after(async () => {
        await runWithTenant(ctx, () =>
          Promise.all(
            jobs.map((j) =>
              runAnalysis(j.reel.id, j.data, { url: j.reel.url, withScript, deep, existingTeardown: j.existingTeardown })
                .catch((err) => console.error('[competitors/analyze] bg teardown failed:', (err as Error).message)),
            ),
          ),
        );
      });
    }

    return NextResponse.json({ reels });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
