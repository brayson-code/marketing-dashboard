import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';
import { listIntegrations, upsertIntegration, clearIntegration, PROVIDERS } from '@/lib/integrations-store';
import { validateHeyGenKey } from '@/lib/heygen';

export const dynamic = 'force-dynamic';

// Providers we can sanity-check before storing, so "Connect" means "this key
// actually works" rather than "a key was saved". Only runs when the relevant
// secret field is supplied (an Update that leaves it blank keeps the existing one).
const SECRET_VALIDATORS: Record<string, (secret: Record<string, string>) => Promise<{ ok: boolean; error?: string }>> = {
  hyperframes: (secret) => (secret.api_key ? validateHeyGenKey(secret.api_key) : Promise.resolve({ ok: true })),
};

export async function GET() {
  enterTenant(await resolveTenant());
  return NextResponse.json({ providers: PROVIDERS, integrations: await listIntegrations() });
}

export async function POST(request: Request) {
  enterTenant(await resolveTenant());
  let body: { action?: string; provider?: string; config?: Record<string, unknown>; secret?: Record<string, string>; label?: string; scopes?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.provider) return NextResponse.json({ error: 'provider is required' }, { status: 400 });

  if (body.action === 'clear') {
    await clearIntegration(body.provider);
    return NextResponse.json({ ok: true });
  }

  const validate = SECRET_VALIDATORS[body.provider];
  if (validate && body.secret) {
    const result = await validate(body.secret);
    if (!result.ok) return NextResponse.json({ error: result.error || 'Key validation failed' }, { status: 400 });
  }

  const row = await upsertIntegration({
    provider: body.provider,
    label: body.label,
    config: body.config,
    secret: body.secret,
    scopes: body.scopes,
  });
  return NextResponse.json({ ok: true, integration: row });
}
