import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { spawnSubAgent } from '@/lib/subagent';
import { createDraft } from '@/lib/drafts';
import { AutonomyBlockedError } from '@/lib/autonomy';
import { buildClipCatalog, renderClipCatalogPrompt } from '@/lib/hyperframes-clips';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120; // spawns hyperframes-agent to write the storyboard.

// POST /api/hyperframes/generate { brief, platform?, length? }
// Free-form entry point for the Hyperframes hub: spawn hyperframes-agent on a
// brief and store its script + storyboard as a content_post draft (so it shows
// up in the hub list and Script Studio alike).
export async function POST(req: Request) {
  enterTenant(await resolveTenant());

  let body: { brief?: unknown; platform?: unknown; length?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const brief = typeof body.brief === 'string' ? body.brief.trim() : '';
  if (!brief) return NextResponse.json({ error: 'brief is required' }, { status: 400 });

  const platform = typeof body.platform === 'string' && body.platform ? body.platform : 'instagram';
  const length = Number.isFinite(Number(body.length)) ? Number(body.length) : undefined;

  // Inject the tenant's Media library so the agent can splice real uploaded clips
  // by id/name. Empty library → '' → nothing injected (behavior unchanged).
  const clipCatalogPrompt = renderClipCatalogPrompt(await buildClipCatalog());

  const task = [
    '<turn this brief into a 9:16 short-form video script + storyboard>',
    '',
    brief,
    `Platform: ${platform}`,
    length ? `Length: ${length}s` : null,
    clipCatalogPrompt ? '' : null,
    clipCatalogPrompt || null,
  ].filter((l) => l !== null).join('\n');

  try {
    const res = await spawnSubAgent('hyperframes-agent', task);
    if (!res.ok || !res.text) {
      return NextResponse.json({ error: `hyperframes-agent failed: ${res.error ?? 'no text returned'}` }, { status: 502 });
    }

    const title = `Storyboard — ${brief}`.slice(0, 120);
    const draft = await createDraft({
      type: 'content_post',
      title,
      payload: res.text,
      createdBy: 'hyperframes-agent',
      metadata: { platform, format: 'reel', source: 'hyperframes-hub', ...(length ? { length_s: length } : {}) },
    });

    return NextResponse.json({ draft });
  } catch (error) {
    if (error instanceof AutonomyBlockedError) {
      return NextResponse.json({ error: 'Autonomy mode is blocking new content drafts. Switch to Propose mode in Autonomy settings.' }, { status: 403 });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
