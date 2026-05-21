import { sql, DEFAULT_TENANT_ID } from './db/client';
// createNotification lives in ./notifications (Supabase-backed, no better-sqlite3)
// and is re-exported here for existing callers.
export { createNotification } from './notifications';
import type {
  ContentPost, Lead, Sequence, Suppression, Engagement,
  Signal, Experiment, Learning, DailyMetrics, ActivityEntry,
  OverviewStats, Alert, FunnelStep, WeeklyKPI, Notification,
} from '@/types';

// ─── Overview ──────────────────────────────────────────
export async function getOverviewStats(_filters?: { excludeSeed?: boolean }): Promise<OverviewStats> {
  const s = sql();
  const today = new Date().toISOString().slice(0, 10);

  const [postsRow, engRow, emailsRow, pipelineRow] = await Promise.all([
    s`SELECT COUNT(*) AS c FROM content_posts
        WHERE tenant_id = ${DEFAULT_TENANT_ID}
        AND (published_at::date = ${today}::date OR created_at::date = ${today}::date)`,
    s`SELECT COUNT(*) AS c FROM engagements
        WHERE tenant_id = ${DEFAULT_TENANT_ID} AND created_at::date = ${today}::date`,
    s`SELECT COUNT(*) AS c FROM sequences
        WHERE tenant_id = ${DEFAULT_TENANT_ID} AND status = 'sent' AND sent_at::date = ${today}::date`,
    s`SELECT COUNT(*) AS c FROM leads
        WHERE tenant_id = ${DEFAULT_TENANT_ID} AND status IN ('interested', 'booked')`,
  ]);

  return {
    posts_today: Number(postsRow[0]?.c ?? 0),
    engagement_today: Number(engRow[0]?.c ?? 0),
    emails_sent: Number(emailsRow[0]?.c ?? 0),
    pipeline_count: Number(pipelineRow[0]?.c ?? 0),
  };
}

export async function getAlerts(_filters?: { excludeSeed?: boolean }): Promise<Alert[]> {
  const s = sql();
  const alerts: Alert[] = [];

  // Bounce rate check
  const metricsRows = await s`
    SELECT sends, bounces FROM daily_metrics
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
    ORDER BY date DESC LIMIT 1
  ` as unknown as { sends: number; bounces: number }[];
  const metrics = metricsRows[0];
  if (metrics && metrics.sends > 0 && (metrics.bounces / metrics.sends) > 0.03) {
    alerts.push({
      id: 'bounce-rate',
      type: 'error',
      message: `Bounce rate at ${((metrics.bounces / metrics.sends) * 100).toFixed(1)}% — exceeds 3% threshold`,
      created_at: new Date().toISOString(),
    });
  }

  // Pending approvals > 24h
  const staleRows = await s`
    SELECT COUNT(*) AS c FROM content_posts
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
    AND status = 'pending_approval'
    AND created_at < now() - interval '24 hours'
  `;
  const stale = Number(staleRows[0]?.c ?? 0);
  if (stale > 0) {
    alerts.push({
      id: 'stale-approvals',
      type: 'warning',
      message: `${stale} content item(s) pending approval for >24 hours`,
      created_at: new Date().toISOString(),
    });
  }

  // Stale email approvals
  const staleEmailRows = await s`
    SELECT COUNT(*) AS c FROM sequences
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
    AND status = 'pending_approval'
    AND created_at < now() - interval '24 hours'
  `;
  const staleEmails = Number(staleEmailRows[0]?.c ?? 0);
  if (staleEmails > 0) {
    alerts.push({
      id: 'stale-email-approvals',
      type: 'warning',
      message: `${staleEmails} email draft(s) pending approval for >24 hours`,
      created_at: new Date().toISOString(),
    });
  }

  // High engagement signal (viral)
  const viralRows = await s`
    SELECT summary FROM signals
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
    AND relevance = 'high' AND created_at::date = now()::date
    ORDER BY created_at DESC LIMIT 1
  ` as unknown as { summary: string }[];
  const viral = viralRows[0];
  if (viral) {
    alerts.push({
      id: 'viral-signal',
      type: 'info',
      message: `High-relevance signal: ${viral.summary?.slice(0, 80)}...`,
      created_at: new Date().toISOString(),
    });
  }

  // Webhook-pushed notifications (unread, last 24h)
  const notifications = await s`
    SELECT id, severity, title, message, created_at FROM notifications
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
    AND read = false AND created_at > now() - interval '24 hours'
    ORDER BY created_at DESC LIMIT 10
  ` as unknown as { id: number; severity: string; title: string | null; message: string; created_at: Date }[];
  for (const n of notifications) {
    alerts.push({
      id: `notif-${n.id}`,
      type: (n.severity === 'error' ? 'error' : n.severity === 'warning' ? 'warning' : 'info') as Alert['type'],
      message: n.title ? `${n.title}: ${n.message}` : n.message,
      created_at: typeof n.created_at === 'string' ? n.created_at : (n.created_at as Date).toISOString(),
    });
  }

  return alerts;
}

