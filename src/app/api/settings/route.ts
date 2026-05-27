import { NextResponse } from 'next/server';
import { sql, tenantId } from '@/lib/db/client';
import { requireApiUser } from '@/lib/api-auth';

const TABLE_NAMES = [
  'content_posts',
  'leads',
  'sequences',
  'suppression',
  'engagements',
  'signals',
  'experiments',
  'learnings',
  'daily_metrics',
  'activity_log',
  'notifications',
] as const;

export async function GET(request: Request) {
  const auth = requireApiUser(request as Request);
  if (auth) return auth;
  try {
    const s = sql();

    // Total DB size (whole Postgres database), reported in MB.
    let db_size_mb = 0;
    try {
      const sizeRows = await s`SELECT pg_database_size(current_database()) AS bytes`;
      db_size_mb = Number(sizeRows[0]?.bytes ?? 0) / (1024 * 1024);
    } catch {
      // size unavailable
    }

    // Per-tenant row counts for each table.
    const tables = await Promise.all(
      TABLE_NAMES.map(async (name) => {
        try {
          const rows = await s`
            SELECT COUNT(*) as c FROM ${s(name)} WHERE tenant_id = ${tenantId()}
          `;
          return { name, count: Number(rows[0]?.c ?? 0) };
        } catch {
          return { name, count: 0 };
        }
      }),
    );

    // No seed_registry table in Supabase — seed concept is a no-op.
    const seed_count = 0;

    return NextResponse.json({
      db_size_mb,
      tables,
      last_sync: null,
      seed_count,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to get settings' }, { status: 500 });
  }
}
