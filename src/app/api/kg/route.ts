import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';
import { listEntities, neighborsOf, remember } from '@/lib/kg';
import { sql, tenantId } from '@/lib/db/client';
import { getPlan } from '@/lib/entitlements';
import { planAllowsKg } from '@/lib/plan-gate';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  enterTenant(await resolveTenant());

  // Defense-in-depth plan gate: the UI already blocks access via UpgradeGate,
  // but we must also refuse at the API level so a lite tenant can't read KG
  // data by calling the endpoint directly or via a stale client-side render.
  const plan = await getPlan();
  if (!planAllowsKg(plan, tenantId())) {
    return NextResponse.json(
      { error: 'Knowledge Graph is a Pro feature. Upgrade at /billing.' },
      { status: 403 },
    );
  }
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') ?? undefined;
  const search = url.searchParams.get('q') ?? undefined;
  const entityId = url.searchParams.get('id');

  if (entityId) {
    const id = Number(entityId);
    const rows = await sql()`
      SELECT * FROM kg_entities WHERE id = ${id} AND tenant_id = ${tenantId()}
    `;
    const ent = rows[0];
    if (!ent) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
    return NextResponse.json({ entity: ent, neighbors: await neighborsOf(id) });
  }

  const entities = await listEntities({ kind, search });
  const counts = await sql()`
    SELECT kind, COUNT(*) as n FROM kg_entities
    WHERE tenant_id = ${tenantId()}
    GROUP BY kind ORDER BY n DESC
  `;
  const relRows = await sql()`
    SELECT COUNT(*) as n FROM kg_relations WHERE tenant_id = ${tenantId()}
  `;
  const relationCount = Number(relRows[0].n);
  const relations = await sql()`
    SELECT from_id, to_id, label FROM kg_relations WHERE tenant_id = ${tenantId()}
  `;
  return NextResponse.json({ entities, counts, relationCount, relations });
}

export async function POST(request: Request) {
  enterTenant(await resolveTenant());

  const plan = await getPlan();
  if (!planAllowsKg(plan, tenantId())) {
    return NextResponse.json(
      { error: 'Knowledge Graph is a Pro feature. Upgrade at /billing.' },
      { status: 403 },
    );
  }

  let body: { entities?: unknown[]; relations?: unknown[] };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const result = await remember(body as Parameters<typeof remember>[0]);
  return NextResponse.json({ ok: true, ...result });
}
