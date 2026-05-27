import { NextRequest, NextResponse } from 'next/server';
import { sql, tenantId } from '@/lib/db/client';
import { requireApiUser } from '@/lib/api-auth';

const STAGE_ORDER = ['new', 'enriched', 'scored', 'sequenced', 'contacted', 'replied', 'interested', 'booked'];
const STAGE_COLORS: Record<string, string> = {
  new: '#6366f1',
  enriched: '#8b5cf6',
  scored: '#a78bfa',
  sequenced: '#f59e0b',
  contacted: '#f97316',
  replied: '#22c55e',
  interested: '#10b981',
  booked: '#059669',
};

const STAGE_LABELS: Record<string, string> = {
  new: 'New',
  enriched: 'Enriched',
  scored: 'Scored',
  sequenced: 'Sequenced',
  contacted: 'Contacted',
  replied: 'Replied',
  interested: 'Interested',
  booked: 'Booked',
};

export async function GET(request: NextRequest) {
  const auth = requireApiUser(request as Request);
  if (auth) return auth;

  // Note: seed filtering is a no-op (no seed_registry table in Supabase).
  const rows = await sql()`
    SELECT status, COUNT(*) as count FROM leads
    WHERE tenant_id = ${tenantId()}
    GROUP BY status
  ` as unknown as Array<{ status: string; count: string }>;

  const countMap: Record<string, number> = {};
  for (const row of rows) {
    countMap[row.status] = Number(row.count);
  }

  const stages = STAGE_ORDER.map(status => ({
    label: STAGE_LABELS[status] || status,
    count: countMap[status] || 0,
    color: STAGE_COLORS[status] || '#6b7280',
  }));

  // Only include stages that have at least 1 lead or are key stages
  const keyStages = new Set(['new', 'sequenced', 'replied', 'interested', 'booked']);
  const filteredStages = stages.filter(s => s.count > 0 || keyStages.has(STAGE_ORDER[stages.indexOf(s)]));

  return NextResponse.json({ stages: filteredStages });
}

export const dynamic = 'force-dynamic';
