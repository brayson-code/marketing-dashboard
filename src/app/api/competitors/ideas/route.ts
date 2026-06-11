import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { listIdeas } from '@/lib/reel-ideas';
import { generateIdeas } from '@/lib/ideas-gen';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120; // POST spawns the reel-ideator (one Haiku turn).

// GET /api/competitors/ideas — the tenant's reel concepts (newest first).
export async function GET() {
  enterTenant(await resolveTenant());
  try {
    const ideas = await listIdeas({ limit: 60 });
    return NextResponse.json({ ideas });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// POST /api/competitors/ideas — generate a fresh batch of concepts from the live
// trend radar + competitor wins. Body: { focus?, count? }. Returns the new batch.
export async function POST(request: Request) {
  enterTenant(await resolveTenant());
  let body: { focus?: string; count?: number };
  try {
    body = await request.json();
  } catch {
    body = {}; // empty body is fine — generate from trends with defaults.
  }
  try {
    const focus = typeof body.focus === 'string' ? body.focus : undefined;
    const count = typeof body.count === 'number' ? body.count : undefined;
    const ideas = await generateIdeas({ focus, count });
    return NextResponse.json({ ideas });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
