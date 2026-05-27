// Time-saved + ROI tracker (KeyCommand V2, Track A).
// The Key Audit (revenue/profit/hours/admin%) yields the owner's $/hr; every agent
// action logs an estimated minutes-saved (from editable presets) → hours + dollars
// reclaimed. Numbers start as "projected" (audit only) and become "actual" as the
// time_savings_log fills. Single-tenant (tenantId()), additive tables only.

import { sql, jsonb, tenantId } from './db/client';
import { roleFor } from './constraints';

// Default minutes saved per action type (PRD §8.3). Editable per tenant via key_audit.presets.
export const DEFAULT_PRESETS: Record<string, number> = {
  email_drafted: 8,
  research_summary: 20,
  report_generated: 25,
  crm_update: 5,
  meeting_notes: 15,
  content_draft: 30,
  calendar_scheduled: 5,
  document_summarized: 10,
  outreach_drafted: 8,
  task_completed: 10, // fallback for anything unmapped
};

export interface KeyAudit {
  annual_revenue: number | null;
  annual_profit: number | null;
  hours_per_week: number | null;
  admin_percentage: number | null;
  presets: Record<string, number>;
  updated_at: string | null;
}

export interface RoiSummary {
  audit: KeyAudit;
  hoursSavedAllTime: number;
  hoursSavedThisMonth: number;
  valueReclaimed: number;        // cumulative $ saved
  oldDollarPerHour: number | null;
  newDollarPerHour: number | null;
  projectedAnnualValue: number | null;
  byAgent: Array<{ agent_id: string | null; hours: number; value: number }>;
  byMonth: Array<{ month: string; hours: number; value: number }>;
  hasActuals: boolean;           // false → numbers are projected from the audit only
}

const WEEKS_PER_YEAR = 52;

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The owner's current $/hr (value of their time): annual_profit ÷ annual hours worked. */
export function oldDollarPerHour(a: KeyAudit): number | null {
  if (a.annual_profit == null || !a.hours_per_week) return null;
  const annualHours = a.hours_per_week * WEEKS_PER_YEAR;
  return annualHours > 0 ? a.annual_profit / annualHours : null;
}

/** Projected $/hr after recovering `recoveredHrsPerYear` of admin time. */
export function newDollarPerHour(a: KeyAudit, recoveredHrsPerYear: number): number | null {
  if (a.annual_profit == null || !a.hours_per_week) return null;
  const remaining = (a.hours_per_week * WEEKS_PER_YEAR) - recoveredHrsPerYear;
  return remaining > 0 ? a.annual_profit / remaining : null;
}

export async function getKeyAudit(): Promise<KeyAudit> {
  const rows = (await sql()`
    SELECT annual_revenue, annual_profit, hours_per_week, admin_percentage, presets, updated_at
    FROM public.key_audit WHERE tenant_id = ${tenantId()}
  `) as unknown as Array<Record<string, unknown>>;
  const r = rows[0];
  return {
    annual_revenue: num(r?.annual_revenue),
    annual_profit: num(r?.annual_profit),
    hours_per_week: num(r?.hours_per_week),
    admin_percentage: num(r?.admin_percentage),
    presets: { ...DEFAULT_PRESETS, ...((r?.presets as Record<string, number>) ?? {}) },
    updated_at: r?.updated_at ? new Date(r.updated_at as string).toISOString() : null,
  };
}

export async function saveKeyAudit(input: Partial<Omit<KeyAudit, 'updated_at'>>): Promise<KeyAudit> {
  await sql()`
    INSERT INTO public.key_audit (tenant_id, annual_revenue, annual_profit, hours_per_week, admin_percentage, presets, updated_at)
    VALUES (${tenantId()}, ${input.annual_revenue ?? null}, ${input.annual_profit ?? null},
            ${input.hours_per_week ?? null}, ${input.admin_percentage ?? null},
            ${input.presets ? jsonb(input.presets) : null}, now())
    ON CONFLICT (tenant_id) DO UPDATE SET
      annual_revenue = COALESCE(${input.annual_revenue ?? null}, public.key_audit.annual_revenue),
      annual_profit = COALESCE(${input.annual_profit ?? null}, public.key_audit.annual_profit),
      hours_per_week = COALESCE(${input.hours_per_week ?? null}, public.key_audit.hours_per_week),
      admin_percentage = COALESCE(${input.admin_percentage ?? null}, public.key_audit.admin_percentage),
      presets = COALESCE(${input.presets ? jsonb(input.presets) : null}, public.key_audit.presets),
      updated_at = now()
  `;
  return getKeyAudit();
}

