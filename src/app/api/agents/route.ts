import { NextResponse } from 'next/server';
import { getSquad } from '@/lib/squad';

export const dynamic = 'force-dynamic';

// The real agent roster (orchestrator + sub-agents) with live stats from
// agent_tasks, via the shared squad helper. Replaces the legacy version that
// read OpenClaw config + per-agent usage files from the server filesystem.
// Returns a flat array (the shape existing consumers expect). Auth is enforced
// by the Supabase middleware.
export async function GET() {
  const squad = await getSquad();
  const agents = squad.map((a) => ({
    id: a.id,
    name: a.name,
    emoji: a.emoji,
    role: a.role,
    model: a.model,
    description: a.description,
    status: a.status,
    stats: {
      actions_today: 0,
      actions_week: a.stats.runs,
      tokens_today: 0,
      tokens_week: a.stats.total_tokens,
      cost_today: 0,
      cost_week: 0,
      last_action: a.stats.last_status,
      last_action_at: a.stats.last_active ? new Date(a.stats.last_active * 1000).toISOString() : null,
      top_skills: [],
    },
    recent_activity: [],
  }));
  return NextResponse.json(agents);
}
