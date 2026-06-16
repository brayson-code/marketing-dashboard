import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextRequest, NextResponse } from 'next/server';
import { sql, tenantId } from '@/lib/db/client';
import { normalizeToE164 } from '@/lib/twilio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Saved contacts for the Engagement SMS inbox.
//   GET  → { contacts: [{ phone, name }] } (phone is E.164)
//   POST { phone, name } → upserts the contact (phone normalised to E.164)

export async function GET() {
  enterTenant(await resolveTenant());
  try {
    const rows = (await sql()`
      SELECT phone, name FROM public.contacts
      WHERE tenant_id = ${tenantId()}
      ORDER BY name NULLS LAST, phone
    `) as unknown as Array<{ phone: string; name: string | null }>;
    return NextResponse.json({ contacts: rows });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  enterTenant(await resolveTenant());
  let phone = '';
  let name = '';
  try {
    const j = (await req.json()) as { phone?: unknown; name?: unknown };
    phone = normalizeToE164(String(j.phone ?? '').trim());
    name = String(j.name ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!phone) return NextResponse.json({ error: '`phone` is required' }, { status: 400 });

  try {
    await sql()`
      INSERT INTO public.contacts (tenant_id, phone, name)
      VALUES (${tenantId()}, ${phone}, ${name || null})
      ON CONFLICT (tenant_id, phone) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
    `;
    return NextResponse.json({ ok: true, phone, name });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
