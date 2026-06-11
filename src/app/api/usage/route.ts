import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';
import { getUsageSummary } from '@/lib/usage';
import { tenantId } from '@/lib/db/client';
import { memo } from '@/lib/cache';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  enterTenant(await resolveTenant());
  const url = new URL(request.url);
  const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 14), 1), 90);
  return NextResponse.json(
    await memo(`usage:${tenantId()}:${days}`, 15000, () => getUsageSummary(days)),
  );
}
