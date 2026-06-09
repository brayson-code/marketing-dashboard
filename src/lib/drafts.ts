import { sql, jsonb, tenantId } from './db/client';
import { gateOutbound, AutonomyBlockedError } from './autonomy';

export type DraftType = 'content_post' | 'email' | 'meeting' | 'campaign' | 'other';
export type DraftStatus = 'pending' | 'approved' | 'rejected' | 'published' | 'sent' | 'confirmed' | 'expired';

export interface DraftRevalidation {
  // Is the draft still worth acting on against the CURRENT state of goals / what's
  // already shipped? yes = keep, no = stale/superseded, unclear = needs a human.
  still_needed: 'yes' | 'no' | 'unclear';
  superseded: boolean; // already covered by something published/sent/approved
  rationale: string;
  checked_files: string[]; // repo files read (proposals only)
  at: string; // ISO
}

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
  revalidated_at: Date | null;
  revalidation: DraftRevalidation | null;
  updated_at: Date | null;
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

  // Autonomy gate — single chokepoint. Decide BEFORE inserting so observe-mode
  // tenants never accumulate stale drafts.
  const { decision, config } = await gateOutbound(input.type);
  if (decision === 'block') throw new AutonomyBlockedError(input.type);

  // Tag the draft with how it was gated, for the UI to show "auto-run by X" etc.
  const gateMeta = { autonomy_level: config.level, gated_decision: decision };
  const mergedMeta = { ...(input.metadata ?? {}), ...gateMeta };

  const rows = await sql()`
    INSERT INTO agent_drafts (tenant_id, type, title, payload, status, created_by, metadata)
    VALUES (
      ${tenantId()}, ${input.type}, ${input.title}, ${input.payload}, 'pending',
      ${input.createdBy ?? null}, ${jsonb(mergedMeta)}
    )
    RETURNING *
  `;
  const draft = rows[0] as unknown as DraftRow;

  // 'draft' = stop here, owner approves manually (Propose mode, or act_notify
  // for a type the owner kept gated).
  if (decision === 'draft') return draft;

  // 'execute' = auto-approve and run the appropriate executor. The executors
  // currently simulate (no external API wired yet) but flip status correctly,
  // so the audit trail is right when the real APIs land.
  await approveDraft(draft.id, '(auto-approved by autonomy mode)');
  const note = `(auto-executed — autonomy: ${config.level})`;
  switch (input.type) {
    case 'content_post': await publishContent(draft.id, note); break;
    case 'email':        await sendEmail(draft.id, note);      break;
    case 'meeting':      await confirmMeeting(draft.id, note); break;
    // campaign / other have no executor (decide() already returns 'draft' for them).
  }
  return (await getDraft(draft.id)) ?? draft;
}

export async function getDraft(id: number): Promise<DraftRow | undefined> {
  const rows = await sql()`
    SELECT * FROM agent_drafts WHERE id = ${id} AND tenant_id = ${tenantId()}
  `;
  return rows[0] as unknown as DraftRow | undefined;
}

export async function listDrafts(filters: { status?: DraftStatus | 'all'; limit?: number } = {}): Promise<DraftRow[]> {
  const limit = filters.limit ?? 50;
  if (filters.status && filters.status !== 'all') {
    const rows = await sql()`
      SELECT * FROM agent_drafts
      WHERE tenant_id = ${tenantId()} AND status = ${filters.status}
      ORDER BY created_at DESC LIMIT ${limit}
    `;
    return rows as unknown as DraftRow[];
  }
  const rows = await sql()`
    SELECT * FROM agent_drafts
    WHERE tenant_id = ${tenantId()}
    ORDER BY created_at DESC LIMIT ${limit}
  `;
  return rows as unknown as DraftRow[];
}

