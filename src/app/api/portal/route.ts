// Service Portal — the client's read. Their own workspace only, no cross-tenant access.
//
// Read-only by design: leave dates and probation are contractual facts, so a client
// reads them and HQ writes them (/api/portal/admin). There is no PATCH here.

import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { requireApiUser } from '@/lib/api-auth';
import { getServiceProfile, listAnnouncements } from '@/lib/service-portal';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  enterTenant(await resolveTenant());
  const auth = requireApiUser(request);
  if (auth) return auth;

  try {
    // Independent reads — no reason to make the page wait for them in series.
    const [profile, announcements] = await Promise.all([
      getServiceProfile(),
      listAnnouncements('client'),
    ]);
    return NextResponse.json({ profile, announcements });
  } catch (err) {
    console.error('portal route error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
