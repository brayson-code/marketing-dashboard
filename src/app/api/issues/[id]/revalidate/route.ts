import { NextResponse } from 'next/server';
import { revalidateIssue } from '@/lib/revalidate';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // one Claude pass that reads a few repo files

// POST /api/issues/:id/revalidate — re-run the diagnostic on the CURRENT code:
// is the issue still present, and does the proposed patch still apply? Read-only.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await revalidateIssue(id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, verdict: r.verdict });
}