/**
 * Edit a draft's script text and/or title in place (Script Studio). Tenant-scoped.
 * COALESCE keeps the existing value when a field isn't provided, and stamps
 * updated_at so the UI can show when it was last touched. Returns the fresh row
 * (or undefined if the id isn't this tenant's).
 */
export async function updateDraft(
  id: number,
  fields: { payload?: string; title?: string },
): Promise<DraftRow | undefined> {
  await sql()`
    UPDATE agent_drafts
    SET payload = COALESCE(${fields.payload ?? null}, payload),
        title   = COALESCE(${fields.title ?? null}, title),
        updated_at = now()
    WHERE id = ${id} AND tenant_id = ${tenantId()}
  `;
  return getDraft(id);
}

/**
 * Shallow-merge keys into a draft's metadata jsonb (e.g. the Hyperframes visual
 * composition). `||` merges at the top level, so existing keys are preserved and
 * only the provided ones are overwritten. Tenant-scoped; returns the fresh row.
 */
export async function updateDraftMetadata(
  id: number,
  patch: Record<string, unknown>,
): Promise<DraftRow | undefined> {
  await sql()`
    UPDATE agent_drafts
    SET metadata = COALESCE(metadata, '{}'::jsonb) || ${jsonb(patch)},
        updated_at = now()
    WHERE id = ${id} AND tenant_id = ${tenantId()}
  `;
  return getDraft(id);
}

/**
 * Reel scripts for the Script Studio: Hyperframes-generated reel scripts.
 * A row qualifies when it's a content_post AND any of:
 *   - metadata.format = 'reel'
 *   - metadata.source in ('reel-ideator','reel-intel')
 *   - created_by = 'hyperframes-agent'
 * Newest first, tenant-scoped.
 */
