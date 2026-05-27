import { NextResponse } from 'next/server';
import { sql, tenantId } from '@/lib/db/client';
import { requireApiUser } from '@/lib/api-auth';

export async function GET(request: Request) {
  const auth = requireApiUser(request);
  if (auth) return auth;
  try {
    const rows = await sql()`
      SELECT id, ts, action, detail, result
      FROM activity_log
      WHERE tenant_id = ${tenantId()}
        AND action IN ('outreach_paused', 'outreach_resumed')
      ORDER BY ts DESC
      LIMIT 50
    `;

    return NextResponse.json({ history: rows });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
