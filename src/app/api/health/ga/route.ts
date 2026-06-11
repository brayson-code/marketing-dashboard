import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';

export async function GET(request: Request) {
  enterTenant(await resolveTenant());
  const auth = requireApiUser(request);
  if (auth) return auth;
  const id = process.env.NEXT_PUBLIC_GA_ID || process.env.GA_MEASUREMENT_ID || null;
  return NextResponse.json({ id, enabled: !!id, checked_at: new Date().toISOString() });
}
