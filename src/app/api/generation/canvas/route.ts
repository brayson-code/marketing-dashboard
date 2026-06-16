import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextRequest, NextResponse } from 'next/server';
import { listCanvases, createCanvas } from '@/lib/generation-canvas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET  /api/generation/canvas        → { canvases: [{id,title,updated_at}] }
// POST /api/generation/canvas {title} → { canvas } (creates a blank canvas)

export async function GET() {
  enterTenant(await resolveTenant());
  try {
    return NextResponse.json({ canvases: await listCanvases() });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  enterTenant(await resolveTenant());
  let title: string | undefined;
  try {
    const j = (await req.json()) as { title?: unknown };
    if (typeof j?.title === 'string') title = j.title;
  } catch {
    /* empty body is fine */
  }
  try {
    return NextResponse.json({ canvas: await createCanvas(title) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
