import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { getAccount, isConnected } from '@/lib/instagram';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/integrations/instagram/stats — account headline (followers, etc.).
export async function GET() {
  enterTenant(await resolveTenant());
  if (!(await isConnected())) return NextResponse.json({ connected: false });
  try {
    const account = await getAccount();
    return NextResponse.json({ connected: true, account });
  } catch (e) {
    return NextResponse.json({ connected: true, error: (e as Error).message }, { status: 502 });
  }
}
