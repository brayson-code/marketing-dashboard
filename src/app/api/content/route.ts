import { NextRequest, NextResponse } from 'next/server';
import { getContentPosts, updateContentStatus } from '@/lib/queries';
import { writebackContentStatus } from '@/lib/writeback';
import { requireApiEditor, requireApiUser } from '@/lib/api-auth';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const { searchParams } = req.nextUrl;
  const real = searchParams.get('real') === 'true';
  const posts = await getContentPosts({
    status: searchParams.get('status') || undefined,
    platform: searchParams.get('platform') || undefined,
    pillar: searchParams.get('pillar') ? Number(searchParams.get('pillar')) : undefined,
    excludeSeed: real,
  });
  return NextResponse.json(posts);
}

export async function PATCH(req: NextRequest) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const actor = requireUser(req as Request);
  const body = await req.json();
  const { id, status } = body;
  if (!id || !status) {
    return NextResponse.json({ error: 'id and status required' }, { status: 400 });
  }
  await updateContentStatus(id, status);
  writebackContentStatus(id, status);
  await logAudit({
    actor,
    action: 'content.update_status',
    target: `content:${id}`,
    detail: { status },
  });
  return NextResponse.json({ ok: true });
}