export async function listReelScripts(limit = 60): Promise<DraftRow[]> {
  const rows = await sql()`
    SELECT * FROM agent_drafts
    WHERE tenant_id = ${tenantId()}
      AND type = 'content_post'
      AND (
        metadata->>'format' = 'reel'
        OR metadata->>'source' IN ('reel-ideator', 'reel-intel')
        OR created_by = 'hyperframes-agent'
      )
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows as unknown as DraftRow[];
}

/** Store a triage verdict back onto the draft. Read-only w.r.t. execution. */
export async function saveDraftRevalidation(id: number, verdict: DraftRevalidation): Promise<void> {
  await sql()`
    UPDATE agent_drafts
    SET revalidation = ${jsonb(verdict)}, revalidated_at = now()
    WHERE id = ${id} AND tenant_id = ${tenantId()}
  `;
}

/**
 * Open drafts (pending/approved-but-unexecuted) that the triage sweep should look at,
 * oldest-first, preferring never-triaged ones. Bounded so a sweep fits one invocation.
 */
export async function listDraftsForTriage(limit = 5): Promise<DraftRow[]> {
  const rows = await sql()`
    SELECT * FROM agent_drafts
    WHERE tenant_id = ${tenantId()}
      AND status IN ('pending', 'approved')
    ORDER BY (revalidated_at IS NOT NULL), revalidated_at ASC NULLS FIRST, created_at ASC
    LIMIT ${limit}
  `;
  return rows as unknown as DraftRow[];
}

export async function approveDraft(id: number, note?: string): Promise<DraftRow | undefined> {
  await sql()`
    UPDATE agent_drafts
    SET status = 'approved', reviewed_at = now(), execution_note = COALESCE(${note ?? null}, execution_note)
    WHERE id = ${id} AND tenant_id = ${tenantId()} AND status = 'pending'
  `;
  return getDraft(id);
}

export async function rejectDraft(id: number, note?: string): Promise<DraftRow | undefined> {
  await sql()`
    UPDATE agent_drafts
    SET status = 'rejected', reviewed_at = now(), execution_note = COALESCE(${note ?? null}, execution_note)
    WHERE id = ${id} AND tenant_id = ${tenantId()} AND status = 'pending'
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
    WHERE id = ${id} AND tenant_id = ${tenantId()}
  `;
  return { ok: true, draft: await getDraft(id) };
}

export async function publishContent(id: number, note?: string): Promise<ExecuteResult> {
  const draft = await getDraft(id);
  if (!draft) return { ok: false, error: `Draft ${id} not found` };
  if (draft.status !== 'approved') {
    return { ok: false, error: `Draft ${id} is ${draft.status}, must be 'approved' before execution` };
  }

  // Route by platform — read from metadata.platform (set when the draft was
  // created). Today YouTube + Instagram comment replies are wired end-to-end;
  // other platforms still simulate so the autonomy flow keeps working until
  // those connectors land.
  const meta = (draft.metadata ?? {}) as {
    platform?: string;
    youtube?: { parent_comment_id?: string };
    instagram?: { parent_comment_id?: string };
  };
  const platform = meta.platform;

  if (platform === 'youtube_comment' && meta.youtube?.parent_comment_id) {
    try {
      const { replyToComment } = await import('./youtube');
      const replyId = await replyToComment(meta.youtube.parent_comment_id, draft.payload);
      return await executeApproved(id, 'published', note ?? `YouTube reply ${replyId}`);
    } catch (e) {
      return { ok: false, error: `youtube publish failed: ${(e as Error).message}` };
    }
  }

  if (platform === 'instagram_comment' && meta.instagram?.parent_comment_id) {
    try {
      const { replyToComment } = await import('./instagram');
      const replyId = await replyToComment(meta.instagram.parent_comment_id, draft.payload);
      return await executeApproved(id, 'published', note ?? `Instagram reply ${replyId}`);
    } catch (e) {
      return { ok: false, error: `instagram publish failed: ${(e as Error).message}` };
    }
  }

  // TODO: wire X / LinkedIn / FB once those connectors land.
  return executeApproved(id, 'published', note ?? '(simulated — no external API wired yet)');
}

export async function sendEmail(id: number, note?: string): Promise<ExecuteResult> {
  const draft = await getDraft(id);
  if (!draft) return { ok: false, error: `Draft ${id} not found` };
  if (draft.status !== 'approved') {
    return { ok: false, error: `Draft ${id} is ${draft.status}, must be 'approved' before execution` };
  }

  // Route AgentMail email drafts through the tenant's own AgentMail account.
  // The draft carries the sending inbox (account_id), recipient(s), subject, and
  // — for replies — the threading id + the inbound message_id to mark replied.
  const meta = (draft.metadata ?? {}) as {
    platform?: string;
    agentmail?: { account_id?: string; to?: string[]; subject?: string; in_reply_to?: string; message_id?: string };
  };
  if (meta.platform === 'agentmail' && meta.agentmail?.account_id && (meta.agentmail.to?.length ?? 0) > 0) {
    try {
      const { sendEmail: amSend } = await import('./agentmail');
      const am = meta.agentmail;
      const sent = await amSend(am.account_id!, {
        to: am.to!,
        subject: am.subject || '(no subject)',
        text: draft.payload,
      });
      // If this was a reply to an inbound email, flag it handled.
      if (am.message_id) {
        try {
          const { markReplied } = await import('./agentmail-inboxes');
          await markReplied(am.message_id, id);
        } catch { /* non-blocking */ }
      }
      return await executeApproved(id, 'sent', note ?? `AgentMail sent ${sent.message_id}`);
    } catch (e) {
      return { ok: false, error: `agentmail send failed: ${(e as Error).message}` };
    }
  }

  // TODO: wire Gmail / SMTP for non-AgentMail email drafts.
  return executeApproved(id, 'sent', note ?? '(simulated — no external API wired yet)');
}

export async function confirmMeeting(id: number, note?: string): Promise<ExecuteResult> {
  // TODO: wire Google Calendar
  return executeApproved(id, 'confirmed', note ?? '(simulated — no external API wired yet)');
}
