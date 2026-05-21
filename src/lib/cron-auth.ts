import { NextResponse } from 'next/server';

// Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` on every scheduled
// invocation when a CRON_SECRET env var exists. We verify it so the /api/cron/*
// endpoints (which the proxy leaves public) can't be triggered by anyone else.
// If CRON_SECRET is unset (local dev), we allow the call.
export function verifyCron(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return null; // dev convenience — set CRON_SECRET in prod
  const auth = request.headers.get('authorization');
  if (auth === `Bearer ${secret}`) return null;
  return NextResponse.json({ error: 'Unauthorized cron' }, { status: 401 });
}
