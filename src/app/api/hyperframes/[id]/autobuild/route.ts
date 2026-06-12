import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { getDraft, updateDraftMetadata } from '@/lib/drafts';
import { isComposition } from '@/lib/hyperframes-composition';
import { hasAnthropicKey, NO_ANTHROPIC_KEY_MESSAGE } from '@/lib/anthropic-key';
import { autobuildComposition } from '@/lib/hyperframes-autobuild';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 90; // one forced-tool Sonnet call

// POST /api/hyperframes/:id/autobuild { force?: boolean }
// Agent-first first open: build the RICH composition (transitions, punch beats,
// b-roll splices from the tenant library, infographics, caption style) from the
// storyboard via hyperframes-autobuild. Persistence contract:
//   - source 'agent'    → composition persisted to metadata.composition; { draft } returned.
//   - source 'seed'     → the plain seed is returned but NOT persisted (so the
//                         auto-build affordance can be retried); { error } says why.
//   - source 'existing' → a composition already exists and force wasn't set —
//                         returned as-is, nothing rebuilt.
// No Anthropic key (BYO gate) → 400 with the standard key-needed message.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    enterTenant(await resolveTenant());
    const { id } = await params;
    const draftId = Number(id);
    if (!Number.isFinite(draftId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const draft = await getDraft(draftId);
    if (!draft) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    let body: { force?: unknown } = {};
    try { body = await req.json(); } catch { /* empty body is fine */ }
    const force = body.force === true;

    const existing = (draft.metadata as { composition?: unknown } | null)?.composition;
    if (isComposition(existing) && !force) {
      return NextResponse.json({ composition: existing, source: 'existing' });
    }

    if (!(await hasAnthropicKey())) {
      return NextResponse.json({ error: NO_ANTHROPIC_KEY_MESSAGE }, { status: 400 });
    }

    const res = await autobuildComposition(draftId);
    if (res.source === 'agent') {
      const updated = await updateDraftMetadata(draftId, { composition: res.composition });
      return NextResponse.json({ draft: updated, composition: res.composition, source: 'agent' });
    }
    return NextResponse.json({ composition: res.composition, source: 'seed', error: res.error ?? null });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
