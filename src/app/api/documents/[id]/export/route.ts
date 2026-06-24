import { NextRequest, NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { getDocument } from '@/lib/documents';
import { convert, FORMATS, isExportFormat } from '@/lib/export/markdown-export';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/documents/:id/export?format=md|html|docx|pdf|pptx|xlsx
//
// Same contract as /api/drafts/:id/export but sourced from a document's markdown
// `content`. getDocument() is tenant-scoped (id from another tenant → null →
// 404). Content-Disposition: attachment + Cache-Control: no-store; nodejs
// runtime for the office-format generators.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    enterTenant(await resolveTenant());
    const { id } = await params;

    const format = (req.nextUrl.searchParams.get('format') || 'md').toLowerCase();
    if (!isExportFormat(format)) {
      return NextResponse.json({ error: `format must be one of ${Object.keys(FORMATS).join(', ')}` }, { status: 400 });
    }

    const doc = await getDocument(id); // tenant-scoped
    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const md = doc.content ?? '';
    const title = doc.title || 'Document';
    const { buffer, contentType, ext } = await convert(format, md, title);

    const safeName = (doc.title || `document-${id}`).replace(/[^a-z0-9-_]+/gi, '-').slice(0, 60) || `document-${id}`;

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
