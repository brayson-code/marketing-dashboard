// TEMPORARY diagnostic route — proves whether Yarn's Cloudflare lets a
// Chrome-TLS-impersonated request through from Vercel's datacenter IP (direct),
// and optionally through a residential proxy. Returns ONLY diagnostics (status
// codes, byte counts, a parse snippet) — no video bytes, no secrets.
//
// Guard: ?key=<SPIKE_TOKEN>. Remove this route + its /api/yarn-spike public-path
// entry + the proxyUrl plumbing once the spike question is answered.

import { NextRequest, NextResponse } from 'next/server';
import { searchYarn, downloadYarnClip } from '@/lib/yarn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Throwaway abuse-guard for a temporary route (not a real secret).
const SPIKE_TOKEN = 'yarn-spike-7Qx2';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('key') !== SPIKE_TOKEN) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const phrase = searchParams.get('text') || 'I am your father';
  // Optional residential proxy (e.g. an Apify Proxy URL) to compare against direct.
  const proxyUrl = searchParams.get('proxy') || undefined;

  const out: Record<string, unknown> = { phrase, proxied: Boolean(proxyUrl) };

  try {
    const search = await searchYarn(phrase, { proxyUrl, limit: 5 });
    out.search = {
      ok: search.ok,
      status: search.status,
      bytes: search.bytes,
      clipCount: search.clips.length,
      firstIds: search.clips.slice(0, 3).map((c) => c.uuid),
      ...(search.snippet ? { snippet: search.snippet } : {}),
    };

    if (search.clips.length > 0) {
      const dl = await downloadYarnClip(search.clips[0].uuid, { proxyUrl });
      out.download = {
        ok: dl.ok,
        status: dl.status,
        contentType: dl.contentType,
        bytes: dl.bytes,
        isMp4: dl.isMp4,
      };
    }
    out.verdict = out.search && (out.search as { ok: boolean }).ok
      ? 'CLOUDFLARE PASSED — Vercel IP + Chrome-TLS got through'
      : 'BLOCKED — got a non-200 / challenge page';
  } catch (e) {
    out.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    out.verdict = 'ERROR — likely the native impit binding failed to load (not an IP issue)';
  }

  return NextResponse.json(out, { status: 200 });
}
