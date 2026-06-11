// Competitor watchlist + watched-reels store (Competitor Intel).
//
// A tenant watches competitor handles (per platform) on a daily/weekly cadence;
// a background checker (dueCompetitors → fetch → upsertReel) pulls their recent
// reels into competitor_reels for transcribe → analyze → script. Ad-hoc pastes
// (no watched competitor) also land in competitor_reels with a NULL competitor_id.
//
// Single-tenant-scoped: every query filters tenant_id = tenantId() since the
// backend role bypasses RLS. Timestamps go OUT as epoch-seconds (extract(epoch)),
// matching the other libs (see agentmail-inboxes.ts).

import { sql, jsonb, tenantId } from './db/client';

export interface Competitor {
  id: number;
  platform: string;
  handle: string;
  display_name: string | null;
  enabled: boolean;
  schedule: string;
  last_checked_at: number | null;
  created_at: number;
}

export interface ReelRow {
  id: number;
  competitor_id: number | null;
  platform: string;
  external_id: string | null;
  url: string;
  caption: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  posted_at: number | null;
  thumbnail_url: string | null;
  video_url: string | null;
  transcript: string | null;
  analysis: Record<string, unknown> | null;
  script_draft_id: number | null;
  status: string;
  created_at: number;
}

// ── Competitors ───────────────────────────────────────────────────────────────
// SELECTs spell out every column inline (like roi.ts / agentmail-inboxes.ts) so
// timestamps come back as epoch-seconds via extract(epoch ...)::int. int8 counts
// (views/likes/comments/script_draft_id) are cast ::float8 so postgres.js returns
// them as JS numbers, not strings — small counts stay exact.

/** Every watched competitor for the current tenant (newest first). */
export async function listCompetitors(): Promise<Competitor[]> {
  const rows = (await sql()`
    SELECT id, platform, handle, display_name, enabled, schedule,
           extract(epoch from last_checked_at)::int AS last_checked_at,
           extract(epoch from created_at)::int AS created_at
    FROM public.competitors
    WHERE tenant_id = ${tenantId()}
    ORDER BY created_at DESC
  `) as unknown as Competitor[];
  return rows;
}

/** Add (or re-adopt) a watched competitor. Upserts on (tenant_id, platform, handle):
 *  a re-add updates display_name/schedule and re-enables the row. */
export async function addCompetitor(input: {
  handle: string;
  platform?: string;
  display_name?: string;
  schedule?: string;
}): Promise<Competitor> {
  const platform = input.platform ?? 'instagram';
  const schedule = input.schedule ?? 'daily';
  const rows = (await sql()`
    INSERT INTO public.competitors (tenant_id, platform, handle, display_name, schedule)
    VALUES (${tenantId()}, ${platform}, ${input.handle}, ${input.display_name ?? null}, ${schedule})
    ON CONFLICT (tenant_id, platform, handle) DO UPDATE SET
      display_name = COALESCE(${input.display_name ?? null}, public.competitors.display_name),
      schedule = ${schedule},
      enabled = true
    RETURNING id, platform, handle, display_name, enabled, schedule,
              extract(epoch from last_checked_at)::int AS last_checked_at,
              extract(epoch from created_at)::int AS created_at
  `) as unknown as Competitor[];
  return rows[0];
}

/** Stop watching a competitor (delete the row). Its reels keep competitor_id NULL'd
 *  by the FK ON DELETE SET NULL. */
export async function removeCompetitor(id: number): Promise<void> {
  await sql()`
    DELETE FROM public.competitors
    WHERE tenant_id = ${tenantId()} AND id = ${id}
  `;
}

/** Patch a competitor's enabled/schedule/display_name. Returns the updated row,
 *  or null when it doesn't belong to this tenant. */
export async function setCompetitor(
  id: number,
  fields: { enabled?: boolean; schedule?: string; display_name?: string },
): Promise<Competitor | null> {
  const rows = (await sql()`
    UPDATE public.competitors SET
      enabled = COALESCE(${fields.enabled ?? null}, enabled),
      schedule = COALESCE(${fields.schedule ?? null}, schedule),
      display_name = COALESCE(${fields.display_name ?? null}, display_name)
    WHERE tenant_id = ${tenantId()} AND id = ${id}
    RETURNING id, platform, handle, display_name, enabled, schedule,
              extract(epoch from last_checked_at)::int AS last_checked_at,
              extract(epoch from created_at)::int AS created_at
  `) as unknown as Competitor[];
  return rows[0] ?? null;
}