// ─── Content ───────────────────────────────────────────
export async function getContentPosts(filters?: {
  status?: string;
  platform?: string;
  pillar?: number;
  excludeSeed?: boolean;
}): Promise<ContentPost[]> {
  const s = sql();
  const rows = await s`
    SELECT * FROM content_posts
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
    ${filters?.status ? s`AND status = ${filters.status}` : s``}
    ${filters?.platform ? s`AND platform = ${filters.platform}` : s``}
    ${filters?.pillar ? s`AND pillar = ${filters.pillar}` : s``}
    ORDER BY created_at DESC
  `;
  return rows as unknown as ContentPost[];
}

export async function updateContentStatus(id: string, status: string): Promise<void> {
  await sql()`
    UPDATE content_posts SET status = ${status}
    WHERE id = ${id} AND tenant_id = ${DEFAULT_TENANT_ID}
  `;
}

// ─── Leads ─────────────────────────────────────────────
const LEAD_SORT_COLS = ['score', 'created_at', 'last_touch_at', 'company'] as const;

export async function getLeads(filters?: {
  status?: string;
  tier?: string;
  segment?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  excludeSeed?: boolean;
}): Promise<Lead[]> {
  const s = sql();
  const sortCol = (LEAD_SORT_COLS as ReadonlyArray<string>).includes(filters?.sort || '')
    ? (filters!.sort as string)
    : 'created_at';
  const order = filters?.order === 'asc' ? 'asc' : 'desc';

  const rows = await s`
    SELECT * FROM leads
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
    ${filters?.status ? s`AND status = ${filters.status}` : s``}
    ${filters?.tier ? s`AND tier = ${filters.tier}` : s``}
    ${filters?.segment ? s`AND industry_segment = ${filters.segment}` : s``}
    ORDER BY ${s(sortCol)} ${order === 'asc' ? s`ASC` : s`DESC`}
  `;
  return rows as unknown as Lead[];
}

export async function updateLeadStatus(id: string, status: string): Promise<void> {
  await sql()`
    UPDATE leads SET status = ${status}, last_touch_at = now()
    WHERE id = ${id} AND tenant_id = ${DEFAULT_TENANT_ID}
  `;
}

export async function getLeadFunnel(_filters?: { excludeSeed?: boolean }): Promise<FunnelStep[]> {
  const s = sql();
  const steps = ["new", "validated", "approved", "contacted", "replied", "interested", "booked", "qualified", "rejected", "disqualified"];
  const rows = await s`
    SELECT status, COUNT(*) AS c FROM leads
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
    GROUP BY status
  ` as unknown as { status: string; c: string }[];
  const counts = new Map(rows.map(r => [r.status, Number(r.c)]));
  return steps.map(name => ({ name, value: counts.get(name) ?? 0 }));
}

// ─── Sequences ─────────────────────────────────────────
export async function getSequences(filters?: { status?: string; lead_id?: string; excludeSeed?: boolean }): Promise<Sequence[]> {
  const s = sql();
  const rows = await s`
    SELECT * FROM sequences
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
    ${filters?.status ? s`AND status = ${filters.status}` : s``}
    ${filters?.lead_id ? s`AND lead_id = ${filters.lead_id}` : s``}
    ORDER BY created_at DESC
  `;
  return rows as unknown as Sequence[];
}

export async function updateSequenceStatus(id: string, status: string): Promise<void> {
  await sql()`
    UPDATE sequences SET status = ${status}
    WHERE id = ${id} AND tenant_id = ${DEFAULT_TENANT_ID}
  `;
}

// ─── Suppression ───────────────────────────────────────
export async function getSuppression(_filters?: { excludeSeed?: boolean }): Promise<Suppression[]> {
  const rows = await sql()`
    SELECT * FROM suppression
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
    ORDER BY added_at DESC
  `;
  return rows as unknown as Suppression[];
}

// ─── Engagement ────────────────────────────────────────
export async function getEngagements(filters?: {
  platform?: string;
  action_type?: string;
  date?: string;
  excludeSeed?: boolean;
}): Promise<Engagement[]> {
  const s = sql();
  const rows = await s`
    SELECT * FROM engagements
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
    ${filters?.platform ? s`AND platform = ${filters.platform}` : s``}
    ${filters?.action_type ? s`AND action_type = ${filters.action_type}` : s``}
    ${filters?.date ? s`AND created_at::date = ${filters.date}::date` : s``}
    ORDER BY created_at DESC LIMIT 200
  `;
  return rows as unknown as Engagement[];
}

// ─── Signals ───────────────────────────────────────────
export async function getSignals(filters?: {
  type?: string;
  relevance?: string;
  date?: string;
  excludeSeed?: boolean;
}): Promise<Signal[]> {
  const s = sql();
  const rows = await s`
    SELECT * FROM signals
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
    ${filters?.type ? s`AND type = ${filters.type}` : s``}
    ${filters?.relevance ? s`AND relevance = ${filters.relevance}` : s``}
    ${filters?.date ? s`AND date = ${filters.date}` : s``}
    ORDER BY created_at DESC LIMIT 200
  `;
  return rows as unknown as Signal[];
}

