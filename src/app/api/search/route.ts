import { NextRequest, NextResponse } from 'next/server';
import { sql, DEFAULT_TENANT_ID } from '@/lib/db/client';
import { requireApiUser } from '@/lib/api-auth';

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q || q.length < 2) return NextResponse.json({ results: [] });

  const s = sql();
  const like = `%${q}%`;

  // Note: seed filtering is a no-op (no seed_registry table in Supabase).
  // Search across multiple tables, return unified results
  const [leads, content, signals, experiments, activity] = await Promise.all([
    s`
      SELECT id, first_name || ' ' || last_name AS title, company AS subtitle,
             'lead' AS category, status, tier
      FROM leads
      WHERE tenant_id = ${DEFAULT_TENANT_ID}
        AND (first_name || ' ' || last_name ILIKE ${like} OR company ILIKE ${like} OR email ILIKE ${like})
      LIMIT 5
    `,
    s`
      SELECT id, text_preview AS title, platform || ' · ' || format AS subtitle,
             'content' AS category, status
      FROM content_posts
      WHERE tenant_id = ${DEFAULT_TENANT_ID} AND text_preview ILIKE ${like}
      LIMIT 5
    `,
    s`
      SELECT id, summary AS title, username AS subtitle,
             'signal' AS category, type AS status, relevance AS tier
      FROM signals
      WHERE tenant_id = ${DEFAULT_TENANT_ID}
        AND (summary ILIKE ${like} OR username ILIKE ${like})
      LIMIT 5
    `,
    s`
      SELECT id, hypothesis AS title, 'Week ' || week AS subtitle,
             'experiment' AS category, status
      FROM experiments
      WHERE tenant_id = ${DEFAULT_TENANT_ID}
        AND (hypothesis ILIKE ${like} OR action ILIKE ${like})
      LIMIT 3
    `,
    s`
      SELECT id, detail AS title, action AS subtitle,
             'activity' AS category, action AS status
      FROM activity_log
      WHERE tenant_id = ${DEFAULT_TENANT_ID}
        AND (detail ILIKE ${like} OR result ILIKE ${like})
      ORDER BY ts DESC
      LIMIT 3
    `,
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = [...leads, ...content, ...signals, ...experiments, ...activity] as any[];
  return NextResponse.json({ results });
}
