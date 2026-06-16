import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextRequest, NextResponse } from 'next/server';
import { createDraft } from '@/lib/drafts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/generation/assemble { title?, scenes:[{type:'image'|'video', url, caption?}] }
// Builds a Hyperframes Composition (each frame becomes a scene background) and creates
// a content_post draft so it joins the existing render (HeyGen) + publish pipeline.
// Returns { draftId } — the client opens /content/hyperframes/:draftId to render.

const SCENE_MS = 3000;

export async function POST(req: NextRequest) {
  enterTenant(await resolveTenant());
  let body: { title?: string; scenes?: Array<{ type?: string; url?: string; caption?: string }> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const scenesIn = (body.scenes ?? []).filter((s) => typeof s?.url === 'string' && s.url);
  if (scenesIn.length === 0) return NextResponse.json({ error: 'No frames to assemble — generate at least one.' }, { status: 400 });

  const scenes = scenesIn.map((s, i) => ({
    id: `s${i + 1}`,
    startMs: i * SCENE_MS,
    endMs: (i + 1) * SCENE_MS,
    background: { type: s.type === 'video' ? 'video' : 'image', value: s.url as string },
    layers: [] as unknown[],
    ...(s.caption ? { caption: s.caption } : {}),
  }));
  const composition = { version: 1, aspect: '9:16', scenes };

  try {
    const draft = await createDraft({
      type: 'content_post',
      title: (body.title || 'Canvas reel').slice(0, 160),
      payload: '(Assembled from the Hyperframes canvas)',
      createdBy: 'hyperframes-canvas',
      metadata: { format: 'reel', source: 'hyperframes-canvas', platform: 'instagram', composition },
    });
    return NextResponse.json({ draftId: draft.id });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
