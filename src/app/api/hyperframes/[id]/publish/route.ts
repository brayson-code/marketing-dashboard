import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { getDraft, createDraft, approveDraft, publishContent } from '@/lib/drafts';
import { persistRenderToBlob } from '@/lib/render-store';
import { AutonomyBlockedError } from '@/lib/autonomy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// IG Content Publishing can take a couple of minutes to process the video;
// allow up to 5 minutes to cover the full polling window.
export const maxDuration = 300;

type Platform = 'youtube_video' | 'instagram_reel';

interface PublishBody {
  platform: Platform;
  title?: string;
  description?: string;
  caption?: string;
  privacy?: 'public' | 'unlisted' | 'private';
  tags?: string[];
}

/**
 * POST /api/hyperframes/:id/publish
 *
 * Publishes a completed Hyperframes render to YouTube or Instagram.
 * Flow:
 *   1. Validate draft ownership + render.status === 'completed'.
 *   2. Copy HeyGen MP4 → Vercel Blob (persistRenderToBlob, idempotent).
 *   3. Create a content_post draft (gateOutbound runs — catch AUTONOMY_BLOCKED).
 *   4. Approve the draft (owner clicking Publish IS the approval).
 *   5. publishContent() routes to youtube_video / instagram_reel.
 *   6. Return { ok, draft_id, result }.
 *
 * The draft stays 'approved' on platform errors so the caller can retry.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  enterTenant(await resolveTenant());

  const { id } = await params;
  const draftId = Number(id);
  if (!Number.isFinite(draftId)) {
    return NextResponse.json({ ok: false, error: 'Invalid id' }, { status: 400 });
  }

  // Parse body
  let body: PublishBody;
  try {
    body = (await req.json()) as PublishBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const { platform, title, description, caption, privacy = 'public', tags } = body;
  if (platform !== 'youtube_video' && platform !== 'instagram_reel') {
    return NextResponse.json({ ok: false, error: 'platform must be youtube_video or instagram_reel' }, { status: 400 });
  }

  // 1. Validate source draft belongs to tenant and has a completed render.
  const sourceDraft = await getDraft(draftId);
  if (!sourceDraft) {
    return NextResponse.json({ ok: false, error: 'Storyboard not found' }, { status: 404 });
  }
  const render = (sourceDraft.metadata as { render?: Record<string, unknown> } | null)?.render;
  if (!render?.render_id || render.status !== 'completed') {
    return NextResponse.json(
      { ok: false, error: 'render the reel first — render must be completed before publishing' },
      { status: 400 },
    );
  }

  // 2. Persist MP4 to Blob (idempotent — returns existing blob_url when already done).
  let blobUrl: string;
  try {
    blobUrl = await persistRenderToBlob(draftId);
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  // 3. Build the publish draft.  The owner clicking Publish is the autonomy approval, so
  //    we catch AutonomyBlockedError and surface it clearly (observe mode).
  const draftTitle = (platform === 'youtube_video' ? (title ?? sourceDraft.title) : (caption?.split('\n')[0]?.slice(0, 80) ?? sourceDraft.title)) || sourceDraft.title;
  const draftPayload = platform === 'youtube_video' ? (description ?? '') : (caption ?? '');

  const renderMeta = {
    blob_url: blobUrl,
    render_id: String(render.render_id),
    source_draft_id: draftId,
  };

  const youtubeMeta = platform === 'youtube_video'
    ? { title: title ?? sourceDraft.title, description: description ?? '', tags: tags ?? [], privacy }
    : undefined;

  const instagramMeta = platform === 'instagram_reel'
    ? { caption: caption ?? '' }
    : undefined;

  let publishDraft: Awaited<ReturnType<typeof getDraft>>;
  try {
    const created = await createDraft({
      type: 'content_post',
      title: draftTitle,
      payload: draftPayload,
      createdBy: 'hyperframes-publish',
      metadata: {
        platform,
        video: renderMeta,
        ...(youtubeMeta ? { youtube: youtubeMeta } : {}),
        ...(instagramMeta ? { instagram: instagramMeta } : {}),
      },
    });
    // createDraft may have auto-executed (full_auto / act_notify with auto override).
    // Re-read the fresh row so we see its current status.
    publishDraft = await getDraft(created.id);
    if (!publishDraft) throw new Error('publish draft disappeared after creation');
  } catch (e) {
    if (e instanceof AutonomyBlockedError) {
      return NextResponse.json(
        {
          ok: false,
          error: `Autonomy mode 'observe' is blocking outbound actions. Switch to Propose or higher in Autonomy settings, then publish again.`,
        },
        { status: 403 },
      );
    }
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  // If the autonomy gate already executed (status !== 'pending' / 'approved'), the
  // draft was auto-approved and run — don't double-publish.
  if (publishDraft.status === 'published' || publishDraft.status === 'sent') {
    const note = publishDraft.execution_note ?? '';
    const link = extractLink(note, platform);
    return NextResponse.json({
      ok: true,
      draft_id: publishDraft.id,
      result: { note, link },
      message: `Published — ${platform === 'youtube_video' ? 'YouTube video' : 'Instagram reel'} is live.`,
    });
  }

  // 4. Owner's click IS the approval — approve now.
  await approveDraft(publishDraft.id, '(owner published from the Hyperframes editor)');

  // 5. Execute — publishContent will route to the platform branch we're about to add.
  const execResult = await publishContent(publishDraft.id);
  if (!execResult.ok) {
    // Draft stays 'approved' — caller can retry.
    return NextResponse.json(
      {
        ok: false,
        draft_id: publishDraft.id,
        error: execResult.error ?? 'Publish failed',
        message: `Publish failed — the draft (id ${publishDraft.id}) is still approved; you can retry.`,
      },
      { status: 502 },
    );
  }

  const note = execResult.draft?.execution_note ?? '';
  const link = extractLink(note, platform);
  return NextResponse.json({
    ok: true,
    draft_id: publishDraft.id,
    result: { note, link },
    message: `Published — ${platform === 'youtube_video' ? 'YouTube video' : 'Instagram reel'} is live.`,
  });
}

/** Parse the platform link out of the execution_note string set by publishContent. */
function extractLink(note: string, platform: Platform): string | null {
  if (platform === 'youtube_video') {
    // note format: "youtube video <id> — <url>"
    const m = note.match(/https?:\/\/[^\s]+/);
    return m ? m[0] : null;
  }
  // note format: "instagram reel <media_id> — <permalink>"
  const m = note.match(/https?:\/\/[^\s]+/);
  return m ? m[0] : null;
}
