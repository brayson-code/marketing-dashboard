import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Image proxy for Instagram CDN thumbnails. The browser can't reliably load IG
// scontent/cdninstagram URLs directly (hotlink protection + they're short-lived),
// so we fetch them server-side and stream them back with cache headers. Strictly
// allowlisted to IG/Meta CDN hosts (no SSRF to arbitrary/internal hosts).
const ALLOW_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net|instagram\.com)$/i;

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) return new NextResponse('missing url', { status: 400 });

  let host: string;
  try { host = new URL(url).hostname; } catch { return new NextResponse('bad url', { status: 400 }); }
  if (!ALLOW_HOST.test(host)) return new NextResponse('forbidden host', { status: 403 });

  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/avif,image/webp,image/*,*/*' },
      // IG signs URLs with an expiry; an expired one returns 403 — surface it as 404
      // so the <img> onError fallback (gradient placeholder) kicks in.
      cache: 'no-store',
    });
    if (!upstream.ok) return new NextResponse('upstream', { status: upstream.status === 403 ? 404 : 502 });
    const body = await upstream.arrayBuffer();
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
        // Cache hard at the CDN + browser — these thumbnails never change once fetched.
        'Cache-Control': 'public, max-age=86400, s-maxage=604800, immutable',
      },
    });
  } catch {
    return new NextResponse('fetch failed', { status: 502 });
  }
}
