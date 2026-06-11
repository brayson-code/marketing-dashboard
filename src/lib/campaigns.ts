// Campaigns — the marketer-facing container that wraps Missions, a Goal, channels,
// and a date window. Persisted in `public.mission_campaigns` (migrated separately).
// Missions belong to a campaign via the nullable `wave_runs.campaign_id` column.
//
// All reads/writes are tenant-scoped via `tenantId()`. The backend connects as
// the `postgres` role which BYPASSES RLS, so every query MUST filter by tenant.

import { sql, tenantId } from './db/client';
import { randomUUID } from 'node:crypto';

export type CampaignStatus = 'active' | 'paused' | 'done' | 'archived';

export interface Campaign {
  id: string;
  name: string;
  goal_id: string | null;
  channels: string[];
  starts_at: string | null;
  ends_at: string | null;
  status: CampaignStatus;
  brief: string;
  created_at: string;
  updated_at: string;
  // Rolled-up mission stats (from wave_runs joined on campaign_id).
  mission_count: number;
  mission_done: number;
  mission_running: number;
}

interface CampaignRow {
  id: string;
  name: string;
  goal_id: string | null;
  channels: string[] | null;
  starts_at: Date | null;
  ends_at: Date | null;
  status: CampaignStatus;
  brief: string | null;
  created_at: Date;
  updated_at: Date;
  mission_count: number | string;
  mission_done: number | string;
  mission_running: number | string;
}

function iso(d: Date | null): string | null {
  if (!d) return null;
  return new Date(d).toISOString();
}

function mapCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    name: row.name,
    goal_id: row.goal_id,
    channels: row.channels ?? [],
    starts_at: iso(row.starts_at),
    ends_at: iso(row.ends_at),
    status: row.status,
    brief: row.brief ?? '',
    created_at: iso(row.created_at) ?? new Date().toISOString(),
    updated_at: iso(row.updated_at) ?? new Date().toISOString(),
    mission_count: Number(row.mission_count) || 0,
    mission_done: Number(row.mission_done) || 0,
    mission_running: Number(row.mission_running) || 0,
  };
}

export async function listCampaigns(): Promise<Campaign[]> {
  const rows = (await sql()`
    SELECT c.id, c.name, c.goal_id, c.channels, c.starts_at, c.ends_at, c.status, c.brief,
           c.created_at, c.updated_at,
           COUNT(w.id)::int AS mission_count,
           SUM(CASE WHEN w.status = 'done' THEN 1 ELSE 0 END)::int AS mission_done,
           SUM(CASE WHEN w.status = 'running' THEN 1 ELSE 0 END)::int AS mission_running
    FROM public.mission_campaigns c
    LEFT JOIN public.wave_runs w ON w.tenant_id = c.tenant_id AND w.campaign_id = c.id
    WHERE c.tenant_id = ${tenantId()}
    GROUP BY c.id, c.tenant_id
    ORDER BY c.updated_at DESC
  `) as unknown as CampaignRow[];
  return rows.map(mapCampaign);
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  const rows = (await sql()`
    SELECT c.id, c.name, c.goal_id, c.channels, c.starts_at, c.ends_at, c.status, c.brief,
           c.created_at, c.updated_at,
           COUNT(w.id)::int AS mission_count,
           SUM(CASE WHEN w.status = 'done' THEN 1 ELSE 0 END)::int AS mission_done,
           SUM(CASE WHEN w.status = 'running' THEN 1 ELSE 0 END)::int AS mission_running
    FROM public.mission_campaigns c
    LEFT JOIN public.wave_runs w ON w.tenant_id = c.tenant_id AND w.campaign_id = c.id
    WHERE c.tenant_id = ${tenantId()} AND c.id = ${id}
    GROUP BY c.id, c.tenant_id
  `) as unknown as CampaignRow[];
  if (rows.length === 0) return null;
  return mapCampaign(rows[0]);
}

export async function createCampaign(input: {
  name: string;
  goal_id?: string | null;
  channels?: string[];
  starts_at?: string | null;
  ends_at?: string | null;
  brief?: string;
}): Promise<Campaign> {
  const id = randomUUID().slice(0, 8);
  await sql()`
    INSERT INTO public.mission_campaigns
      (id, tenant_id, name, goal_id, channels, starts_at, ends_at, status, brief)
    VALUES (
      ${id}, ${tenantId()}, ${input.name},
      ${input.goal_id ?? null},
      ${input.channels ?? []},
      ${input.starts_at ?? null},
      ${input.ends_at ?? null},
      'active',
      ${input.brief ?? ''}
    )
  `;
  const c = await getCampaign(id);
  if (!c) throw new Error(`Failed to create campaign ${id}`);
  return c;
}

export async function updateCampaign(
  id: string,
  patch: Partial<{
    name: string;
    goal_id: string | null;
    channels: string[];
    starts_at: string | null;
    ends_at: string | null;
    status: CampaignStatus;
    brief: string;
  }>,
): Promise<Campaign | null> {
  // Use COALESCE so any undefined field in the patch leaves the column unchanged.
  // We pass `null` for "not provided" and the SQL keeps the existing value; the
  // caller must explicitly pass `null` for clear-able columns (goal_id, dates).
  const name = patch.name ?? null;
  const goalIdProvided = Object.prototype.hasOwnProperty.call(patch, 'goal_id');
  const channels = patch.channels ?? null;
  const startsProvided = Object.prototype.hasOwnProperty.call(patch, 'starts_at');
  const endsProvided = Object.prototype.hasOwnProperty.call(patch, 'ends_at');
  const status = patch.status ?? null;
  const brief = patch.brief ?? null;

  const rows = await sql()`
    UPDATE public.mission_campaigns SET
      name       = COALESCE(${name}, name),
      goal_id    = CASE WHEN ${goalIdProvided} THEN ${patch.goal_id ?? null} ELSE goal_id END,
      channels   = COALESCE(${channels}, channels),
      starts_at  = CASE WHEN ${startsProvided} THEN ${patch.starts_at ?? null}::timestamptz ELSE starts_at END,
      ends_at    = CASE WHEN ${endsProvided}   THEN ${patch.ends_at   ?? null}::timestamptz ELSE ends_at   END,
      status     = COALESCE(${status}, status),
      brief      = COALESCE(${brief}, brief),
      updated_at = now()
    WHERE id = ${id} AND tenant_id = ${tenantId()}
    RETURNING id
  `;
  if (rows.length === 0) return null;
  return getCampaign(id);
}

export async function deleteCampaign(id: string): Promise<boolean> {
  const rows = await sql()`
    DELETE FROM public.mission_campaigns
    WHERE id = ${id} AND tenant_id = ${tenantId()}
    RETURNING id
  `;
  return rows.length > 0;
}

export interface CampaignMission {
  id: string;
  title: string;
  status: string;
  current_wave: number;
  total_waves: number;
  updated_at: string;
}

export async function listMissionsForCampaign(id: string): Promise<CampaignMission[]> {
  const rows = (await sql()`
    SELECT id, title, status, current_wave, total_waves, updated_at
    FROM public.wave_runs
    WHERE tenant_id = ${tenantId()} AND campaign_id = ${id}
    ORDER BY updated_at DESC
  `) as unknown as Array<Omit<CampaignMission, 'updated_at'> & { updated_at: Date }>;
  return rows.map((r) => ({ ...r, updated_at: new Date(r.updated_at).toISOString() }));
}
