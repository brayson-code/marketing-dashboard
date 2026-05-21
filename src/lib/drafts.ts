import { sql, jsonb, DEFAULT_TENANT_ID } from './db/client';

export type DraftType = 'content_post' | 'email' | 'meeting' | 'campaign' | 'other';
export type DraftStatus = 'pending' | 'approved' | 'rejected' | 'published' | 'sent' | 'confirmed' | 'expired';

export interface DraftRow {
  id: number;
  type: DraftType;
  title: string;
  payload: string;
  status: DraftStatus;
  created_by: string | null;
  created_at: Date;
  reviewed_at: Date | null;
  executed_at: Date | null;
  execution_note: string | null;
  metadata: Record<string, unknown> | null;
}

const VALID_TYPES: ReadonlyArray<DraftType> = ['content_post', 'email', 'meeting', 'campaign', 'other'];

export async function createDraft(input: {
  type: DraftType;
  title: string;
  payload: string;
  createdBy?: string;
  metadata?: Record<string, unknown>;
}): Promise<DraftRow> {
  if (!VALID_TYPES.includes(input.type)) {
    throw new Error(`Invalid draft type: ${input.type}`);
  }
  const rows = await sql()`
    INSERT INTO agent_drafts (tenant_id, type, title, payload, status, created_by, metadata)
    VALUES (
      ${DEFAULT_TENANT_ID}, ${input.type}, ${input.title}, ${input.payload}, 'pending',
      ${input.createdBy ?? null}, ${input.metadata ? jsonb(input.metadata) : null}
    )
    RETURNING *
  `;
  return rows[0] as unknown as DraftRow;
}

export async function getDraft(id: number): Promise<DraftRow | undefined> {
  const rows = await sql()`
    SELECT * FROM agent_drafts WHERE id = ${id} AND tenant_id = ${DEFAULT_TENANT_ID}
  `;
  return rows[0] as unknown as DraftRow | undefined;
}

export async function listDrafts(filters: { status?: DraftStatus | 'all'; limit?: number } = {}): Promise<DraftRow[]> {
  const limit = filters.limit ?? 50;
  if (filters.status && filters.status !== 'all') {
    const rows = await sql()`
      SELECT * FROM agent_drafts
      WHERE tenant_id = ${DEFAULT_TENANT_ID} AND status = ${filters.status}
      ORDER BY created_at DESC LIMIT ${limit}
    `;
    return rows as unknown as DraftRow[];
  }
  const rows = await sql()`
    SELECT * FROM agent_drafts
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
    ORDER BY created_at DESC LIMIT ${limit}
  `;
  return rows as unknown as DraftRow[];
}

export async function approveDraft(id: number, note?: string): Promise<DraftRow | undefined> {
  await sql()`
    UPDATE agent_drafts
    SET status = 'approved', reviewed_at = now(), execution_note = COALESCE(${note ?? null}, execution_note)
    WHERE id = ${id} AND tenant_id = ${DEFAULT_TENANT_ID} AND status = 'pending'
  `;
  return getDraft(id);
}

export async function rejectDraft(id: number, note?: string): Promise<DraftRow | undefined> {
  await sql()`
    UPDATE agent_drafts
    SET status = 'rejected', reviewed_at = now(), execution_note = COALESCE(${note ?? null}, execution_note)
    WHERE id = ${id} AND tenant_id = ${DEFAULT_TENANT_ID} AND status = 'pending'
  `;
  return getDraft(id);
}

export interface ExecuteResult {
  ok: boolean;
  draft?: DraftRow;
  error?: string;
}

/**
 * Mark an approved draft as executed. In V1 we don't actually post/send — we just
 * flip the status so the system tracks intent + auditability. Real external API
 * wiring (X, LinkedIn, Gmail, Google Calendar) goes here later.
 */
async function executeApproved(id: number, executedStatus: DraftStatus, note?: string): Promise<ExecuteResult> {
  const draft = await getDraft(id);
  if (!draft) return { ok: false, error: `Draft ${id} not found` };
  if (draft.status !== 'approved') {
    return { ok: false, error: `Draft ${id} is ${draft.status}, must be 'approved' before execution` };
  }
  await sql()`
    UPDATE agent_drafts
    SET status = ${executedStatus}, executed_at = now(), execution_note = COALESCE(${note ?? null}, execution_note)
    WHERE id = ${id} AND tenant_id = ${DEFAULT_TENANT_ID}
  `;
  return { ok: true, draft: await getDraft(id) };
}

export async function publishContent(id: number, note?: string): Promise<ExecuteResult> {
  // TODO: wire actual platform APIs (X, LinkedIn, IG, FB, YouTube)
  return executeApproved(id, 'published', note ?? '(simulated — no external API wired yet)');
}

export async function sendEmail(id: number, note?: string): Promise<ExecuteResult> {
  // TODO: wire Gmail / SMTP
  return executeApproved(id, 'sent', note ?? '(simulated — no external API wired yet)');
}

export async function confirmMeeting(id: number, note?: string): Promise<ExecuteResult> {
  // TODO: wire Google Calendar
  return executeApproved(id, 'confirmed', note ?? '(simulated — no external API wired yet)');
}
