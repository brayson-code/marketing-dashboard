import { NextRequest, NextResponse } from 'next/server';
import { getEngagements } from '@/lib/queries';
import { requireApiUser } from '@/lib/api-auth';

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const { searchParams } = req.nextUrl;
  const real = searchParams.get('real') === 'true';
  const engagements = await getEngagements({
    platform: searchParams.get('platform') || undefined,
    action_type: searchParams.get('action_type') || undefined,
    date: searchParams.get('date') || undefined,
    excludeSeed: real,
  });
  return NextResponse.json(engagements);
}
