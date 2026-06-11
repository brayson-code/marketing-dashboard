import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { requireApiUser } from '@/lib/api-auth';
import { getInstance, resolveOpenClawPaths } from '@/lib/instances';

export const dynamic = 'force-dynamic';

function getInstanceId(request: Request): string | null {
  try {
    const url = new URL(request.url);
    return url.searchParams.get('instance') || url.searchParams.get('namespace');
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  enterTenant(await resolveTenant());
  const auth = requireApiUser(request);
  if (auth) return auth;
  try {
    const instance = getInstance(getInstanceId(request));
    const { healthDir } = resolveOpenClawPaths(instance);
    const driftJson = path.join(healthDir, 'memory-drift-weekly.json');

    if (!fs.existsSync(driftJson)) {
      return NextResponse.json({ error: 'Memory drift report not found' }, { status: 404 });
    }
    const raw = fs.readFileSync(driftJson, 'utf-8');
    const data = JSON.parse(raw);
    return NextResponse.json(data);
  } catch (error) {
    console.error('GET /api/memory-drift error:', error);
    return NextResponse.json({ error: 'Failed to read memory drift report' }, { status: 500 });
  }
}

