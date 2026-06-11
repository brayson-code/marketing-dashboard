import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextRequest, NextResponse } from 'next/server';
import { getSignals } from '@/lib/queries';
import { requireApiUser } from '@/lib/api-auth';

export async function GET(req: NextRequest) {
  enterTenant(await resolveTenant());
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const { searchParams } = req.nextUrl;
  const real = searchParams.get('real') === 'true';
  const signals = await getSignals({
    type: searchParams.get('type') || undefined,
    relevance: searchParams.get('relevance') || undefined,
    date: searchParams.get('date') || undefined,
    excludeSeed: real,
  });
  return NextResponse.json(signals);
}
