import { NextRequest, NextResponse } from 'next/server';
import { getExperiments, getLearnings } from '@/lib/queries';
import { requireApiUser } from '@/lib/api-auth';

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const { searchParams } = req.nextUrl;
  const real = searchParams.get('real') === 'true';
  const view = searchParams.get('view');

  if (view === 'learnings') {
    return NextResponse.json(await getLearnings({ excludeSeed: real }));
  }

  const experiments = await getExperiments({
    status: searchParams.get('status') || undefined,
    excludeSeed: real,
  });
  const learnings = await getLearnings({ excludeSeed: real });

  return NextResponse.json({ experiments, learnings });
}
