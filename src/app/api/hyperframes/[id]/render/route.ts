import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { getDraft, updateDraftMetadata } from '@/lib/drafts';
import { submitRender, getRenderStatus } from '@/lib/heygen-render';
import { isComposition, compositionFromStoryboard, type Composition } from '@/lib/hyperframes-composition';
import { parseStoryboard } from '@/lib/hyperframes-storyboard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// The composition to render: the saved one if present, else seeded from the
// storyboard (so Render works even before the user opens the editor).
function compositionFor(draft: { metadata: Record<string, unknown> | null; payload: string }): Composition {
  const saved = (draft.metadata as { composition?: unknown } | null)?.composition;
  return isComposition(saved) ? saved : compositionFromStoryboard(parseStoryboard(draft.payload));
}

// POST /api/hyperframes/:id/render — kick off a HeyGen render of the composition.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  enterTenant(await resolveTenant());
  const { id } = await params;
  const draftId = Number(id);
  if (!Number.isFinite(draftId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const draft = await getDraft(draftId);
  if (!draft) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const res = await submitRender(compositionFor(draft), { title: draft.title || `Reel ${draftId}` });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });

  const render = { render_id: res.renderId, status: 'queued' as const, submitted_at: new Date().toISOString() };
  await updateDraftMetadata(draftId, { render });
  return NextResponse.json({ render });
}

// GET /api/hyperframes/:id/render — poll current render status (refreshes from HeyGen).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  enterTenant(await resolveTenant());
  const { id } = await params;
  const draftId = Number(id);
  if (!Number.isFinite(draftId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const draft = await getDraft(draftId);
  if (!draft) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const current = (draft.metadata as { render?: Record<string, unknown> } | null)?.render;
  if (!current?.render_id) return NextResponse.json({ render: null });

  const st = await getRenderStatus(String(current.render_id));
  const render = {
    ...current,
    status: st.status,
    video_url: st.videoUrl ?? current.video_url ?? null,
    thumbnail_url: st.thumbnailUrl ?? current.thumbnail_url ?? null,
    duration_sec: st.durationSec ?? current.duration_sec ?? null,
    error: st.error ?? null,
  };
  // Persist when status advanced or a video landed, so a reload shows the result.
  if (st.status !== current.status || st.videoUrl) await updateDraftMetadata(draftId, { render });
  return NextResponse.json({ render });
}
