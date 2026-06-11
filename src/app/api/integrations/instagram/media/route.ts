import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { listRecentMedia, listAllMedia, isConnected } from '@/lib/instagram';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/integrations/instagram/media?max=24
// GET /api/integrations/instagram/media?all=true&max_pages=20
//
// Posts + reels + carousels on the connected account, newest first. The `all`
// variant paginates so the /content/library gallery can show the full archive.
export async function GET(request: Request) {
  enterTenant(await resolveTenant());
  if (!(await isConnected())) return NextResponse.json({ connected: false, media: [] });
  const url = new URL(request.url);
  const all = url.searchParams.get('all') === 'true';
  try {
    if (all) {
      const maxPages = Math.min(100, Math.max(1, Number(url.searchParams.get('max_pages') ?? '20')));
      const media = await listAllMedia({ maxPages });
      return NextResponse.json({ connected: true, count: media.length, media });
    }
    const max = Math.min(100, Math.max(1, Number(url.searchParams.get('max') ?? '24')));
    const media = await listRecentMedia(max);
    return NextResponse.json({ connected: true, count: media.length, media });
  } catch (e) {
    return NextResponse.json({ connected: true, error: (e as Error).message, media: [] }, { status: 502 });
  }
}
