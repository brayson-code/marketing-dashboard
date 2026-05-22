import { NextResponse } from 'next/server';
import { draftCronJob } from '@/lib/cron-nl';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/cron/draft — { prompt } → { job }. Converts a plain-English request
// into a cron job object for the editor to load. Owner-only (behind the auth
// middleware); does NOT create the job — the owner reviews + saves.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const prompt = typeof body?.prompt === 'string' ? body.prompt : '';
  try {
    const job = await draftCronJob(prompt);
    return NextResponse.json({ job });
  } catch (error) {
    const msg = (error as Error).message || String(error);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
