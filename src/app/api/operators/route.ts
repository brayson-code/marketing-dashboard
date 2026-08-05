// Who can run the operator surfaces. Operator-gated: only an operator manages operators.
//
// Deliberately not a migration. Seeding the first two people in SQL was fine; needing a
// database migration every time Client Success hires someone is not.

import { NextRequest, NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { requireOperator } from '@/lib/operator-guard';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { listOperators, addOperator, removeOperator, provisionOperatorLogin } from '@/lib/operators';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  enterTenant(await resolveTenant());
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    return NextResponse.json({ operators: await listOperators() });
  } catch (err) {
    console.error('operators GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  enterTenant(await resolveTenant());
  const denied = await requireOperator();
  if (denied) return denied;
  const actor = requireUser(request);

  try {
    const body = await request.json();
    const action = String(body?.action ?? '');

    if (action === 'add') {
      const email = await addOperator(String(body?.email ?? ''), body?.note ?? null);
      if (!email) return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
      await logAudit({
        actor, action: 'operator.add', target: `operator:${email}`,
        detail: { note: body?.note ?? null },
      });
      return NextResponse.json({ ok: true, email });
    }

    if (action === 'remove') {
      const email = String(body?.email ?? '').trim().toLowerCase();
      const result = await removeOperator(email);
      // 409 rather than 500: refusing to remove the last operator is a rule being
      // enforced, not a failure.
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
      await logAudit({ actor, action: 'operator.remove', target: `operator:${email}`, detail: {} });
      return NextResponse.json({ ok: true });
    }

    if (action === 'login') {
      const email = String(body?.email ?? '').trim().toLowerCase();
      const origin = request.headers.get('origin') || new URL(request.url).origin;
      const grant = await provisionOperatorLogin(email, origin);
      await logAudit({
        actor, action: 'operator.provision_login', target: `operator:${email}`,
        detail: { error: grant.error ?? null },
      });
      return NextResponse.json(
        { ok: !grant.error, grant, error: grant.error ?? null },
        { status: grant.error ? 409 : 200 },
      );
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('operators POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
