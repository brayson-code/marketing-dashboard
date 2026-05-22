import { NextResponse } from 'next/server';
import { revalidateDraft } from '@/lib/revalidate-draft';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // one Claude pass; may read a few repo files for proposals

// POST /api/drafts/:id/revalidate — re-judge whether this draft is still worth acting
// on against current goals + what's already shipped. Read-only (writes only a verdict).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const draftId = Number(id);
  if (!Number.isFinite(draftId)) return NextResponse.json({ error: 'Invalid draft id' }, { status: 400 });
  const r = await revalidateDraft(draftId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, verdict: r.verdict });
}
