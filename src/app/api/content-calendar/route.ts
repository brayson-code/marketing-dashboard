import { NextRequest, NextResponse } from 'next/server';
import { sql, tenantId } from '@/lib/db/client';
import { requireApiUser } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  const auth = requireApiUser(request as Request);
  if (auth) return auth;

  // Note: seed filtering is a no-op (no seed_registry table in Supabase).
  const items = await sql()`
    SELECT id, platform, format, pillar, text_preview, status, scheduled_for
    FROM content_posts
    WHERE tenant_id = ${tenantId()}
      AND status IN ('draft', 'ready', 'scheduled', 'needs_review')
    ORDER BY
      CASE status
        WHEN 'scheduled' THEN 1
        WHEN 'ready' THEN 2
        WHEN 'needs_review' THEN 3
        WHEN 'draft' THEN 4
      END,
      scheduled_for ASC,
      created_at DESC
    LIMIT 20
  `;

  return NextResponse.json({ items });
}

export const dynamic = 'force-dynamic';
