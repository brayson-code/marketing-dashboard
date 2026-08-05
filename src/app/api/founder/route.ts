import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { sql } from '@/lib/db/client';
import { tenantId } from '@/lib/tenant';
import { NextResponse } from 'next/server';
import {
  getFounderProfile,
  saveFounderProfile,
  sanitizeAnswers,
  completeness,
} from '@/lib/founder-profile';

// The founder profile (North Star §12) — the person the assistant supports. Mirrors the
// playbook route: tenant entered first, whole-object save, sanitised at the boundary so
// only known fields can ever reach an agent prompt.

export async function GET() {
  enterTenant(await resolveTenant());
  const profile = await getFounderProfile();

  // Whether Client Success filled this in on the onboarding call. The setup wizard uses
  // it to say "we wrote this down for you, check it" instead of presenting what looks
  // like a blank form the client is expected to author.
  let captured: { by: string | null; at: string } | null = null;
  try {
    const rows = (await sql()`
      SELECT business_profile -> 'onboarding_capture' AS c
      FROM public.tenants WHERE id = ${tenantId()} LIMIT 1
    `) as unknown as Array<{ c: { by?: string; at?: string } | null }>;
    const c = rows[0]?.c;
    if (c && typeof c.at === 'string') captured = { by: c.by ?? null, at: c.at };
  } catch { /* the profile still renders without it */ }

  return NextResponse.json({
    ...profile,
    completeness: completeness(profile.answers),
    captured,
  });
}

export async function PUT(request: Request) {
  enterTenant(await resolveTenant());

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const raw = body.answers;
  if (!raw || typeof raw !== 'object') {
    return NextResponse.json({ error: 'answers object is required' }, { status: 400 });
  }

  const answers = sanitizeAnswers(raw as Record<string, unknown>);
  // Stamped here rather than in the lib: Date.now() isn't available to every caller of
  // the domain module, so the route owns "now" (same contract as saveCompanyPlaybook).
  const profile = await saveFounderProfile(answers, new Date().toISOString());
  return NextResponse.json({ ...profile, completeness: completeness(profile.answers) });
}
