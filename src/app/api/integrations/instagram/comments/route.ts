import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { listRecentComments, isConnected } from '@/lib/instagram';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/integrations/instagram/comments?max_media=8&per_media=6
// Most-recent comments across the most-recent posts. Mirrors the YouTube
// shape so the Inbox triage UI can render either provider identically.
export async function GET(request: Request) {
  enterTenant(await resolveTenant());
  if (!(await isConnected())) return NextResponse.json({ connected: false, comments: [] });
  const url = new URL(request.url);
  const maxMedia = Math.min(20, Math.max(1, Number(url.searchParams.get('max_media') ?? '8')));
  const perMedia = Math.min(20, Math.max(1, Number(url.searchParams.get('per_media') ?? '6')));
  try {
    return NextResponse.json({ connected: true, comments: await listRecentComments(maxMedia, perMedia) });
  } catch (e) {
    return NextResponse.json({ connected: true, error: (e as Error).message, comments: [] }, { status: 502 });
  }
}
