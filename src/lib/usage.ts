import { sql, DEFAULT_TENANT_ID } from './db/client';

// Anthropic pricing per 1M tokens (cached 2026-04-15 — refresh from platform.claude.com)
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-7': { input: 5.0, output: 25.0 },
  'claude-opus-4-6': { input: 5.0, output: 25.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
};

// Map agent_id → assumed model (KeyPlayer + sub-agents). Keep in sync with subagent.ts SUBAGENT_REGISTRY.
const AGENT_MODEL: Record<string, string> = {
  keyplayer: 'claude-sonnet-4-6',
  'research-analyst': 'claude-sonnet-4-6',
  'content-writer': 'claude-sonnet-4-6',
  'outreach-sender': 'claude-sonnet-4-6',
  'calendar-scheduler': 'claude-haiku-4-5',
  'memory-compactor': 'claude-haiku-4-5',
  'lead-research': 'claude-sonnet-4-6',
  'thumbnail-generator': 'claude-haiku-4-5',
  'hyperframes-agent': 'claude-sonnet-4-6',
};

function modelFor(agentId: string): string {
  return AGENT_MODEL[agentId] ?? 'claude-sonnet-4-6';
}

function costFor(agentId: string, input: number, output: number): number {
  const p = PRICING[modelFor(agentId)] ?? PRICING['claude-sonnet-4-6'];
  return (input / 1_000_000) * p.input + (output / 1_000_000) * p.output;
}

/** Estimate USD cost for a given model + token counts. Reused for per-message cost. */
export function estimateCostUsd(model: string, input: number, output: number): number {
  const p = PRICING[model] ?? PRICING['claude-sonnet-4-6'];
  return (input / 1_000_000) * p.input + (output / 1_000_000) * p.output;
}

export interface DailyUsage {
  day: string; // YYYY-MM-DD
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  calls: number;
}

export interface AgentUsage {
  agent_id: string;
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  avg_duration_sec: number;
}

/** Per-agent daily token series — one entry per (agent, day) over the window. */
export interface AgentDailyPoint {
  day: string; // YYYY-MM-DD
  input_tokens: number;
  output_tokens: number;
  tokens: number; // input + output
  cost_usd: number;
}

export interface AgentDailyUsage {
  agent_id: string;
  model: string;
  total_tokens: number;
  total_cost_usd: number;
  days: AgentDailyPoint[];
}

export interface UsageLimit {
  used: number;
  limit: number;
  pct: number; // 0..(>100), used/limit * 100
}

export interface UsageLimits {
  daily: UsageLimit;
  weekly: UsageLimit;
}

export interface UsageSummary {
  total: { input_tokens: number; output_tokens: number; cost_usd: number; calls: number };
  by_day: DailyUsage[];
  by_agent: AgentUsage[];
  by_agent_daily: AgentDailyUsage[];
  limits: UsageLimits;
}

const DEFAULT_DAILY_LIMIT = 2_000_000;
const DEFAULT_WEEKLY_LIMIT = 10_000_000;

function envLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function getUsageSummary(days = 14): Promise<UsageSummary> {
  const cutoff = new Date(Date.now() - days * 86_400 * 1000).toISOString();
  const rows = await sql()`
    SELECT agent_id, input_tokens, output_tokens, started_at, completed_at, status
    FROM agent_tasks
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
      AND started_at >= ${cutoff}
      AND status IN ('done', 'error')
  ` as unknown as Array<{
    agent_id: string;
    input_tokens: number | null;
    output_tokens: number | null;
    started_at: Date | string;
    completed_at: Date | string | null;
    status: string;
  }>;

  const byDay = new Map<string, DailyUsage>();
  const byAgent = new Map<string, AgentUsage>();
  // agent_id -> (day -> AgentDailyPoint)
  const byAgentDay = new Map<string, Map<string, AgentDailyPoint>>();
  let totalIn = 0, totalOut = 0, totalCost = 0, totalCalls = 0;

  // Limit windows (UTC, aligned to by_day's UTC day boundaries).
  const todayKey = new Date().toISOString().slice(0, 10);
  const weekCutoffMs = Date.now() - 7 * 86_400 * 1000;
  let todayTokens = 0;
  let weekTokens = 0;

  for (const r of rows) {
    const inTok = Number(r.input_tokens ?? 0);
    const outTok = Number(r.output_tokens ?? 0);
    const cost = costFor(r.agent_id, inTok, outTok);
    const startedMs = new Date(r.started_at).getTime();
    const completedMs = r.completed_at ? new Date(r.completed_at).getTime() : startedMs;
    const day = new Date(startedMs).toISOString().slice(0, 10);
    const dur = (completedMs - startedMs) / 1000; // seconds
    const tok = inTok + outTok;

    if (day === todayKey) todayTokens += tok;
    if (startedMs >= weekCutoffMs) weekTokens += tok;

    const d = byDay.get(day) ?? { day, input_tokens: 0, output_tokens: 0, cost_usd: 0, calls: 0 };
    d.input_tokens += inTok;
    d.output_tokens += outTok;
    d.cost_usd += cost;
    d.calls += 1;
    byDay.set(day, d);

    let agentDays = byAgentDay.get(r.agent_id);
    if (!agentDays) { agentDays = new Map(); byAgentDay.set(r.agent_id, agentDays); }
    const adp = agentDays.get(day) ?? { day, input_tokens: 0, output_tokens: 0, tokens: 0, cost_usd: 0 };
    adp.input_tokens += inTok;
    adp.output_tokens += outTok;
    adp.tokens += tok;
    adp.cost_usd += cost;
    agentDays.set(day, adp);

    const a = byAgent.get(r.agent_id) ?? {
      agent_id: r.agent_id,
      model: modelFor(r.agent_id),
      calls: 0,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
      avg_duration_sec: 0,
    };
    a.calls += 1;
    a.input_tokens += inTok;
    a.output_tokens += outTok;
    a.cost_usd += cost;
    // running average: prev avg * (n-1)/n + new/n
    a.avg_duration_sec = (a.avg_duration_sec * (a.calls - 1) + dur) / a.calls;
    byAgent.set(r.agent_id, a);

    totalIn += inTok;
    totalOut += outTok;
    totalCost += cost;
    totalCalls += 1;
  }

  // Backfill missing days for chart continuity. Build the ordered window of day keys.
  const today = new Date();
  const windowDays: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const day = d.toISOString().slice(0, 10);
    windowDays.push(day);
    if (!byDay.has(day)) byDay.set(day, { day, input_tokens: 0, output_tokens: 0, cost_usd: 0, calls: 0 });
  }
  windowDays.sort((a, b) => a.localeCompare(b)); // ascending

  // Per-agent daily series, backfilled across the full window so each agent
  // sparkline has one point per day (continuous chart).
  const byAgentDaily: AgentDailyUsage[] = [...byAgentDay.entries()].map(([agentId, agentDays]) => {
    let totalTokens = 0;
    let totalCostUsd = 0;
    const series: AgentDailyPoint[] = windowDays.map((day) => {
      const adp = agentDays.get(day);
      if (adp) {
        totalTokens += adp.tokens;
        totalCostUsd += adp.cost_usd;
        return adp;
      }
      return { day, input_tokens: 0, output_tokens: 0, tokens: 0, cost_usd: 0 };
    });
    return {
      agent_id: agentId,
      model: modelFor(agentId),
      total_tokens: totalTokens,
      total_cost_usd: totalCostUsd,
      days: series,
    };
  }).sort((a, b) => b.total_tokens - a.total_tokens);

  // Limits + current usage.
  const dailyLimit = envLimit('USAGE_DAILY_TOKEN_LIMIT', DEFAULT_DAILY_LIMIT);
  const weeklyLimit = envLimit('USAGE_WEEKLY_TOKEN_LIMIT', DEFAULT_WEEKLY_LIMIT);
  const dailyUsed = Number(todayTokens);
  const weeklyUsed = Number(weekTokens);
  const limits: UsageLimits = {
    daily: {
      used: dailyUsed,
      limit: dailyLimit,
      pct: dailyLimit > 0 ? (dailyUsed / dailyLimit) * 100 : 0,
    },
    weekly: {
      used: weeklyUsed,
      limit: weeklyLimit,
      pct: weeklyLimit > 0 ? (weeklyUsed / weeklyLimit) * 100 : 0,
    },
  };

  return {
    total: { input_tokens: totalIn, output_tokens: totalOut, cost_usd: totalCost, calls: totalCalls },
    by_day: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    by_agent: [...byAgent.values()].sort((a, b) => b.cost_usd - a.cost_usd),
    by_agent_daily: byAgentDaily,
    limits,
  };
}