// ─── Experiments ───────────────────────────────────────
export async function getExperiments(filters?: { status?: string; excludeSeed?: boolean }): Promise<Experiment[]> {
  const s = sql();
  const rows = await s`
    SELECT * FROM experiments
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
    ${filters?.status ? s`AND status = ${filters.status}` : s``}
    ORDER BY week DESC, id DESC
  `;
  return rows as unknown as Experiment[];
}

export async function getLearnings(_filters?: { excludeSeed?: boolean }): Promise<Learning[]> {
  const rows = await sql()`
    SELECT * FROM learnings
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
    ORDER BY validated_week DESC, id DESC
  `;
  return rows as unknown as Learning[];
}

// ─── KPIs ──────────────────────────────────────────────
export async function getDailyMetrics(days: number = 90, _filters?: { excludeSeed?: boolean }): Promise<DailyMetrics[]> {
  const rows = await sql()`
    SELECT * FROM daily_metrics
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
    ORDER BY date DESC LIMIT ${days}
  `;
  return rows as unknown as DailyMetrics[];
}

export async function getWeeklyKPIs(weeks: number = 12, _filters?: { excludeSeed?: boolean }): Promise<WeeklyKPI[]> {
  const metrics = await sql()`
    SELECT * FROM daily_metrics
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
    ORDER BY date DESC LIMIT ${weeks * 7}
  ` as unknown as DailyMetrics[];

  // Group by ISO week
  const weekMap = new Map<string, DailyMetrics[]>();
  for (const m of metrics) {
    const d = new Date(m.date);
    const week = getISOWeek(d);
    const key = `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
    if (!weekMap.has(key)) weekMap.set(key, []);
    weekMap.get(key)!.push(m);
  }

  return Array.from(weekMap.entries()).map(([week, days]) => {
    const totalSends = days.reduce((s, d) => s + d.sends, 0);
    const totalReplies = days.reduce((s, d) => s + d.replies_triaged, 0);
    const totalImpressions = days.reduce((s, d) => s + d.total_impressions, 0);
    const totalEngagement = days.reduce((s, d) => s + d.total_engagement, 0);

    return {
      week,
      leads_added: days.reduce((s, d) => s + d.discoveries, 0),
      emails_sent: totalSends,
      reply_rate: totalSends > 0 ? (totalReplies / totalSends) * 100 : 0,
      positive_reply_rate: 0,
      calls_booked: 0,
      sqls: 0,
      impressions: totalImpressions,
      engagement_rate: totalImpressions > 0 ? (totalEngagement / totalImpressions) * 100 : 0,
    };
  }).slice(0, weeks);
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// ─── Activity Log ──────────────────────────────────────
export async function getActivityLog(filters?: {
  action?: string;
  limit?: number;
  excludeSeed?: boolean;
}): Promise<ActivityEntry[]> {
  const s = sql();
  const limit = filters?.limit ?? 100;
  const rows = await s`
    SELECT * FROM activity_log
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
    ${filters?.action ? s`AND action = ${filters.action}` : s``}
    ORDER BY ts DESC LIMIT ${limit}
  `;
  return rows as unknown as ActivityEntry[];
}

// ─── Notifications ────────────────────────────────────
// createNotification was moved to ./notifications and is re-exported at the top
// of this file, so it can be imported without pulling in better-sqlite3.

export async function getNotifications(filters?: {
  unread_only?: boolean;
  type?: string;
  limit?: number;
}): Promise<Notification[]> {
  const s = sql();
  const limit = filters?.limit ?? 50;
  const rows = await s`
    SELECT * FROM notifications
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
    ${filters?.unread_only ? s`AND read = false` : s``}
    ${filters?.type ? s`AND type = ${filters.type}` : s``}
    ORDER BY created_at DESC LIMIT ${limit}
  ` as unknown as (Omit<Notification, 'data' | 'read'> & { data: Record<string, unknown> | null; read: boolean })[];
  // jsonb `data` comes back already parsed; `read` is a real boolean.
  return rows.map(r => ({
    ...r,
    read: r.read === true,
    data: r.data ?? null,
  })) as unknown as Notification[];
}

export async function markNotificationRead(id: number): Promise<void> {
  await sql()`
    UPDATE notifications SET read = true
    WHERE id = ${id} AND tenant_id = ${DEFAULT_TENANT_ID}
  `;
}

export async function markAllNotificationsRead(): Promise<void> {
  await sql()`
    UPDATE notifications SET read = true
    WHERE tenant_id = ${DEFAULT_TENANT_ID} AND read = false
  `;
}

// ─── Seed Registry ────────────────────────────────────────
// There is NO seed_registry table in Supabase. The seed concept is a no-op now:
// nothing is treated as a seed record, so `excludeSeed` filters become empty.
export async function isSeedRecord(_tableName: string, _recordId: string): Promise<boolean> {
  return false;
}

export async function getSeedCount(): Promise<number> {
  return 0;
}

/** Returns SQL fragment to exclude seeded records — always empty (no seed_registry). */
export function seedFilter(_tableName: string, _idColumn: string = 'id'): string {
  return '';
}
