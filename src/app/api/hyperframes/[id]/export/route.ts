import { NextRequest, NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { getDraft } from '@/lib/drafts';
import { isComposition, normalizeComposition } from '@/lib/hyperframes-composition';
import { compositionToFcpxml, compositionToEdl } from '@/lib/composition-export';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/hyperframes/:id/export?format=fcpxml|edl
//
// Serves the persisted composition (draft.metadata.composition) as an NLE
// interchange file the user can drop into Premiere Pro / DaVinci Resolve /
// Final Cut. Pure, read-only projection — the render/HeyGen path is untouched.
//
// Tenant-scoped: getDraft() filters by tenantId(), so a draft id from another
// tenant returns 404. Content-Disposition: attachment gives a clean filename +
// correct mime so the browser downloads it (the editor button is a plain <a>).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    enterTenant(await resolveTenant());
    const { id } = await params;
    const draftId = Number(id);
    if (!Number.isFinite(draftId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const format = (req.nextUrl.searchParams.get('format') || 'fcpxml').toLowerCase();
    if (format !== 'fcpxml' && format !== 'edl') {
      return NextResponse.json({ error: 'format must be fcpxml or edl' }, { status: 400 });
    }

    const draft = await getDraft(draftId); // tenant-scoped
    if (!draft) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const saved = (draft.metadata as { composition?: unknown } | null)?.composition;
    if (!isComposition(saved)) {
      return NextResponse.json({ error: 'No composition to export — save the editor first' }, { status: 400 });
    }

    const comp = normalizeComposition(saved);
    const title = draft.title || `Reel ${draftId}`;
    const body = format === 'fcpxml'
      ? compositionToFcpxml(comp, { title })
      : compositionToEdl(comp, { title });

    const safeName = (draft.title || `reel-${draftId}`).replace(/[^a-z0-9-_]+/gi, '-').slice(0, 60) || `reel-${draftId}`;
    const filename = `${safeName}.${format}`;
    const contentType = format === 'fcpxml'
      ? 'application/xml; charset=utf-8'
      : 'text/plain; charset=utf-8';

    return new NextResponse(body, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
