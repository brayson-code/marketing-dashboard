// Leave requests. Any workspace member reads; who may WRITE what is enforced in
// src/lib/leave.ts against the live subject, not against anything the browser sent.

import { NextRequest, NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { requireApiUser } from '@/lib/api-auth';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getSubject } from '@/lib/authz';
import { createClient } from '@/lib/supabase/server';
import { getServiceProfile } from '@/lib/service-portal';
import { accrualStatus } from '@/lib/service-policy';
import { listLeave, createLeaveRequest, decideLeave, cancelLeave } from '@/lib/leave';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  enterTenant(await resolveTenant());
  const auth = requireApiUser(request);
  if (auth) return auth;
  try {
    return NextResponse.json({ requests: await listLeave() });
  } catch (err) {
    console.error('leave GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  enterTenant(await resolveTenant());
  const auth = requireApiUser(request);
  if (auth) return auth;
  const actor = requireUser(request);

  try {
    const body = await request.json();
    const action = String(body?.action ?? '');

    if (action === 'request') {
      const subject = await getSubject();
      if (!subject.isMember || subject.role !== 'va') {
        return NextResponse.json(
          { error: 'Only the assistant can request leave.' }, { status: 403 },
        );
      }

      // Probation is derived from the start date on the service profile, never taken
      // from the browser — it decides whether the leave is paid.
      const profile = await getServiceProfile();
      const accrual = profile?.ea_started_on ? accrualStatus(profile.ea_started_on, Date.now()) : null;

      const supabase = await createClient();
      const { data } = await supabase.auth.getUser();

      const result = await createLeaveRequest({
        kind: String(body?.kind ?? ''),
        startsOn: String(body?.starts_on ?? ''),
        endsOn: String(body?.ends_on ?? ''),
        note: body?.note ?? null,
        workingDayNames: profile?.ea_days ?? [],
        unpaid: !!accrual?.inProbation,
        requesterEmail: data.user?.email ?? null,
      });
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

      await logAudit({
        actor, action: 'leave.request', target: `leave:${result.id}`,
        detail: { kind: body?.kind, days: result.days, unpaid: !!accrual?.inProbation },
      });
      return NextResponse.json(result);
    }

    if (action === 'approve' || action === 'decline') {
      const result = await decideLeave(
        String(body?.id ?? ''),
        action === 'approve' ? 'approved' : 'declined',
        actor?.username ?? null,
        body?.note ?? null,
      );
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
      await logAudit({
        actor, action: `leave.${action}`, target: `leave:${body?.id}`, detail: {},
      });
      return NextResponse.json({ ok: true });
    }

    if (action === 'cancel') {
      const result = await cancelLeave(String(body?.id ?? ''));
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('leave POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
