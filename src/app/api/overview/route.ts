import { NextRequest, NextResponse } from 'next/server';
import { getOverviewStats, getAlerts, getActivityLog, getDailyMetrics } from '@/lib/queries';
import { sql, tenantId } from '@/lib/db/client';
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

// Note: seed filtering is a no-op (no seed_registry table in Supabase).
async function getAgentBriefs(): Promise<AgentBrief[]> {
  const s = sql();

  return Promise.all(
    getAgents().map(async (agent) => {
      // Find actions mapped to this agent
      const agentActions = Object.entries(ACTION_TO_AGENT)
        .filter(([, v]) => v.agent === agent.id)
        .map(([k]) => k);

      let actionsToday = 0;
      let lastAction: string | undefined;
      let lastActionAt: string | undefined;

      if (agentActions.length > 0) {
        const [countRows, lastRows] = await Promise.all([
          s`SELECT COUNT(*) as c FROM activity_log
            WHERE tenant_id = ${tenantId()}
              AND action IN ${s(agentActions)} AND ts::date = now()::date`,
          s`SELECT action, detail, ts FROM activity_log
            WHERE tenant_id = ${tenantId()}
              AND action IN ${s(agentActions)} ORDER BY ts DESC LIMIT 1`,
        ]);
        actionsToday = Number(countRows[0]?.c ?? 0);
        const lastRow = lastRows[0] as unknown as { action: string; detail: string; ts: string } | undefined;
        if (lastRow) {
          lastAction = lastRow.detail || lastRow.action;
          lastActionAt = typeof lastRow.ts === 'string' ? lastRow.ts : new Date(lastRow.ts).toISOString();
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
    }),
  );
}

// Note: seed filtering is a no-op (no seed_registry table in Supabase).
async function getActionItems(): Promise<ActionItem[]> {
  const s = sql();
  const items: ActionItem[] = [];

  // Pending content approvals
  const contentPending = await s`
    SELECT id, platform, text_preview, pillar, created_at FROM content_posts
    WHERE tenant_id = ${tenantId()} AND status = 'pending_approval'
    ORDER BY created_at ASC
  ` as unknown as { id: string; platform: string; text_preview: string | null; pillar: number | null; created_at: string }[];

  for (const c of contentPending) {
    items.push({
      id: c.id,
      type: 'content',
      title: c.text_preview?.slice(0, 60) || 'Untitled content',
      subtitle: `${c.platform} draft`,
      created_at: typeof c.created_at === 'string' ? c.created_at : new Date(c.created_at).toISOString(),
    });
  }

  // Pending sequence approvals
  const seqPending = await s`
    SELECT seq.id, seq.subject, seq.step, seq.sequence_name, seq.tier, seq.created_at,
           l.first_name, l.last_name, l.company
    FROM sequences seq
    LEFT JOIN leads l ON seq.lead_id = l.id AND l.tenant_id = ${tenantId()}
    WHERE seq.tenant_id = ${tenantId()} AND seq.status = 'pending_approval'
    ORDER BY seq.created_at ASC
  ` as unknown as {
    id: string; subject: string | null; step: number; sequence_name: string | null;
    tier: string | null; created_at: string; first_name: string | null;
    last_name: string | null; company: string | null;
  }[];

  for (const seq of seqPending) {
    items.push({
      id: seq.id,
      type: 'sequence',
      title: seq.subject || `Step ${seq.step}`,
      subtitle: [seq.first_name, seq.last_name].filter(Boolean).join(' ') + (seq.company ? ` at ${seq.company}` : ''),
      tier: seq.tier || undefined,
      created_at: typeof seq.created_at === 'string' ? seq.created_at : new Date(seq.created_at).toISOString(),
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
  const agents = await getAgentBriefs();
  const action_items = await getActionItems();

  return NextResponse.json({ stats, alerts, recentActivity, metrics, agents, action_items });
}
