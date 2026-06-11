// Trial Reel Generator store — fresh, testable short-form reel CONCEPTS the
// client curates (hook / angle / format). The reel-ideator sub-agent produces a
// batch; the client keeps or dismisses each, then optionally turns a kept idea
// into a script draft.
//
// Single-tenant-scoped: every query filters tenant_id = tenantId() since the
// backend role bypasses RLS. Timestamps go OUT as epoch-seconds (extract(epoch))
// and int8 script_draft_id is cast ::float8 so postgres.js returns it as a JS
// number — both matching competitors.ts.

import { randomUUID } from 'node:crypto';
import { sql, tenantId } from './db/client';

export interface ReelIdea {
  id: number;
  hook: string;
  angle: string;
  format: string;
  rationale: string;
  trend_tag: string | null;
  status: string;
  script_draft_id: number | null;
  created_at: number;
}

// SELECTs spell out every column inline (like competitors.ts) so created_at comes
// back as epoch-seconds via extract(epoch ...)::int and the int8 script_draft_id
// is cast ::float8 (returned as a JS number, not a string).

/** Reel ideas for the current tenant (newest first), optionally filtered by
 *  status. limit defaults to 60, capped at 200. */
export async function listIdeas(opts?: { status?: string; limit?: number }): Promise<ReelIdea[]> {
  const limit = Math.min(opts?.limit ?? 60, 200);
  const status = opts?.status ?? null; // null → every status
  const rows = (await sql()`
    SELECT id, hook, angle, format, rationale, trend_tag, status,
           script_draft_id::float8 AS script_draft_id,
           extract(epoch from created_at)::int AS created_at
    FROM public.reel_ideas
    WHERE tenant_id = ${tenantId()}
      AND (${status}::text IS NULL OR status = ${status})
    ORDER BY created_at DESC
    LIMIT ${limit}
  `) as unknown as ReelIdea[];
  return rows;
}

/** Insert a batch of fresh ideas (one generate() run). They share one batch_id and
 *  start at status 'proposed'. Returns the inserted rows (newest first). */
export async function insertIdeas(
  items: Array<Omit<ReelIdea, 'id' | 'status' | 'script_draft_id' | 'created_at'>>,
): Promise<ReelIdea[]> {
  if (items.length === 0) return [];
  const batchId = randomUUID();
  const tid = tenantId();
  // postgres.js's `sql(objects)` helper expands the array into a multi-row VALUES
  // list in one round-trip; the columns are taken from the object keys. We tack
  // the shared tenant_id + batch_id onto each object so they ride along.
  const records = items.map((it) => ({
    tenant_id: tid,
    hook: it.hook,
    angle: it.angle,
    format: it.format,
    rationale: it.rationale,
    trend_tag: it.trend_tag ?? null,
    batch_id: batchId,
  }));
  const rows = (await sql()`
    INSERT INTO public.reel_ideas ${sql()(records, 'tenant_id', 'hook', 'angle', 'format', 'rationale', 'trend_tag', 'batch_id')}
    RETURNING id, hook, angle, format, rationale, trend_tag, status,
              script_draft_id::float8 AS script_draft_id,
              extract(epoch from created_at)::int AS created_at
  `) as unknown as ReelIdea[];
  // Newest first, matching listIdeas() ordering.
  return rows.slice().reverse();
}

/** Set an idea's status ('kept' | 'dismissed' | 'proposed'). Returns the updated
 *  row, or null when it doesn't belong to this tenant. */
export async function setIdeaStatus(id: number, status: string): Promise<ReelIdea | null> {
  const rows = (await sql()`
    UPDATE public.reel_ideas SET status = ${status}
    WHERE tenant_id = ${tenantId()} AND id = ${id}
    RETURNING id, hook, angle, format, rationale, trend_tag, status,
              script_draft_id::float8 AS script_draft_id,
              extract(epoch from created_at)::int AS created_at
  `) as unknown as ReelIdea[];
  return rows[0] ?? null;
}

/** One idea by id (current tenant), or null. */
export async function getIdea(id: number): Promise<ReelIdea | null> {
  const rows = (await sql()`
    SELECT id, hook, angle, format, rationale, trend_tag, status,
           script_draft_id::float8 AS script_draft_id,
           extract(epoch from created_at)::int AS created_at
    FROM public.reel_ideas
    WHERE tenant_id = ${tenantId()} AND id = ${id}
  `) as unknown as ReelIdea[];
  return rows[0] ?? null;
}

/** Attach a generated script draft to an idea. Returns the updated row, or null
 *  when it doesn't belong to this tenant. */
export async function setIdeaScript(id: number, draftId: number): Promise<ReelIdea | null> {
  const rows = (await sql()`
    UPDATE public.reel_ideas SET script_draft_id = ${draftId}
    WHERE tenant_id = ${tenantId()} AND id = ${id}
    RETURNING id, hook, angle, format, rationale, trend_tag, status,
              script_draft_id::float8 AS script_draft_id,
              extract(epoch from created_at)::int AS created_at
  `) as unknown as ReelIdea[];
  return rows[0] ?? null;
}
