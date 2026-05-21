import { NextRequest, NextResponse } from 'next/server';
import { getDailyMetrics, getWeeklyKPIs } from '@/lib/queries';
import { requireApiUser } from '@/lib/api-auth';

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const { searchParams } = req.nextUrl;
  const weeks = Number(searchParams.get('weeks')) || 12;
  const real = searchParams.get('real') === 'true';

  const daily = await getDailyMetrics(weeks * 7, { excludeSeed: real });
  const weekly = await getWeeklyKPIs(weeks, { excludeSeed: real });

  return NextResponse.json({ daily, weekly });
}
