import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';
import {
  listDrafts,
  approveDraft,
  rejectDraft,
  publishContent,
  sendEmail,
  confirmMeeting,
  type DraftStatus,
} from '@/lib/drafts';

export const dynamic = 'force-dynamic';
// Publishing an Instagram Reel polls Meta's container API for up to ~3.5 min
// (see instagram-publish.ts POLL_TIMEOUT_MS). Without this the default function
// cap kills the POST mid-publish, the draft never flips to 'published', and a
// retry re-posts the same Reel. Give it room to finish and flip the status.
export const maxDuration = 300;

export async function GET(request: Request) {
  enterTenant(await resolveTenant());
  const url = new URL(request.url);
  const status = (url.searchParams.get('status') ?? 'all') as DraftStatus | 'all';
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500);
  const drafts = await listDrafts({ status, limit });
  return NextResponse.json({ drafts });
}

export async function POST(request: Request) {
  enterTenant(await resolveTenant());
  let body: { action?: string; draft_id?: number; note?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const id = body.draft_id;
  if (typeof id !== 'number') return NextResponse.json({ error: 'draft_id (number) is required' }, { status: 400 });

  switch (body.action) {
    case 'approve': {
      const d = await approveDraft(id, body.note);
      if (!d) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
      return NextResponse.json({ ok: true, draft: d });
    }
    case 'reject': {
      const d = await rejectDraft(id, body.note);
      if (!d) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
      return NextResponse.json({ ok: true, draft: d });
    }
    case 'publish': {
      const r = await publishContent(id, body.note);
      return r.ok ? NextResponse.json({ ok: true, draft: r.draft }) : NextResponse.json({ error: r.error }, { status: 400 });
    }
    case 'send': {
      const r = await sendEmail(id, body.note);
      return r.ok ? NextResponse.json({ ok: true, draft: r.draft }) : NextResponse.json({ error: r.error }, { status: 400 });
    }
    case 'confirm': {
      const r = await confirmMeeting(id, body.note);
      return r.ok ? NextResponse.json({ ok: true, draft: r.draft }) : NextResponse.json({ error: r.error }, { status: 400 });
    }
    default:
      return NextResponse.json({ error: 'Unknown action. Use: approve | reject | publish | send | confirm' }, { status: 400 });
  }
}
