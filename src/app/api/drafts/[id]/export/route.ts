import { NextRequest, NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { getDraft } from '@/lib/drafts';
import { convert, FORMATS, isExportFormat } from '@/lib/export/markdown-export';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/drafts/:id/export?format=md|html|docx|pdf|pptx|xlsx
//
// Serves a draft's markdown payload as a downloadable client deliverable in any
// of the supported office/web formats. Mirrors the hyperframes export route:
// tenant-scoped getDraft() (a draft id from another tenant → 404), Content-
// Disposition: attachment for a clean filename, Cache-Control: no-store. nodejs
// runtime because the docx/pdf/pptx/xlsx generators aren't edge-safe.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    enterTenant(await resolveTenant());
    const { id } = await params;
    const draftId = Number(id);
    if (!Number.isFinite(draftId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const format = (req.nextUrl.searchParams.get('format') || 'md').toLowerCase();
    if (!isExportFormat(format)) {
      return NextResponse.json({ error: `format must be one of ${Object.keys(FORMATS).join(', ')}` }, { status: 400 });
    }

    const draft = await getDraft(draftId); // tenant-scoped
    if (!draft) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const md = draft.payload ?? '';
    const title = draft.title || `Draft ${draftId}`;
    const { buffer, contentType, ext } = await convert(format, md, title);

    const safeName = (draft.title || `draft-${draftId}`).replace(/[^a-z0-9-_]+/gi, '-').slice(0, 60) || `draft-${draftId}`;

    return new NextResponse(buffer as BodyInit, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${safeName}.${ext}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
