// Reel-scan store (Content Lab "Optimize my reel").
//
// A scan is a deep teardown of the owner's OWN short-form reel: scrape +
// transcribe it, pull real IG insights when the account is connected, then spawn
// reel-optimizer to score it, find timestamped weak points, and write
// goal-tailored rewrites. One row per scan, one per (tenant, scan id).
//
// Single-tenant-scoped: every query filters tenant_id = tenantId() since the
// backend role bypasses RLS. Timestamps go OUT as epoch-seconds (extract(epoch)),
// matching the other libs (see competitors.ts). scores/report are jsonb columns,
// written via jsonb() and read back as parsed objects by postgres.js.

import { sql, jsonb, tenantId } from './db/client';

export interface ScanScores {
  voiceImpact: number;
  visualPull: number;
  cognitiveGrip: number;
  emotionalHit: number;
  memorability: number;
}

export interface ScanWeakPoint {
  timestamp: string | null;
  issue: string;
  fix: string;
}

export interface ScanRewrite {
  category: string;
  currently: string;
  suggestion: string;
  expectedImpact: string;
}

export interface ScanReport {
  summary: string;
  verdict: string;
  strengths: string[];
  weakPoints: ScanWeakPoint[];
  rewrites: ScanRewrite[];
}

export interface ReelScan {
  id: number;
  url: string;
  goal: string;
  status: string;
  had_transcript: boolean;
  thumbnail_url: string | null;
  scores: ScanScores | null;
  report: ScanReport | null;
  error: string | null;
  created_at: number;
}

// SELECTs spell out every column inline (like competitors.ts) so timestamps come
// back as epoch-seconds via extract(epoch ...)::int. `transcript` is intentionally
// NOT projected — it can be large and the UI never needs it; the optimizer reads
// it straight off the row it just wrote during runScan.

/** Recent scans for the current tenant (newest first). limit defaults to 50, capped at 200. */
export async function listScans(opts?: { limit?: number }): Promise<ReelScan[]> {
  const limit = Math.min(opts?.limit ?? 50, 200);
  const rows = (await sql()`
    SELECT id, url, goal, status, had_transcript, thumbnail_url, scores, report, error,
           extract(epoch from created_at)::int AS created_at
    FROM public.reel_scans
    WHERE tenant_id = ${tenantId()}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `) as unknown as ReelScan[];
  return rows;
}

/** Open a new scan for the current tenant. Always starts in status 'scanning';
 *  runScan() fills in scores/report (or error) afterward. */
export async function insertScan(input: { url: string; goal: string }): Promise<ReelScan> {
  const rows = (await sql()`
    INSERT INTO public.reel_scans (tenant_id, url, goal, status)
    VALUES (${tenantId()}, ${input.url}, ${input.goal}, 'scanning')
    RETURNING id, url, goal, status, had_transcript, thumbnail_url, scores, report, error,
              extract(epoch from created_at)::int AS created_at
  `) as unknown as ReelScan[];
  return rows[0];
}

/** One scan by id (current tenant), or null. */
export async function getScan(id: number): Promise<ReelScan | null> {
  const rows = (await sql()`
    SELECT id, url, goal, status, had_transcript, thumbnail_url, scores, report, error,
           extract(epoch from created_at)::int AS created_at
    FROM public.reel_scans
    WHERE tenant_id = ${tenantId()} AND id = ${id}
  `) as unknown as ReelScan[];
  return rows[0] ?? null;
}

/** Partial update of a scan's pipeline fields — only the provided fields are set
 *  (COALESCE-style), the rest are left untouched. transcript is also writable here
 *  even though it isn't on ReelScan, so runScan can stash the transcript it pulled.
 *  Returns the updated row, or null when it doesn't belong to this tenant. */
export async function updateScan(
  id: number,
  fields: Partial<Pick<ReelScan, 'status' | 'had_transcript' | 'thumbnail_url' | 'scores' | 'report' | 'error'>> & {
    transcript?: string | null;
  },
): Promise<ReelScan | null> {
  const scores = fields.scores !== undefined ? jsonb(fields.scores) : null;
  const report = fields.report !== undefined ? jsonb(fields.report) : null;
  const rows = (await sql()`
    UPDATE public.reel_scans SET
      status         = COALESCE(${fields.status ?? null}, status),
      had_transcript = COALESCE(${fields.had_transcript ?? null}, had_transcript),
      thumbnail_url  = COALESCE(${fields.thumbnail_url ?? null}, thumbnail_url),
      transcript     = COALESCE(${fields.transcript ?? null}, transcript),
      scores         = COALESCE(${scores}, scores),
      report         = COALESCE(${report}, report),
      error          = COALESCE(${fields.error ?? null}, error)
    WHERE tenant_id = ${tenantId()} AND id = ${id}
    RETURNING id, url, goal, status, had_transcript, thumbnail_url, scores, report, error,
              extract(epoch from created_at)::int AS created_at
  `) as unknown as ReelScan[];
  return rows[0] ?? null;
}
