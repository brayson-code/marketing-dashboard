// Service Portal — the client's read. Their own workspace only, no cross-tenant access.
//
// Read-only by design: leave dates and probation are contractual facts, so a client
// reads them and HQ writes them (/api/portal/admin). There is no PATCH here.

import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { requireApiUser } from '@/lib/api-auth';
import { getServiceProfile, listAnnouncements } from '@/lib/service-portal';
import { getSubject } from '@/lib/authz';
import { getFounderProfile } from '@/lib/founder-profile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  enterTenant(await resolveTenant());
  const auth = requireApiUser(request);
  if (auth) return auth;

  try {
    const subject = await getSubject();
    // Only a REAL member can be the assistant: getSubject() returns role 'va' as its
    // fail-closed default for anyone without a membership row, so trusting the role
    // alone would show operators the assistant's view of a client's placement.
    const viewer = subject.isMember && subject.role === 'va' ? 'va' : 'client';

    // Independent reads — no reason to make the page wait for them in series.
    const [profile, announcements, founder] = await Promise.all([
      getServiceProfile(),
      // The assistant sees posts aimed at assistants; the client sees posts aimed at
      // clients. 'all' reaches both. Olivia said different people publish for different
      // audiences, which is exactly this.
      listAnnouncements(viewer === 'va' ? 'va' : 'client'),
      getFounderProfile(),
    ]);

    return NextResponse.json({
      profile,
      announcements,
      viewer,
      // Who the assistant supports. Null for a client — it is their own name.
      founder_name: viewer === 'va'
        ? ((founder.answers as Record<string, string> | null)?.name ?? null)
        : null,
    });
  } catch (err) {
    console.error('portal route error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