/** Stamp a competitor as just-checked (last_checked_at = SQL now()). */
export async function markChecked(id: number): Promise<void> {
  await sql()`
    UPDATE public.competitors SET last_checked_at = now()
    WHERE tenant_id = ${tenantId()} AND id = ${id}
  `;
}

/** Competitors due for a re-check: enabled, schedule != 'off', and never checked
 *  OR last checked older than the schedule interval (daily = 1 day, weekly = 7 days).
 *  Interval arithmetic runs in SQL so it's against the DB clock. */
export async function dueCompetitors(): Promise<Competitor[]> {
  const rows = (await sql()`
    SELECT id, platform, handle, display_name, enabled, schedule,
           extract(epoch from last_checked_at)::int AS last_checked_at,
           extract(epoch from created_at)::int AS created_at
    FROM public.competitors
    WHERE tenant_id = ${tenantId()}
      AND enabled = true
      AND schedule <> 'off'
      AND (
        last_checked_at IS NULL
        OR (schedule = 'daily'  AND last_checked_at < now() - interval '1 day')
        OR (schedule = 'weekly' AND last_checked_at < now() - interval '7 days')
      )
    ORDER BY last_checked_at ASC NULLS FIRST
  `) as unknown as Competitor[];
  return rows;
}

// ── Reels ─────────────────────────────────────────────────────────────────────
// Same inline-column convention: epoch-second timestamps + ::float8 int8 counts.

/** Store/refresh a reel. When external_id is present, upserts on
 *  (tenant_id, platform, external_id) — re-fetching a known reel refreshes its
 *  metrics/caption without clobbering downstream work (transcript/analysis/status).
 *  Without an external_id (e.g. a raw ad-hoc paste) it always inserts a new row. */
export async function upsertReel(input: Partial<ReelRow> & { url: string }): Promise<ReelRow> {
  const platform = input.platform ?? 'instagram';
  const analysis = input.analysis !== undefined ? jsonb(input.analysis) : null;

  if (input.external_id) {
    const rows = (await sql()`
      INSERT INTO public.competitor_reels (
        tenant_id, competitor_id, platform, external_id, url, caption,
        views, likes, comments, posted_at, thumbnail_url, video_url,
        transcript, analysis, script_draft_id, status
      ) VALUES (
        ${tenantId()}, ${input.competitor_id ?? null}, ${platform}, ${input.external_id}, ${input.url}, ${input.caption ?? null},
        ${input.views ?? null}, ${input.likes ?? null}, ${input.comments ?? null},
        ${input.posted_at != null ? new Date(input.posted_at * 1000) : null},
        ${input.thumbnail_url ?? null}, ${input.video_url ?? null},
        ${input.transcript ?? null}, ${analysis}, ${input.script_draft_id ?? null},
        ${input.status ?? 'fetched'}
      )
      ON CONFLICT (tenant_id, platform, external_id) DO UPDATE SET
        competitor_id = COALESCE(EXCLUDED.competitor_id, public.competitor_reels.competitor_id),
        url           = EXCLUDED.url,
        caption       = COALESCE(EXCLUDED.caption, public.competitor_reels.caption),
        views         = COALESCE(EXCLUDED.views, public.competitor_reels.views),
        likes         = COALESCE(EXCLUDED.likes, public.competitor_reels.likes),
        comments      = COALESCE(EXCLUDED.comments, public.competitor_reels.comments),
        posted_at     = COALESCE(EXCLUDED.posted_at, public.competitor_reels.posted_at),
        thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, public.competitor_reels.thumbnail_url),
        video_url     = COALESCE(EXCLUDED.video_url, public.competitor_reels.video_url)
      RETURNING id, competitor_id, platform, external_id, url, caption,
                views::float8 AS views, likes::float8 AS likes, comments::float8 AS comments,
                extract(epoch from posted_at)::int AS posted_at,
                thumbnail_url, video_url, transcript, analysis,
                script_draft_id::float8 AS script_draft_id, status,
                extract(epoch from created_at)::int AS created_at
    `) as unknown as ReelRow[];
    return rows[0];
  }

  const rows = (await sql()`
    INSERT INTO public.competitor_reels (
      tenant_id, competitor_id, platform, external_id, url, caption,
      views, likes, comments, posted_at, thumbnail_url, video_url,
      transcript, analysis, script_draft_id, status
    ) VALUES (
      ${tenantId()}, ${input.competitor_id ?? null}, ${platform}, ${null}, ${input.url}, ${input.caption ?? null},
      ${input.views ?? null}, ${input.likes ?? null}, ${input.comments ?? null},
      ${input.posted_at != null ? new Date(input.posted_at * 1000) : null},
      ${input.thumbnail_url ?? null}, ${input.video_url ?? null},
      ${input.transcript ?? null}, ${analysis}, ${input.script_draft_id ?? null},
      ${input.status ?? 'fetched'}
    )
    RETURNING id, competitor_id, platform, external_id, url, caption,
              views::float8 AS views, likes::float8 AS likes, comments::float8 AS comments,
              extract(epoch from posted_at)::int AS posted_at,
              thumbnail_url, video_url, transcript, analysis,
              script_draft_id::float8 AS script_draft_id, status,
              extract(epoch from created_at)::int AS created_at
  `) as unknown as ReelRow[];
  return rows[0];
}

