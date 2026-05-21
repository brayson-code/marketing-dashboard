import { NextResponse } from 'next/server';
import { getDocument, updateDocument, deleteDocument, type DocStatus } from '@/lib/documents';

export const dynamic = 'force-dynamic';

const STATUSES: DocStatus[] = ['raw', 'wiki', 'archived'];

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await getDocument(id);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ document: doc });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { title?: string; content?: string; status?: string; type?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const doc = await updateDocument(id, {
    title: typeof body.title === 'string' ? body.title : undefined,
    content: typeof body.content === 'string' ? body.content : undefined,
    status: STATUSES.includes(body.status as DocStatus) ? (body.status as DocStatus) : undefined,
    type: typeof body.type === 'string' ? body.type : undefined,
  });
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true, document: doc });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await deleteDocument(id);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
