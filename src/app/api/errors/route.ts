import { NextResponse } from 'next/server';
import { captureError } from '@/lib/observability';

export const dynamic = 'force-dynamic';

// Client-side error sink. The browser ErrorReporter + error boundaries POST here.
// Public (see proxy.ts) so errors that happen before/around auth still report.
// Capture is best-effort and never echoes details back.
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false }, { status: 400 }); }

  const message = typeof body.message === 'string' ? body.message : '';
  if (!message) return NextResponse.json({ ok: false }, { status: 400 });

  await captureError({
    source: 'client',
    level: body.level === 'fatal' || body.level === 'warning' ? body.level : 'error',
    message: message.slice(0, 4000),
    stack: typeof body.stack === 'string' ? body.stack : null,
    componentStack: typeof body.componentStack === 'string' ? body.componentStack : null,
    url: typeof body.url === 'string' ? body.url : null,
    route: typeof body.route === 'string' ? body.route : null,
    userAgent: request.headers.get('user-agent'),
    release: typeof body.release === 'string' ? body.release : null,
    context: body.context && typeof body.context === 'object' ? (body.context as Record<string, unknown>) : null,
  });

  return NextResponse.json({ ok: true });
}