/** Stored reels for the current tenant (newest first), optionally for one
 *  competitor. limit defaults to 50, capped at 200. */
export async function listReels(opts?: { competitor_id?: number; limit?: number }): Promise<ReelRow[]> {
  const limit = Math.min(opts?.limit ?? 50, 200);
  const cid = opts?.competitor_id ?? null; // null → all of the tenant's reels
  const rows = (await sql()`
    SELECT id, competitor_id, platform, external_id, url, caption,
           views::float8 AS views, likes::float8 AS likes, comments::float8 AS comments,
           extract(epoch from posted_at)::int AS posted_at,
           thumbnail_url, video_url, transcript, analysis,
           script_draft_id::float8 AS script_draft_id, status,
           extract(epoch from created_at)::int AS created_at
    FROM public.competitor_reels
    WHERE tenant_id = ${tenantId()}
      AND (${cid}::bigint IS NULL OR competitor_id = ${cid})
    ORDER BY created_at DESC
    LIMIT ${limit}
  `) as unknown as ReelRow[];
  return rows;
}

/** One reel by id (current tenant), or null. */
export async function getReel(id: number): Promise<ReelRow | null> {
  const rows = (await sql()`
    SELECT id, competitor_id, platform, external_id, url, caption,
           views::float8 AS views, likes::float8 AS likes, comments::float8 AS comments,
           extract(epoch from posted_at)::int AS posted_at,
           thumbnail_url, video_url, transcript, analysis,
           script_draft_id::float8 AS script_draft_id, status,
           extract(epoch from created_at)::int AS created_at
    FROM public.competitor_reels
    WHERE tenant_id = ${tenantId()} AND id = ${id}
  `) as unknown as ReelRow[];
  return rows[0] ?? null;
}

/** Patch a reel's pipeline fields (transcript/analysis/script_draft_id/status) or
 *  refreshed metrics. Returns the updated row, or null when it doesn't belong to
 *  this tenant. */
export async function updateReel(
  id: number,
  fields: Partial<Pick<ReelRow, 'transcript' | 'analysis' | 'script_draft_id' | 'status' | 'views' | 'likes' | 'comments'>>,
): Promise<ReelRow | null> {
  const analysis = fields.analysis !== undefined ? jsonb(fields.analysis) : null;
  const rows = (await sql()`
    UPDATE public.competitor_reels SET
      transcript      = COALESCE(${fields.transcript ?? null}, transcript),
      analysis        = COALESCE(${analysis}, analysis),
      script_draft_id = COALESCE(${fields.script_draft_id ?? null}, script_draft_id),
      status          = COALESCE(${fields.status ?? null}, status),
      views           = COALESCE(${fields.views ?? null}, views),
      likes           = COALESCE(${fields.likes ?? null}, likes),
      comments        = COALESCE(${fields.comments ?? null}, comments)
    WHERE tenant_id = ${tenantId()} AND id = ${id}
    RETURNING id, competitor_id, platform, external_id, url, caption,
              views::float8 AS views, likes::float8 AS likes, comments::float8 AS comments,
              extract(epoch from posted_at)::int AS posted_at,
              thumbnail_url, video_url, transcript, analysis,
              script_draft_id::float8 AS script_draft_id, status,
              extract(epoch from created_at)::int AS created_at
  `) as unknown as ReelRow[];
  return rows[0] ?? null;
}
