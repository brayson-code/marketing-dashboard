import { NextRequest, NextResponse } from 'next/server';
import { sql, DEFAULT_TENANT_ID } from '@/lib/db/client';
import { getAgents, ACTION_TO_AGENT } from '@/lib/agent-config';
import type { AgentStatus, AgentStats, ActivityEntry } from '@/types';
import fs from 'fs';
import path from 'path';
import { requireApiUser } from '@/lib/api-auth';
import { getInstance, resolveOpenClawPaths } from '@/lib/instances';

export const dynamic = 'force-dynamic';

interface AgentModelConfig {
  primary: string;
  fallbacks: string[];
}

interface UsageTotals {
  tokens_today: number;
  tokens_week: number;
  cost_today: number;
  cost_week: number;
}

function getInstanceIdFromRequest(req: NextRequest): string | null {
  try {
    const url = new URL(req.url);
    return url.searchParams.get('instance') || url.searchParams.get('namespace');
  } catch {
    return null;
  }
}

function getAgentModelRouting(openclawConfigPath: string, agentId: string): AgentModelConfig | null {
  try {
    if (!fs.existsSync(openclawConfigPath)) return null;
    const raw = fs.readFileSync(openclawConfigPath, 'utf-8');
    const config = JSON.parse(raw) as {
      agents?: {
        defaults?: { model?: unknown };
        list?: Array<{ id?: string; model?: unknown }>;
      };
    };
    const defaults = config.agents?.defaults?.model;
    const list = config.agents?.list ?? [];
    const agent = list.find((a) => a.id === agentId);
    const selected = agent?.model ?? defaults;

    if (!selected) return null;

    if (typeof selected === 'string') {
      return { primary: selected, fallbacks: [] };
    }

    if (typeof selected === 'object' && selected !== null) {
      const model = selected as { primary?: unknown; fallbacks?: unknown };
      const primary = typeof model.primary === 'string' ? model.primary : null;
      const fallbacks = Array.isArray(model.fallbacks)
        ? model.fallbacks.filter((m): m is string => typeof m === 'string')
        : [];
      if (primary) return { primary, fallbacks };
    }
  } catch {
    return null;
  }
  return null;
}

