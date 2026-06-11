import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { spawnSubAgent } from '@/lib/subagent';
import { createDraft } from '@/lib/drafts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/integrations/youtube/comments/[id]/draft-reply
// Body: { comment_text, author, video_id, video_title? }
//
// Dispatches the content-writer to draft a reply, then writes it to /drafts
// as a YouTube-tagged draft. Approving in /drafts → publishContent →
// replyToComment posts it through Nango. End-to-end without manual copy/paste.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  enterTenant(await resolveTenant());
  const { id } = await params; // parent comment id (the one we'd reply to)
  const body = await request.json().catch(() => ({})) as {
    comment_text?: string; author?: string; video_id?: string; video_title?: string;
  };
  const commentText = (body.comment_text ?? '').trim();
  if (!commentText) return NextResponse.json({ error: 'comment_text required' }, { status: 400 });

  // Tight brief — the content-writer needs the actual comment, the asker's name,
  // and which video it's on. Keep it to a single short reply, no preamble.
  const brief = [
    `Draft ONE YouTube reply to a viewer comment. No preamble, no quotes, no signoff — just the reply body, ready to post.`,
    body.video_title ? `Video: "${body.video_title}".` : '',
    `Commenter: ${body.author ?? 'a viewer'}.`,
    `Their comment: ${commentText}`,
    `Constraints: under 280 characters. Friendly, specific, no emoji unless the comment itself uses them. Don't promise things outside the channel's typical scope. If the comment is hostile or spam, draft a brief polite acknowledgment that closes the conversation.`,
  ].filter(Boolean).join('\n\n');

  const res = await spawnSubAgent('content-writer', brief);
  if (!res.ok || !res.text) {
    return NextResponse.json({ error: res.error ?? 'content-writer returned no text' }, { status: 502 });
  }

  // Trim any boilerplate the writer might have included against instructions.
  const replyText = res.text.replace(/^["'`\s]+|["'`\s]+$/g, '').slice(0, 1000);

  try {
    const draft = await createDraft({
      type: 'content_post',
      title: `YouTube reply → ${body.author ?? 'viewer'}`,
      payload: replyText,
      createdBy: 'content-writer',
      metadata: {
        platform: 'youtube_comment',
        youtube: {
          parent_comment_id: id,
          video_id: body.video_id ?? null,
          video_title: body.video_title ?? null,
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
