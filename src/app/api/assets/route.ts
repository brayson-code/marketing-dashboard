import { NextResponse } from 'next/server';
import { put, del } from '@vercel/blob';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { tenantId } from '@/lib/db/client';
import { listAssets, createAsset, deleteAsset } from '@/lib/assets';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/assets — the tenant's media library.
export async function GET() {
  enterTenant(await resolveTenant());
  try {
    return NextResponse.json({ assets: await listAssets() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// POST /api/assets — multipart upload of a clip/image → Vercel Blob (public) → record.
export async function POST(req: Request) {
  enterTenant(await resolveTenant());
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 });

    const kind: 'video' | 'image' = file.type.startsWith('image/') ? 'image' : 'video';
    const safe = (file.name || 'clip').replace(/[^a-zA-Z0-9._-]/g, '_');
    const blob = await put(`assets/${tenantId()}/${safe}`, file, { access: 'public', addRandomSuffix: true });

    const asset = await createAsset({ kind, name: file.name, url: blob.url, pathname: blob.pathname, sizeBytes: file.size });
    return NextResponse.json({ asset });
  } catch (e) {
    const msg = (e as Error).message;
    if (/token|BLOB_READ_WRITE/i.test(msg)) {
      return NextResponse.json({ error: 'Blob storage isn’t linked yet — finish linking the store, then retry.' }, { status: 503 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE /api/assets?id=123 — remove the record + purge the blob.
export async function DELETE(req: Request) {
  enterTenant(await resolveTenant());
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const pathname = await deleteAsset(id);
  if (pathname) { try { await del(pathname); } catch { /* already gone */ } }
  return NextResponse.json({ ok: true });
}
