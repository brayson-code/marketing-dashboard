import { NextResponse } from 'next/server';
import { createNotification } from '@/lib/notifications';
import { sql, tenantId } from '@/lib/db/client';
import { getConfiguredApiKey } from '@/lib/auth';

const VALID_TYPES = ['daily_report', 'alert', 'lead_reply', 'bounce_spike', 'experiment_result', 'custom'];
const VALID_SEVERITIES = ['info', 'warning', 'error'];

export async function POST(request: Request) {
  // Auth: require API key
  const configuredApiKey = getConfiguredApiKey();
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

  // Also log to activity_log for live feed visibility
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