/** Map an agent to the action type it represents (for auto-logged time savings). */
export function actionTypeForAgent(agentId: string): string {
  switch (roleFor(agentId)) {
    case 'research': return 'research_summary';
    case 'content': return 'content_draft';
    case 'outreach': return 'outreach_drafted';
    case 'scheduler': return 'calendar_scheduled';
    default: return 'task_completed';
  }
}

/**
 * Log a time-saving event. minutes defaults to the preset for the action type.
 * dollar value uses the owner's current $/hr (stable, value-of-their-time). Idempotent
 * per task (unique index) — safe to call on every agent completion. Best-effort.
 */
export async function logTimeSaving(input: {
  actionType: string;
  agentId?: string | null;
  minutes?: number;
  source?: string;
  taskId?: number | null;
}): Promise<void> {
  const audit = await getKeyAudit();
  const minutes = input.minutes ?? audit.presets[input.actionType] ?? DEFAULT_PRESETS.task_completed;
  const rate = oldDollarPerHour(audit) ?? 0;
  const dollars = (minutes / 60) * rate;
  await sql()`
    INSERT INTO public.time_savings_log (tenant_id, agent_id, action_type, minutes_saved, dollar_value_saved, source, task_id)
    VALUES (${tenantId()}, ${input.agentId ?? null}, ${input.actionType}, ${minutes}, ${dollars},
            ${input.source ?? 'agent'}, ${input.taskId ?? null})
    ON CONFLICT (tenant_id, task_id) WHERE task_id IS NOT NULL DO NOTHING
  `;
}

export async function getRoiSummary(): Promise<RoiSummary> {
  const audit = await getKeyAudit();

  const totals = (await sql()`
    SELECT
      COALESCE(SUM(minutes_saved), 0) AS all_min,
      COALESCE(SUM(minutes_saved) FILTER (WHERE logged_at >= date_trunc('month', now())), 0) AS month_min,
      COALESCE(SUM(dollar_value_saved), 0) AS value,
      COUNT(*) AS n
    FROM public.time_savings_log WHERE tenant_id = ${tenantId()}
  `) as unknown as Array<{ all_min: string; month_min: string; value: string; n: string }>;
  const allMin = Number(totals[0]?.all_min ?? 0);
  const monthMin = Number(totals[0]?.month_min ?? 0);
  const valueReclaimed = Number(totals[0]?.value ?? 0);
  const hasActuals = Number(totals[0]?.n ?? 0) > 0;

  const hoursSavedAllTime = allMin / 60;
  const hoursSavedThisMonth = monthMin / 60;

  const old = oldDollarPerHour(audit);
  const neu = newDollarPerHour(audit, hoursSavedAllTime);
  // Projected annual value = this-month hours × 12 × new $/hr.
  const projectedAnnualValue = neu != null ? hoursSavedThisMonth * 12 * neu : null;

  const agents = (await sql()`
    SELECT agent_id, COALESCE(SUM(minutes_saved),0) AS min, COALESCE(SUM(dollar_value_saved),0) AS value
    FROM public.time_savings_log WHERE tenant_id = ${tenantId()}
    GROUP BY agent_id ORDER BY min DESC LIMIT 12
  `) as unknown as Array<{ agent_id: string | null; min: string; value: string }>;

  const months = (await sql()`
    SELECT to_char(date_trunc('month', logged_at), 'YYYY-MM') AS month,
           COALESCE(SUM(minutes_saved),0) AS min, COALESCE(SUM(dollar_value_saved),0) AS value
    FROM public.time_savings_log WHERE tenant_id = ${tenantId()}
      AND logged_at >= date_trunc('month', now()) - interval '5 months'
    GROUP BY 1 ORDER BY 1
  `) as unknown as Array<{ month: string; min: string; value: string }>;

  return {
    audit,
    hoursSavedAllTime,
    hoursSavedThisMonth,
    valueReclaimed,
    oldDollarPerHour: old,
    newDollarPerHour: neu,
    projectedAnnualValue,
    byAgent: agents.map((a) => ({ agent_id: a.agent_id, hours: Number(a.min) / 60, value: Number(a.value) })),
    byMonth: months.map((m) => ({ month: m.month, hours: Number(m.min) / 60, value: Number(m.value) })),
    hasActuals,
  };
}
