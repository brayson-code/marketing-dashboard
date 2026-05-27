import { NextResponse } from 'next/server';
import { sql, tenantId } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

// Memory observability over the real Supabase stores: documents + knowledge
// graph + agent_memory rollups. Surfaces volume, low-confidence facts, and
// duplicate candidates (the cloud version of the old OpenClaw memory health).
export async function GET() {
  const t = tenantId();
  try {
    const [docsByStatus, docDupes, kg, kgRelations, kgDupes, kgBySource, mem] = await Promise.all([
      sql()`SELECT status, count(*)::int AS c FROM public.documents WHERE tenant_id = ${t} GROUP BY status`,
      sql()`SELECT count(*)::int AS c FROM (SELECT title FROM public.documents WHERE tenant_id = ${t} GROUP BY lower(title) HAVING count(*) > 1) d`,
      sql()`SELECT count(*)::int AS total, count(*) FILTER (WHERE confidence < 0.6)::int AS low_conf FROM public.kg_entities WHERE tenant_id = ${t}`,
      sql()`SELECT count(*)::int AS total FROM public.kg_relations WHERE tenant_id = ${t}`,
      sql()`SELECT count(*)::int AS c FROM (SELECT name FROM public.kg_entities WHERE tenant_id = ${t} GROUP BY lower(name) HAVING count(*) > 1) e`,
      sql()`SELECT coalesce(source_agent,'unknown') AS source, count(*)::int AS c FROM public.kg_entities WHERE tenant_id = ${t} GROUP BY source_agent ORDER BY c DESC LIMIT 10`,
      sql()`SELECT count(*)::int AS total, max(created_at) AS last FROM public.agent_memory WHERE tenant_id = ${t}`,
    ]) as unknown as [
      Array<{ status: string; c: number }>,
      Array<{ c: number }>,
      Array<{ total: number; low_conf: number }>,
      Array<{ total: number }>,
      Array<{ c: number }>,
      Array<{ source: string; c: number }>,
      Array<{ total: number; last: string | null }>,
    ];

    const docStatus: Record<string, number> = {};
    let docTotal = 0;
    for (const r of docsByStatus) { docStatus[r.status] = r.c; docTotal += r.c; }

    return NextResponse.json({
      documents: {
        total: docTotal,
        raw: docStatus.raw ?? 0,
        wiki: docStatus.wiki ?? 0,
        archived: docStatus.archived ?? 0,
        duplicate_titles: docDupes[0]?.c ?? 0,
      },
      kg: {
        entities: kg[0]?.total ?? 0,
        relations: kgRelations[0]?.total ?? 0,
        low_confidence: kg[0]?.low_conf ?? 0,
        duplicate_names: kgDupes[0]?.c ?? 0,
        by_source: kgBySource,
      },
      memory: {
        rollups: mem[0]?.total ?? 0,
        last_rollup: mem[0]?.last ?? null,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
