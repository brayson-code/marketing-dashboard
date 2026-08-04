import { enterTenant, resolveTenant } from '@/lib/with-tenant';
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
  return NextResponse.json({ ...profile, completeness: completeness(profile.answers) });
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
