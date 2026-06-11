import { NextResponse } from 'next/server';
import { runWithTenant } from '@/lib/tenant';
import { tenantExists } from '@/lib/webhook-tenant';
import { processTelegramWebhook } from '@/lib/telegram-webhook';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// PER-TENANT alert-ingest webhook: /api/webhook/telegram/[tenantId]
//
// Same payload + global API_KEY auth as the legacy route, but the workspace id in
// the path directs the alert: we validate the tenant, then run the handler inside
// runWithTenant so the notification + activity_log row land in THAT client's
// workspace instead of HQ. The API_KEY still proves the caller is one of our systems.
export async function POST(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;

  if (!(await tenantExists(tenantId))) {
    return NextResponse.json({ error: 'Unknown workspace' }, { status: 404 });
  }

  return runWithTenant({ tenantId, userId: null }, () => processTelegramWebhook(request));
}
