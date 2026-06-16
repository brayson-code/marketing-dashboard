import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextRequest, NextResponse } from 'next/server';
import { getProvider } from '@/lib/media-providers';
import { insertJob, uploadGenerated } from '@/lib/generation-jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/generation/run { provider, canvasId?, nodeId?, input:{prompt?,imageUrl?,aspect?} }
// → { jobId, status, outputUrl? }. Sync providers (image) return completed+url; async
//   providers (video) return processing and are polled via /api/generation/jobs/:id.

export async function POST(req: NextRequest) {
  enterTenant(await resolveTenant());
  let body: { provider?: string; canvasId?: number; nodeId?: string; input?: { prompt?: string; imageUrl?: string; aspect?: string } };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const provider = getProvider(String(body.provider ?? ''));
  if (!provider) return NextResponse.json({ error: `Unknown provider: ${body.provider}` }, { status: 400 });
  const input = body.input ?? {};

  const result = await provider.submit(input);
  if (result.kind === 'error') return NextResponse.json({ error: result.error }, { status: 422 });

  if (result.kind === 'image') {
    let url: string;
    try {
      url = await uploadGenerated({ kind: 'image', base64: result.base64, mime: result.mime });
    } catch (e) {
      return NextResponse.json({ error: `Upload failed: ${(e as Error).message}` }, { status: 500 });
    }
    const jobId = await insertJob({ canvasId: body.canvasId, nodeId: body.nodeId, provider: provider.id, kind: provider.kind, status: 'completed', input, outputUrl: url });
    return NextResponse.json({ jobId, status: 'completed', outputUrl: url });
  }

  const jobId = await insertJob({ canvasId: body.canvasId, nodeId: body.nodeId, provider: provider.id, kind: provider.kind, status: 'processing', input, externalId: result.externalId });
  return NextResponse.json({ jobId, status: 'processing' });
}
