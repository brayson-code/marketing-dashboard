import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { getIdea, setIdeaScript } from '@/lib/reel-ideas';
import { spawnSubAgent } from '@/lib/subagent';
import { createDraft } from '@/lib/drafts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120; // spawns hyperframes-agent to write the script.

// POST /api/competitors/ideas/[id]/script — turn a kept concept into a real reel
// script: spawn hyperframes-agent on the idea, store its output as a content_post
// draft, and attach the draft to the idea.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  enterTenant(await resolveTenant());
  const { id } = await params;
  const ideaId = Number(id);
  if (!Number.isFinite(ideaId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  try {
    const idea = await getIdea(ideaId);
    if (!idea) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Build the script brief from the concept the client kept.
    const brief = [
      '<turn this reel CONCEPT into a 9:16 KeyPlayers script + storyboard>',
      '',
      `Hook: ${idea.hook}`,
      `Angle: ${idea.angle}`,
      `Format: ${idea.format}`,
      idea.trend_tag ? `Rides: ${idea.trend_tag}` : null,
      idea.rationale ? `Why it could work: ${idea.rationale}` : null,
    ].filter((l) => l !== null).join('\n');

    const scriptRes = await spawnSubAgent('hyperframes-agent', brief);
    if (!scriptRes.ok || !scriptRes.text) {
      return NextResponse.json({ error: `hyperframes-agent failed: ${scriptRes.error ?? 'no text returned'}` }, { status: 502 });
    }

    const draft = await createDraft({
      type: 'content_post',
      title: `Reel script — ${idea.hook}`.slice(0, 120),
      payload: scriptRes.text,
      createdBy: 'reel-ideator',
      metadata: { platform: 'instagram', format: 'reel', source: 'reel-ideator', idea_id: ideaId },
    });

    const updated = await setIdeaScript(ideaId, draft.id);
    return NextResponse.json({ idea: updated ?? idea });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
