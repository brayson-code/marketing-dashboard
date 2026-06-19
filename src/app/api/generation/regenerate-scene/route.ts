import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextRequest, NextResponse } from 'next/server';
import { getProvider } from '@/lib/media-providers';
import { insertJob, uploadGenerated } from '@/lib/generation-jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/generation/regenerate-scene { generation:{ prompt, model, refs? } }
// Re-rolls a timeline scene's AI-generated background IN PLACE. This is the same
// flow as /api/generation/run (provider registry + generation_jobs), the only
// difference being it maps the scene's `generation` provenance → GenInput (and
// requires no canvas/node). Sync providers (image) return completed+url; async
// providers (video) return processing and are polled via /api/generation/jobs/:id
// — the EXISTING poll route, which on completion uploadGenerated()s → createAsset
// (source:'ai'). No new job mechanism is introduced.
//
// `kind` is returned ('image' | 'video', derived from the submit result) so the
// editor knows whether to set the scene background.type to 'image' or 'video'.

export async function POST(req: NextRequest) {
  enterTenant(await resolveTenant());

  let body: { generation?: { prompt?: string; model?: string; refs?: string[] } };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const gen = body.generation;
  if (!gen || typeof gen.prompt !== 'string' || !gen.prompt.trim() || typeof gen.model !== 'string') {
    return NextResponse.json({ error: 'generation.prompt and generation.model are required' }, { status: 400 });
  }

  const provider = getProvider(gen.model);
  if (!provider) return NextResponse.json({ error: `Unknown model: ${gen.model}` }, { status: 400 });

  // First ref (if any) becomes the upstream image — exactly how the canvas feeds
  // an image into Veo (image→video) or Nano Banana (image+text→image).
  const imageUrl = Array.isArray(gen.refs) ? gen.refs.find((r) => typeof r === 'string' && r.trim()) : undefined;
  const input = { prompt: gen.prompt.trim(), imageUrl, aspect: '9:16' };

  const result = await provider.submit(input);
  if (result.kind === 'error') return NextResponse.json({ error: result.error }, { status: 422 });

  if (result.kind === 'image') {
    let url: string;
    try {
      url = await uploadGenerated({ kind: 'image', base64: result.base64, mime: result.mime });
    } catch (e) {
      return NextResponse.json({ error: `Upload failed: ${(e as Error).message}` }, { status: 500 });
    }
    const jobId = await insertJob({ provider: provider.id, kind: provider.kind, status: 'completed', input, outputUrl: url });
    return NextResponse.json({ jobId, status: 'completed', outputUrl: url, kind: 'image' });
  }

  const jobId = await insertJob({ provider: provider.id, kind: provider.kind, status: 'processing', input, externalId: result.externalId });
  return NextResponse.json({ jobId, status: 'processing', kind: 'video' });
}
