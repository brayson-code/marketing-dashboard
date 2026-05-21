import { NextResponse } from 'next/server';
import { sql, DEFAULT_TENANT_ID } from '@/lib/db/client';
import { requireApiUser } from '@/lib/api-auth';

export async function GET(request: Request) {
  const auth = requireApiUser(request);
  if (auth) return auth;
  try {
    const s = sql();

    const [
      totalRow, draftRow, pendingRow, readyRow, publishedRow,
      published30Row, impressions30Row, avgEngagementRow,
    ] = await Promise.all([
      s`SELECT COUNT(*) as c FROM content_posts WHERE tenant_id = ${DEFAULT_TENANT_ID}`,
      s`SELECT COUNT(*) as c FROM content_posts WHERE tenant_id = ${DEFAULT_TENANT_ID} AND status = 'draft'`,
      s`SELECT COUNT(*) as c FROM content_posts WHERE tenant_id = ${DEFAULT_TENANT_ID} AND status = 'pending_approval'`,
      s`SELECT COUNT(*) as c FROM content_posts WHERE tenant_id = ${DEFAULT_TENANT_ID} AND status = 'ready'`,
      s`SELECT COUNT(*) as c FROM content_posts WHERE tenant_id = ${DEFAULT_TENANT_ID} AND status = 'published'`,
      s`SELECT COUNT(*) as c FROM content_posts
        WHERE tenant_id = ${DEFAULT_TENANT_ID} AND status = 'published'
          AND published_at::date >= (now() - interval '30 days')::date`,
      s`SELECT SUM(impressions) as v FROM content_posts
        WHERE tenant_id = ${DEFAULT_TENANT_ID} AND status = 'published'
          AND published_at::date >= (now() - interval '30 days')::date`,
      s`SELECT AVG(engagement_rate) as v FROM content_posts
        WHERE tenant_id = ${DEFAULT_TENANT_ID} AND status = 'published'
          AND published_at::date >= (now() - interval '30 days')::date`,
    ]);

    const total = Number(totalRow[0]?.c ?? 0);
    const draft = Number(draftRow[0]?.c ?? 0);
    const pending = Number(pendingRow[0]?.c ?? 0);
    const ready = Number(readyRow[0]?.c ?? 0);
    const published = Number(publishedRow[0]?.c ?? 0);
    const published30 = Number(published30Row[0]?.c ?? 0);
    const impressions30 = Number(impressions30Row[0]?.v ?? 0);
    const avgEngagement = avgEngagementRow[0]?.v != null ? Number(avgEngagementRow[0].v) : null;

    const approvalRate = total > 0 ? (ready + published) / total : 0;

    return NextResponse.json({
      total,
      draft,
      pending,
      ready,
      published,
      published_last_30: published30,
      impressions_last_30: impressions30,
      avg_engagement_rate: avgEngagement,
      approval_rate: approvalRate,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
