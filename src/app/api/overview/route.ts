import { NextRequest, NextResponse } from 'next/server';
import { getOverviewStats, getAlerts, getActivityLog, getDailyMetrics } from '@/lib/queries';
import { getDb } from '@/lib/db';
import { getAgents, ACTION_TO_AGENT } from '@/lib/agent-config';
import { requireApiUser } from '@/lib/api-auth';

interface AgentBrief {
  id: string;
  name: string;
  emoji: string;
  status: string;
  model: string;
  last_action?: string;
  last_action_at?: string;
  actions_today: number;
  next_job?: string;
  next_job_time?: string;
}

interface ActionItem {
  id: string;
  type: 'content' | 'sequence';
  title: string;
  subtitle: string;
  tier?: string;
  created_at: string;
}

function getAgentBriefs(excludeSeed: boolean): AgentBrief[] {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  return getAgents().map((agent) => {
    // Find actions mapped to this agent
    const agentActions = Object.entries(ACTION_TO_AGENT)
      .filter(([, v]) => v.agent === agent.id)
      .map(([k]) => k);

    const placeholders = agentActions.map(() => '?').join(',');

    let actionsToday = 0;
    let lastAction: string | undefined;
    let lastActionAt: string | undefined;

    if (agentActions.length > 0) {
      const sf = excludeSeed
        ? ` AND NOT EXISTS (SELECT 1 FROM seed_registry sr WHERE sr.table_name = 'activity_log' AND sr.record_id = CAST(activity_log.id AS TEXT))`
        : '';
      const countRow = db.prepare(
        `SELECT COUNT(*) as c FROM activity_log WHERE action IN (${placeholders}) AND date(ts) = ?${sf}`
      ).get(...agentActions, today) as { c: number };
      actionsToday = countRow?.c ?? 0;

      const lastRow = db.prepare(
        `SELECT action, detail, ts FROM activity_log WHERE action IN (${placeholders})${sf} ORDER BY ts DESC LIMIT 1`
      ).get(...agentActions) as { action: string; detail: string; ts: string } | undefined;
      if (lastRow) {
        lastAction = lastRow.detail || lastRow.action;
        lastActionAt = lastRow.ts;
      }
    }

    // Determine status based on recent activity
    let status = 'planned';
    if (lastActionAt) {
      const hoursSince = (Date.now() - new Date(lastActionAt).getTime()) / (1000 * 60 * 60);
      if (hoursSince < 1) status = 'active';
      else if (hoursSince < 24) status = 'idle';
    }

    // Find next scheduled job
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeMinutes = currentHour * 60 + currentMinute;

    let nextJob: string | undefined;
    let nextJobTime: string | undefined;

    for (const job of agent.cronJobs) {
      // Parse schedule like "8:00 AM", "2:00 PM"
      const match = job.schedule.match(/(\d+):(\d+)\s*(AM|PM)/i);
      if (!match) continue;
      let hours = parseInt(match[1]);
      const minutes = parseInt(match[2]);
      const ampm = match[3].toUpperCase();
      if (ampm === 'PM' && hours < 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;
      const jobTimeMinutes = hours * 60 + minutes;

      if (jobTimeMinutes > currentTimeMinutes) {
        nextJob = job.label;
        nextJobTime = job.schedule;
        break;
      }
    }

    return {
      id: agent.id,
      name: agent.name,
      emoji: agent.emoji,
      status,
      model: agent.model,
      last_action: lastAction,
      last_action_at: lastActionAt,
      actions_today: actionsToday,
      next_job: nextJob,
      next_job_time: nextJobTime,
    };
  });
}

function getActionItems(excludeSeed: boolean): ActionItem[] {
  const db = getDb();
  const items: ActionItem[] = [];

  const sfContent = excludeSeed
    ? `AND NOT EXISTS (SELECT 1 FROM seed_registry sr WHERE sr.table_name = 'content_posts' AND sr.record_id = CAST(id AS TEXT))`
    : '';
  const sfSeq = excludeSeed
    ? `AND NOT EXISTS (SELECT 1 FROM seed_registry sr WHERE sr.table_name = 'sequences' AND sr.record_id = CAST(id AS TEXT))`
    : '';

  // Pending content approvals
  const contentPending = db.prepare(
    `SELECT id, platform, text_preview, pillar, created_at FROM content_posts
     WHERE status = 'pending_approval' ${sfContent}
     ORDER BY created_at ASC`
  ).all() as { id: string; platform: string; text_preview: string | null; pillar: number | null; created_at: string }[];

  for (const c of contentPending) {
    items.push({
      id: c.id,
      type: 'content',
      title: c.text_preview?.slice(0, 60) || 'Untitled content',
      subtitle: `${c.platform} draft`,
      created_at: c.created_at,
    });
  }

  // Pending sequence approvals
  const seqPending = db.prepare(
    `SELECT s.id, s.subject, s.step, s.sequence_name, s.tier, s.created_at,
            l.first_name, l.last_name, l.company
     FROM sequences s
     LEFT JOIN leads l ON s.lead_id = l.id
     WHERE s.status = 'pending_approval' ${sfSeq}
     ORDER BY s.created_at ASC`
  ).all() as {
    id: string; subject: string | null; step: number; sequence_name: string | null;
    tier: string | null; created_at: string; first_name: string | null;
    last_name: string | null; company: string | null;
  }[];

  for (const s of seqPending) {
    items.push({
      id: s.id,
      type: 'sequence',
      title: s.subject || `Step ${s.step}`,
      subtitle: [s.first_name, s.last_name].filter(Boolean).join(' ') + (s.company ? ` at ${s.company}` : ''),
      tier: s.tier || undefined,
      created_at: s.created_at,
    });
  }

  // Sort by created_at (oldest first — most urgent)
  items.sort((a, b) => a.created_at.localeCompare(b.created_at));

  return items;
}

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const real = req.nextUrl.searchParams.get('real') === 'true';
  const stats = await getOverviewStats({ excludeSeed: real });
  const alerts = await getAlerts({ excludeSeed: real });
  const recentActivity = await getActivityLog({ limit: 20, excludeSeed: real });
  const metrics = await getDailyMetrics(84, { excludeSeed: real }); // 12 weeks
  const agents = getAgentBriefs(real);
  const action_items = getActionItems(real);

  return NextResponse.json({ stats, alerts, recentActivity, metrics, agents, action_items });
}
