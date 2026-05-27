import { NextRequest, NextResponse } from 'next/server';
import { sql, tenantId } from '@/lib/db/client';
import { requireApiEditor, requireApiUser } from '@/lib/api-auth';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

interface NotificationRow {
  id: number;
  type: string;
  severity: string;
  title: string | null;
  message: string;
  read: boolean;
  data: Record<string, unknown> | null;
  created_at: string;
}

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const { searchParams } = req.nextUrl;
  const s = sql();

  // Note: seed filtering is a no-op (no seed_registry table in Supabase).
  const unreadOnly = searchParams.get('unread') === 'true';
  const type = searchParams.get('type') || null;
  const limit = Number(searchParams.get('limit')) || 50;

  const rows = await s`
    SELECT * FROM notifications
    WHERE tenant_id = ${tenantId()}
    ${unreadOnly ? s`AND read = false` : s``}
    ${type ? s`AND type = ${type}` : s``}
    ORDER BY created_at DESC LIMIT ${limit}
  ` as unknown as NotificationRow[];

  // jsonb `data` comes back already parsed; `read` is a real boolean.
  const notifications = rows.map(r => ({
    ...r,
    read: r.read === true,
    data: r.data ?? null,
  }));

  return NextResponse.json(notifications);
}

export async function PATCH(req: NextRequest) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const actor = requireUser(req as Request);
  const body = await req.json();
  const s = sql();

  if (body.mark_all_read) {
    await s`UPDATE notifications SET read = true WHERE tenant_id = ${tenantId()} AND read = false`;
    await logAudit({
      actor,
      action: 'notifications.mark_all_read',
      target: 'notifications',
      detail: null,
    });
    return NextResponse.json({ ok: true });
  }

  if (body.id) {
    await s`UPDATE notifications SET read = true WHERE id = ${body.id} AND tenant_id = ${tenantId()}`;
    await logAudit({
      actor,
      action: 'notifications.mark_read',
      target: `notification:${body.id}`,
      detail: null,
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Provide id or mark_all_read' }, { status: 400 });
}
