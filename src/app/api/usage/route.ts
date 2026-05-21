import { NextResponse } from 'next/server';
import { getUsageSummary } from '@/lib/usage';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 14), 1), 90);
  return NextResponse.json(getUsageSummary(days));
}