function getUsageTotals(agentsDir: string, agentId: string): UsageTotals {
  const out: UsageTotals = {
    tokens_today: 0,
    tokens_week: 0,
    cost_today: 0,
    cost_week: 0,
  };

  const sessionsDir = path.join(agentsDir, agentId, 'sessions');
  if (!fs.existsSync(sessionsDir)) return out;

  const now = Date.now();
  const todayStr = new Date(now).toISOString().slice(0, 10);
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.jsonl'));
  for (const file of files) {
    const filePath = path.join(sessionsDir, file);
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as {
          type?: string;
          timestamp?: string;
          message?: {
            role?: string;
            usage?: {
              totalTokens?: number;
              cost?: { total?: number };
            };
          };
        };
        if (entry.type !== 'message') continue;
        if (entry.message?.role !== 'assistant') continue;
        if (!entry.timestamp) continue;

        const ts = new Date(entry.timestamp).getTime();
        if (Number.isNaN(ts)) continue;

        const tokens = Math.max(0, Number(entry.message?.usage?.totalTokens ?? 0));
        const cost = Math.max(0, Number(entry.message?.usage?.cost?.total ?? 0));
        const date = entry.timestamp.slice(0, 10);

        if (date === todayStr) {
          out.tokens_today += tokens;
          out.cost_today += cost;
        }
        if (ts >= weekAgo) {
          out.tokens_week += tokens;
          out.cost_week += cost;
        }
      } catch {
        // ignore malformed lines
      }
    }
  }

  return out;
}

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;

  const instanceId = getInstanceIdFromRequest(req);
  const instance = getInstance(instanceId);
  const { openclawConfigPath, agentsDir } = resolveOpenClawPaths(instance);

  const s = sql();
  const now = Date.now();
  // Note: seed filtering is a no-op (no seed_registry table in Supabase).

  const agents = await Promise.all(
    getAgents(instance.id).map(async (agent) => {
      // Get actions attributable to this agent
      const agentActions = Object.entries(ACTION_TO_AGENT)
        .filter(([, v]) => v.agent === agent.id)
        .map(([action]) => action);

      let todayCount = 0;
      let weekCount = 0;
      let lastActivity: { action: string; detail: string; ts: string } | undefined;
      let skillCounts: { action: string; c: string }[] = [];
      let recentActivity: ActivityEntry[] = [];

      if (agentActions.length > 0) {
        const [todayRows, weekRows, lastRows, skillRows, recentRows] = await Promise.all([
          s`SELECT COUNT(*) as c FROM activity_log
            WHERE tenant_id = ${DEFAULT_TENANT_ID}
              AND action IN ${s(agentActions)} AND ts::date = now()::date`,
          s`SELECT COUNT(*) as c FROM activity_log
            WHERE tenant_id = ${DEFAULT_TENANT_ID}
              AND action IN ${s(agentActions)} AND ts > now() - interval '7 days'`,
          s`SELECT action, detail, ts FROM activity_log
            WHERE tenant_id = ${DEFAULT_TENANT_ID}
              AND action IN ${s(agentActions)} ORDER BY ts DESC LIMIT 1`,
          s`SELECT action, COUNT(*) as c FROM activity_log
            WHERE tenant_id = ${DEFAULT_TENANT_ID}
              AND action IN ${s(agentActions)} AND ts > now() - interval '30 days'
            GROUP BY action ORDER BY c DESC LIMIT 5`,
          s`SELECT id, ts, action, detail, result FROM activity_log
            WHERE tenant_id = ${DEFAULT_TENANT_ID}
              AND action IN ${s(agentActions)} ORDER BY ts DESC LIMIT 10`,
        ]);

        todayCount = Number(todayRows[0]?.c ?? 0);
        weekCount = Number(weekRows[0]?.c ?? 0);
        lastActivity = lastRows[0] as unknown as { action: string; detail: string; ts: string } | undefined;
        skillCounts = skillRows as unknown as { action: string; c: string }[];
        recentActivity = recentRows as unknown as ActivityEntry[];
      }

      const topSkills = skillCounts.map((sc) => ({
        skill: ACTION_TO_AGENT[sc.action]?.skill || sc.action,
        count: Number(sc.c),
      }));

      // Derive status
      let status: AgentStatus = 'planned';
      const lastTs = lastActivity?.ts ? new Date(lastActivity.ts as unknown as string).getTime() : NaN;
      if (Number.isFinite(lastTs)) {
        const elapsed = now - lastTs;
        if (elapsed < 30 * 60 * 1000) status = 'active';
        else if (elapsed < 24 * 60 * 60 * 1000) status = 'idle';
      }

      const lastActionAt = lastActivity?.ts
        ? (typeof lastActivity.ts === 'string' ? lastActivity.ts : new Date(lastActivity.ts).toISOString())
        : null;

      const stats: AgentStats = {
        actions_today: todayCount,
        actions_week: weekCount,
        tokens_today: 0,
        tokens_week: 0,
        cost_today: 0,
        cost_week: 0,
        last_action: lastActivity?.detail || null,
        last_action_at: lastActionAt,
        top_skills: topSkills,
      };

      const usage = getUsageTotals(agentsDir, agent.id);
      stats.tokens_today = usage.tokens_today;
      stats.tokens_week = usage.tokens_week;
      stats.cost_today = usage.cost_today;
      stats.cost_week = usage.cost_week;

      const modelRouting = getAgentModelRouting(openclawConfigPath, agent.id);

      return {
        ...agent,
        model: modelRouting?.primary ?? agent.model,
        fallbacks: modelRouting?.fallbacks ?? agent.fallbacks,
        status,
        stats,
        recent_activity: recentActivity,
      };
    }),
  );

  return NextResponse.json(agents);
}

