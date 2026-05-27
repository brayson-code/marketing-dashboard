import { NextRequest, NextResponse } from 'next/server';
import { sql, tenantId } from '@/lib/db/client';
import { requireApiUser } from '@/lib/api-auth';

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req as unknown as Request);
  if (auth) return auth;
  try {
    // Note: seed filtering is a no-op (no seed_registry table in Supabase).
    const s = sql();

    // content_posts has no image_url column in Supabase; return null for compatibility.
    const content = await s`
      SELECT id, platform, format, pillar, text_preview, full_content, status,
             scheduled_for, published_at, created_at, NULL AS image_url
      FROM content_posts
      WHERE tenant_id = ${tenantId()} AND status = 'pending_approval'
      ORDER BY created_at ASC
    ` as unknown as {
      id: string;
      platform: string;
      format: string;
      pillar: number | null;
      text_preview: string | null;
      full_content: string | null;
      status: string;
      scheduled_for: string | null;
      published_at: string | null;
      created_at: string;
      image_url: string | null;
    }[];

    const sequences = await s`
      SELECT s.id, s.lead_id, s.sequence_name, s.step, s.subject, s.body, s.status,
             s.tier, s.created_at, l.first_name, l.last_name, l.company
      FROM sequences s
      LEFT JOIN leads l ON s.lead_id = l.id AND l.tenant_id = ${tenantId()}
      WHERE s.tenant_id = ${tenantId()} AND s.status = 'pending_approval'
      ORDER BY s.created_at ASC
    ` as unknown as {
      id: string;
      lead_id: string | null;
      sequence_name: string | null;
      step: number | null;
      subject: string | null;
      body: string | null;
      status: string | null;
      tier: string | null;
      created_at: string;
      first_name: string | null;
      last_name: string | null;
      company: string | null;
    }[];

    return NextResponse.json({
      content,
      sequences,
      total: content.length + sequences.length,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
