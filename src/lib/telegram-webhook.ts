import { NextResponse } from 'next/server';
import { createNotification } from '@/lib/notifications';
import { sql, tenantId } from '@/lib/db/client';

const VALID_TYPES = ['daily_report', 'alert', 'lead_reply', 'bounce_spike', 'experiment_result', 'custom'];
const VALID_SEVERITIES = ['info', 'warning', 'error'];

// Shared alert-ingest handler (the "telegram" webhook). Internal systems POST
// alerts here authenticated with the GLOBAL platform API_KEY; the write scopes to
// tenantId(), so the caller picks the workspace: the legacy /api/webhook/telegram
// route runs with no context (→ HQ), while /api/webhook/telegram/[tenantId] runs it
// inside runWithTenant so the alert + activity_log row land in that client's space.
//
// Auth is the global API_KEY (read inline, NOT via @/lib/auth, to keep the legacy
// better-sqlite3 module out of this bundle). The tenant id is path-supplied and
// validated upstream — the API_KEY is what proves the caller is one of our systems.
export async function processTelegramWebhook(request: Request): Promise<NextResponse> {
  const configuredApiKey = process.env.API_KEY?.trim();
  if (!configuredApiKey) {
    return NextResponse.json({ error: 'API_KEY not configured' }, { status: 500 });
  }
  const apiKey = request.headers.get('x-api-key');
  if (!apiKey || apiKey !== configuredApiKey) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { type, severity, title, message, data } = body as {
    type?: string;
    severity?: string;
    title?: string;
    message?: string;
    data?: Record<string, unknown>;
  };

  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }

  const notifType = VALID_TYPES.includes(type || '') ? type! : 'custom';
  const notifSeverity = VALID_SEVERITIES.includes(severity || '') ? severity! : 'info';

  const id = await createNotification({
    type: notifType,
    severity: notifSeverity,
    title: typeof title === 'string' ? title : undefined,
    message: String(message),
    data: data && typeof data === 'object' ? data : undefined,
  });

  // Also log to activity_log for live feed visibility.
  await sql()`
    INSERT INTO activity_log (tenant_id, ts, action, detail, result)
    VALUES (
      ${tenantId()}, now(), 'alert',
      ${title ? `${title}: ${String(message).slice(0, 200)}` : String(message).slice(0, 200)},
      ${notifSeverity}
    )
  `;

  return NextResponse.json({ ok: true, id });
}
