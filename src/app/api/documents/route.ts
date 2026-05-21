import { NextResponse } from 'next/server';
import { listDocuments, createDocument, type DocStatus } from '@/lib/documents';

export const dynamic = 'force-dynamic';

const STATUSES: DocStatus[] = ['raw', 'wiki', 'archived'];

// Auth enforced by the Supabase middleware.
export async function GET() {
  return NextResponse.json({ documents: await listDocuments() });
}

export async function POST(request: Request) {
  let body: { title?: string; content?: string; type?: string; status?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const title = (body.title ?? '').trim();
  if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 });

  const doc = await createDocument({
    title,
    content: typeof body.content === 'string' ? body.content : '',
    type: typeof body.type === 'string' ? body.type : undefined,
    status: STATUSES.includes(body.status as DocStatus) ? (body.status as DocStatus) : undefined,
  });
  return NextResponse.json({ ok: true, document: doc });
}
