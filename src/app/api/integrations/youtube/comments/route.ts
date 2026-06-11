import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { listRecentComments, isConnected } from '@/lib/youtube';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/integrations/youtube/comments?max=20
// Newest top-level comments across the connected channel. Powers the YouTube
// section of the Inbox (/agents/comms) — each row is an opportunity to draft
// a reply that lands in /drafts pending owner approval.
export async function GET(request: Request) {
  enterTenant(await resolveTenant());
  if (!(await isConnected())) return NextResponse.json({ connected: false, comments: [] });
  const max = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get('max') ?? '20')));
  try {
    return NextResponse.json({ connected: true, comments: await listRecentComments(max) });
  } catch (e) {
    return NextResponse.json({ connected: true, error: (e as Error).message, comments: [] }, { status: 502 });
  }
}
