import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { spawnSubAgent } from '@/lib/subagent';
import { createDraft } from '@/lib/drafts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/integrations/instagram/comments/[id]/draft-reply
// Body: { comment_text, author, media_id }
// Same pattern as the YouTube draft-reply endpoint — different platform tag
// so publishContent() routes to the IG reply API at approve time.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  enterTenant(await resolveTenant());
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as {
    comment_text?: string; author?: string; media_id?: string;
  };
  const commentText = (body.comment_text ?? '').trim();
  if (!commentText) return NextResponse.json({ error: 'comment_text required' }, { status: 400 });

  const brief = [
    `Draft ONE Instagram reply to a comment. No preamble, no quotes — just the reply body, ready to post.`,
    `Commenter: @${body.author ?? 'follower'}.`,
    `Their comment: ${commentText}`,
    `Constraints: under 220 characters. Friendly, specific, voice matches IG conventions (1-2 emoji ok, no hashtag stuffing). If hostile or spam, a brief polite acknowledgment that closes the conversation.`,
  ].join('\n\n');

  const res = await spawnSubAgent('content-writer', brief);
  if (!res.ok || !res.text) {
    return NextResponse.json({ error: res.error ?? 'content-writer returned no text' }, { status: 502 });
  }
  const replyText = res.text.replace(/^["'`\s]+|["'`\s]+$/g, '').slice(0, 1000);

  try {
    const draft = await createDraft({
      type: 'content_post',
      title: `Instagram reply → @${body.author ?? 'follower'}`,
      payload: replyText,
      createdBy: 'content-writer',
      metadata: {
        platform: 'instagram_comment',
        instagram: {
          parent_comment_id: id,
          media_id: body.media_id ?? null,
          original_author: body.author ?? null,
          original_text: commentText,
        },
      },
    });
    return NextResponse.json({ ok: true, draft_id: draft.id, preview: replyText });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
