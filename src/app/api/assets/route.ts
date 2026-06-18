import { NextResponse } from 'next/server';
import { put, del } from '@vercel/blob';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { tenantId } from '@/lib/db/client';
import { listAssets, createAsset, deleteAsset } from '@/lib/assets';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Upload guardrails (audit finding #5: /api/assets was unguarded — no size or MIME
// cap, so a single tenant could push arbitrary large/arbitrary-type blobs).
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB — generous for a short clip.
// Server-side MIME allowlist. The kind ('image' vs 'video') is derived from this,
// so anything not listed is rejected rather than silently filed as 'video'.
const ALLOWED_MIME = new Set<string>([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
  'video/mp4', 'video/quicktime', 'video/webm',
]);

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

  // Per-tenant rate limit — uploads incur blob storage + egress cost and were
  // unguarded (audit finding #5). 30 uploads/min per workspace is plenty for a
  // human curating a media library while still braking an abusive loop.
  const rl = rateLimit('assets-upload', tenantId(), { windowMs: 60_000, max: 30 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many uploads — give it a moment and try again.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 });

    // Validate MIME server-side BEFORE deriving kind — an empty/unknown type or a
    // disallowed one is rejected, never silently filed as 'video'.
    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type${file.type ? ` (${file.type})` : ''}. Allowed: PNG, JPEG, GIF, WebP, AVIF, MP4, MOV, WebM.` },
        { status: 415 },
      );
    }
    // Cap size server-side. file.size is the browser-reported length of the
    // multipart part; reject oversized uploads before streaming to blob storage.
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` },
        { status: 413 },
      );
    }

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
