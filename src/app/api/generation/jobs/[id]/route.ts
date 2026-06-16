import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextRequest, NextResponse } from 'next/server';
import { getProvider } from '@/lib/media-providers';
import { getJob, setJobStatus, uploadGenerated } from '@/lib/generation-jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/generation/jobs/:id → { status, outputUrl?, error? }. For an in-flight
// async job, polls the provider; on completion fetches the output (with provider
// auth) and persists it to Blob + the media library.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  enterTenant(await resolveTenant());
  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isFinite(jobId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const job = await getJob(jobId);
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (job.status === 'completed' || job.status === 'failed') {
    return NextResponse.json({ status: job.status, outputUrl: job.output_url, error: job.error });
  }

  const provider = getProvider(job.provider);
  if (!provider?.poll || !job.external_id) return NextResponse.json({ status: job.status });

  const p = await provider.poll(String(job.external_id));
  if (p.status === 'processing') return NextResponse.json({ status: 'processing' });
  if (p.status === 'failed') {
    await setJobStatus(jobId, { status: 'failed', error: p.error });
    return NextResponse.json({ status: 'failed', error: p.error });
  }

  try {
    const r = await fetch(p.fetch.url, { headers: p.fetch.headers });
    if (!r.ok) throw new Error(`download HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const mime = r.headers.get('content-type') || (job.kind === 'image-to-video' ? 'video/mp4' : 'image/png');
    const url = await uploadGenerated({ kind: job.kind === 'image-to-video' ? 'video' : 'image', buffer: buf, mime });
    await setJobStatus(jobId, { status: 'completed', outputUrl: url });
    return NextResponse.json({ status: 'completed', outputUrl: url });
  } catch (e) {
    await setJobStatus(jobId, { status: 'failed', error: (e as Error).message });
    return NextResponse.json({ status: 'failed', error: (e as Error).message });
  }
}
