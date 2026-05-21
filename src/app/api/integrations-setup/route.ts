import { NextResponse } from 'next/server';
import { listIntegrations, upsertIntegration, clearIntegration, PROVIDERS } from '@/lib/integrations-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ providers: PROVIDERS, integrations: listIntegrations() });
}

export async function POST(request: Request) {
  let body: { action?: string; provider?: string; config?: Record<string, unknown>; secret?: Record<string, string>; label?: string; scopes?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.provider) return NextResponse.json({ error: 'provider is required' }, { status: 400 });

  if (body.action === 'clear') {
    clearIntegration(body.provider);
    return NextResponse.json({ ok: true });
  }

  const row = upsertIntegration({
    provider: body.provider,
    label: body.label,
    config: body.config,
    secret: body.secret,
    scopes: body.scopes,
  });
  return NextResponse.json({ ok: true, integration: row });
}
