import { NextRequest, NextResponse } from 'next/server';
import { sql, tenantId } from '@/lib/db/client';
import { requireApiUser } from '@/lib/api-auth';

// Lightweight endpoint — returns pending counts for nav badges
// Polled by nav-rail every 30s
export async function GET(req: NextRequest) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  try {
    const s = sql();

    const [contentRows, outreachRows, signalsRows, notifRows, leadsRows] = await Promise.all([
      s`SELECT COUNT(*) as c FROM content_posts WHERE tenant_id = ${tenantId()} AND status = 'pending_approval'`,
      s`SELECT COUNT(*) as c FROM sequences WHERE tenant_id = ${tenantId()} AND status = 'pending_approval'`,
      s`SELECT COUNT(*) as c FROM signals WHERE tenant_id = ${tenantId()} AND date = now()::date::text`,
      s`SELECT COUNT(*) as c FROM notifications WHERE tenant_id = ${tenantId()} AND read = false`,
      s`SELECT COUNT(*) as c FROM leads WHERE tenant_id = ${tenantId()} AND status = 'new'`,
    ]);

    const content = Number(contentRows[0]?.c ?? 0);
    const outreach = Number(outreachRows[0]?.c ?? 0);
    const signals_today = Number(signalsRows[0]?.c ?? 0);
    const unread_notifications = Number(notifRows[0]?.c ?? 0);
    const new_leads = Number(leadsRows[0]?.c ?? 0);

    return NextResponse.json({
      content,
      outreach,
      signals_today,
      unread_notifications,
      new_leads,
      // Combined for automations page badge
      total_pending: content + outreach,
    });
  } catch {
    return NextResponse.json({
      content: 0, outreach: 0, signals_today: 0,
      unread_notifications: 0, new_leads: 0, total_pending: 0,
    });
  }
}

export const dynamic = 'force-dynamic';
