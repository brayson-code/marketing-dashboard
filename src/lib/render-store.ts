// Persists a HeyGen-rendered MP4 from a short-lived signed URL into Vercel Blob
// for permanent storage. Fixes the ~7-day HeyGen expiry — the Blob copy never
// expires. Tenant-scoped throughout.
//
// Usage:  const blobUrl = await persistRenderToBlob(draftId);
// The public Blob URL is also written back to metadata.render.blob_url on the
// draft so subsequent calls are instant (idempotent).

import { put } from '@vercel/blob';
import { tenantId } from './db/client';
import { updateDraftMetadata, getDraft } from './drafts';

/** Already-persisted: return the blob_url without re-fetching. */
function blobUrlFrom(draft: Awaited<ReturnType<typeof getDraft>>): string | null {
  const render = (draft?.metadata as { render?: Record<string, unknown> } | null)?.render;
  return (render?.blob_url as string | null) ?? null;
}

/** Merge blob_url into metadata.render without clobbering the rest of the render object.
 *  We re-read the existing render sub-key and do a shallow merge at app level, then
 *  write back via updateDraftMetadata (which itself does `|| patch` at the top level). */
async function writeBlobUrl(draftId: number, blobUrl: string): Promise<void> {
  const fresh = await getDraft(draftId);
  const existingRender = (fresh?.metadata as { render?: Record<string, unknown> } | null)?.render ?? {};
  await updateDraftMetadata(draftId, { render: { ...existingRender, blob_url: blobUrl } });
}

/**
 * Copies the HeyGen-rendered MP4 for `draftId` into Vercel Blob and returns the
 * permanent public URL.
 *
 * - Idempotent: if `metadata.render.blob_url` is already set, returns it immediately.
 * - Validates that the render is completed and carries a video_url; returns a tagged
 *   error string starting with `"render-store: "` if preconditions fail (e.g. the
 *   HeyGen URL has expired — 4xx — or the render isn't done yet).
 * - 503s if BLOB_READ_WRITE_TOKEN is missing (mirrors the assets.ts pattern).
 */
export async function persistRenderToBlob(draftId: number): Promise<string> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('render-store: BLOB_READ_WRITE_TOKEN is not configured — cannot store video');
  }

  const draft = await getDraft(draftId);
  if (!draft) throw new Error(`render-store: draft ${draftId} not found`);

  // Fast path — already copied.
  const existing = blobUrlFrom(draft);
  if (existing) return existing;

  const render = (draft.metadata as { render?: Record<string, unknown> } | null)?.render;
  if (!render?.render_id) throw new Error('render-store: no render on this draft — render first');
  if (render.status !== 'completed') {
    throw new Error(`render-store: render is ${String(render.status ?? 'unknown')} — wait for it to complete`);
  }
  const videoUrl = render.video_url as string | null;
  if (!videoUrl) throw new Error('render-store: render is completed but video_url is missing');

  // Fetch the HeyGen signed URL. A 4xx most likely means the URL has expired
  // (~7 days TTL). Tell the user to re-render in that case.
  const fetchResp = await fetch(videoUrl);
  if (!fetchResp.ok) {
    if (fetchResp.status === 403 || fetchResp.status === 404 || fetchResp.status === 410) {
      throw new Error(
        `render-store: HeyGen video URL returned ${fetchResp.status} — the signed URL has likely expired. Please re-render to get a fresh URL.`,
      );
    }
    throw new Error(
      `render-store: failed to fetch HeyGen video (HTTP ${fetchResp.status}) — re-render if this persists`,
    );
  }

  const blob = await fetchResp.blob();
  const tid = tenantId();
  const renderId = String(render.render_id);
  const pathname = `hyperframes/${tid}/${draftId}-${renderId}.mp4`;

  const result = await put(pathname, blob, {
    access: 'public',
    contentType: 'video/mp4',
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });

  await writeBlobUrl(draftId, result.url);
  return result.url;
}
