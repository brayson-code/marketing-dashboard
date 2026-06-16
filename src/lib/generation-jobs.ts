// Per-node async generation jobs for the Hyperframes Canvas: insert/read/advance a
// job row, and persist a generated image/video to Vercel Blob (+ the media library).

import { sql, jsonb, tenantId } from './db/client';
import { put } from '@vercel/blob';
import { createAsset } from './assets';

export interface JobRow {
  id: number;
  canvas_id: number | null;
  node_id: string | null;
  provider: string;
  kind: string;
  status: string;
  input: unknown;
  output_url: string | null;
  external_id: string | null;
  error: string | null;
}

export async function insertJob(j: {
  canvasId?: number | null;
  nodeId?: string | null;
  provider: string;
  kind: string;
  status: string;
  input?: unknown;
  outputUrl?: string | null;
  externalId?: string | null;
  error?: string | null;
}): Promise<number> {
  const rows = (await sql()`
    INSERT INTO public.generation_jobs
      (tenant_id, canvas_id, node_id, provider, kind, status, input, output_url, external_id, error)
    VALUES (${tenantId()}, ${j.canvasId ?? null}, ${j.nodeId ?? null}, ${j.provider}, ${j.kind}, ${j.status},
            ${j.input ? jsonb(j.input) : null}, ${j.outputUrl ?? null}, ${j.externalId ?? null}, ${j.error ?? null})
    RETURNING id
  `) as unknown as Array<{ id: number }>;
  return rows[0].id;
}

export async function getJob(id: number): Promise<JobRow | null> {
  const rows = (await sql()`
    SELECT id, canvas_id, node_id, provider, kind, status, input, output_url, external_id, error
    FROM public.generation_jobs WHERE id = ${id} AND tenant_id = ${tenantId()}
  `) as unknown as JobRow[];
  return rows[0] ?? null;
}

export async function setJobStatus(
  id: number,
  patch: { status?: string; outputUrl?: string | null; error?: string | null },
): Promise<void> {
  await sql()`
    UPDATE public.generation_jobs SET
      status     = COALESCE(${patch.status ?? null}, status),
      output_url = COALESCE(${patch.outputUrl ?? null}, output_url),
      error      = COALESCE(${patch.error ?? null}, error),
      updated_at = now()
    WHERE id = ${id} AND tenant_id = ${tenantId()}
  `;
}

/** Persist a generated image/video to Vercel Blob + record in the media library. */
export async function uploadGenerated(opts: {
  kind: 'image' | 'video';
  base64?: string;
  buffer?: Buffer;
  mime?: string;
}): Promise<string> {
  const buf = opts.buffer ?? Buffer.from(opts.base64 ?? '', 'base64');
  const mime = opts.mime || (opts.kind === 'video' ? 'video/mp4' : 'image/png');
  const ext = mime.includes('mp4') ? 'mp4' : mime.includes('jpeg') ? 'jpg' : mime.includes('png') ? 'png' : opts.kind === 'video' ? 'mp4' : 'png';
  const res = await put(`generated/${tenantId()}/${Date.now()}.${ext}`, buf, {
    access: 'public',
    contentType: mime,
    token: process.env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: true,
  });
  await createAsset({ kind: opts.kind, url: res.url, pathname: res.pathname, sizeBytes: buf.length, source: 'ai' }).catch(() => {});
  return res.url;
}
