import { zipSync, strToU8 } from 'fflate';
import { getHeyGenKey } from './heygen';
import { compositionToHtml } from './hyperframes-html';
import type { Composition } from './hyperframes-composition';

// Submit a composition to HeyGen's Hyperframes cloud renderer and read status.
// composition → HTML → in-memory zip → base64 → POST /v3/hyperframes/renders.
// The base64 project shape was confirmed empirically:
//   project: { type:'base64', media_type:'application/zip', data:<b64 of zip> }
// Uses the per-tenant key (getHeyGenKey), so each tenant renders on their own
// HeyGen account/credits.

const BASE = process.env.HEYGEN_API_URL?.trim() || 'https://api.heygen.com';

export interface RenderSubmit { ok: boolean; renderId?: string; error?: string }
export type RenderState = 'queued' | 'rendering' | 'completed' | 'failed' | 'unknown';
export interface RenderStatus {
  status: RenderState;
  videoUrl?: string;
  thumbnailUrl?: string;
  durationSec?: number;
  error?: string;
}

export async function submitRender(
  comp: Composition,
  opts?: { quality?: 'draft' | 'standard' | 'high'; title?: string; callbackUrl?: string; callbackId?: string },
): Promise<RenderSubmit> {
  const key = await getHeyGenKey();
  if (!key) return { ok: false, error: 'HeyGen isn’t connected — add an API key on the Connections page.' };

  const zip = zipSync({ 'index.html': strToU8(compositionToHtml(comp)) });
  const data = Buffer.from(zip).toString('base64');

  try {
    const res = await fetch(`${BASE}/v3/hyperframes/renders`, {
      method: 'POST',
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: { type: 'base64', media_type: 'application/zip', data },
        quality: opts?.quality ?? 'standard',
        format: 'mp4',
        ...(opts?.title ? { title: opts.title.slice(0, 500) } : {}),
        ...(opts?.callbackUrl ? { callback_url: opts.callbackUrl } : {}),
        ...(opts?.callbackId ? { callback_id: opts.callbackId } : {}),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: { render_id?: string }; error?: { message?: string } };
    if (res.status === 202 && json?.data?.render_id) return { ok: true, renderId: json.data.render_id };
    if (res.status === 402) return { ok: false, error: 'HeyGen account is out of API credits — top up to render.' };
    return { ok: false, error: json?.error?.message || `HeyGen render submit failed (HTTP ${res.status})` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function getRenderStatus(renderId: string): Promise<RenderStatus> {
  const key = await getHeyGenKey();
  if (!key) return { status: 'unknown', error: 'HeyGen not connected' };
  try {
    const res = await fetch(`${BASE}/v3/hyperframes/renders/${renderId}`, { headers: { 'x-api-key': key } });
    const json = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown> } & Record<string, unknown>;
    const d = (json.data ?? json) as Record<string, unknown>;
    return {
      status: (d.status as RenderState) || 'unknown',
      videoUrl: d.video_url as string | undefined,
      thumbnailUrl: d.thumbnail_url as string | undefined,
      durationSec: d.duration as number | undefined,
      error: (d.failure_message as string) || (d.error as string) || undefined,
    };
  } catch (e) {
    return { status: 'unknown', error: (e as Error).message };
  }
}
