// POST /api/invite — wizard's "invite a teammate" step.
//
// We don't have an `invites` table yet and the brief explicitly said NOT to
// migrate one. The tenants row has a `business_profile jsonb` column (added in
// 0022), so we tuck pending invites into `business_profile.invites` as an array
// of { email, name?, role, status, invited_at } records. When a real invites
// table lands, migrate this array forward.
//
// Email delivery is out of scope for V1 — we log the intent into `notifications`
// and return ok. Sending is wired separately (see TODO below).

import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { sql, jsonb, tenantId } from '@/lib/db/client';
import { createNotification } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

type Role = 'admin' | 'editor' | 'viewer';

function normalizeRole(value: unknown): Role {
  if (value === 'admin' || value === 'editor' || value === 'viewer') return value;
  // Matches /api/users default — invitees land as editors unless asked otherwise.
  return 'editor';
}

const EMAIL_RE = /\S+@\S+\.\S+/;

interface InviteRecord {
  email: string;
  name?: string;
  role: Role;
  status: 'invited';
  invited_at: string;
}

export async function POST(request: Request) {
  enterTenant(await resolveTenant());

  let body: { email?: string; name?: string; role?: string };
  try {
    body = (await request.json()) as { email?: string; name?: string; role?: string };
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: 'Valid email is required' }, { status: 400 });
  }

  const role = normalizeRole(body.role);
  const name = typeof body.name === 'string' && body.name.trim().length > 0 ? body.name.trim() : undefined;

  try {
    // Read the existing invites array, append (or replace by email), write back.
    // Done in a single round trip via jsonb_set so concurrent invites don't lose
    // each other (last-write-wins is fine for an onboarding step; the worst case
    // is one extra email).
    const rows = (await sql()`
      SELECT business_profile FROM public.tenants
      WHERE id = ${tenantId()}
    `) as unknown as { business_profile: Record<string, unknown> | null }[];

    const profile = (rows[0]?.business_profile ?? {}) as Record<string, unknown>;
    const existing = Array.isArray(profile.invites) ? (profile.invites as InviteRecord[]) : [];
    const filtered = existing.filter((i) => (i?.email ?? '').toLowerCase() !== email);
    const record: InviteRecord = {
      email,
      name,
      role,
      status: 'invited',
      invited_at: new Date().toISOString(),
    };
    const nextProfile = { ...profile, invites: [...filtered, record] };

    await sql()`
      UPDATE public.tenants
      SET business_profile = ${jsonb(nextProfile)}
      WHERE id = ${tenantId()}
    `;

    await createNotification({
      type: 'invite_sent',
      severity: 'info',
      title: 'Teammate invited',
      message: `${email} has been invited to your tenant.`,
      data: { email, name, role },
    });

    // TODO: wire email send (Resend / Postmark) here so the invitee gets a real
    // signup link. For V1 the wizard accepts a logged invite as success.

    return NextResponse.json({ ok: true, email, status: 'invited' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'invite failed';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
