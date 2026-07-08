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

  // 'execute' = auto-approve and run the appropriate executor. Content posts
  // publish for real on connected platforms (YouTube/IG replies, X, LinkedIn,
  // Facebook Pages) and email sends for real via AgentMail; everything else
  // still simulates but flips status correctly so the audit trail holds.
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
 * Flip an approved draft to its executed status and stamp the audit note. The
 * real external calls live in the callers (publishContent / sendEmail) — they
 * invoke this only AFTER the platform API succeeded, so 'published'/'sent'
 * always reflects something that actually happened (or an explicitly
 * "(simulated …)" note for platforms with no connector yet).
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

/** Atomically claim an approved draft for publishing. Returns true iff THIS call
 *  won the claim — i.e. no fresh publish lock was already held. This is the
 *  double-publish guard: a Reel publish keeps the row 'approved' for minutes while
 *  it polls Meta, so without a lock a concurrent request (double-click) or a
 *  retry-after-timeout could post the same Reel twice. The lock lives in
 *  metadata.publish_lock (a timestamp) and self-heals after ~6 min so a killed run
 *  can't wedge the draft forever. */
async function claimForPublish(id: number): Promise<boolean> {
  const rows = await sql()`
    UPDATE agent_drafts
    SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('publish_lock', to_jsonb(now()))
    WHERE id = ${id} AND tenant_id = ${tenantId()} AND status = 'approved'
      AND (
        metadata->>'publish_lock' IS NULL
        OR (metadata->>'publish_lock')::timestamptz < now() - interval '6 minutes'
      )
    RETURNING id
  `;
  return (rows as unknown[]).length > 0;
}

/** Release the publish lock so a legitimate retry isn't blocked. Only meaningful
 *  when the publish FAILED (the draft stays 'approved'); on success the status is
 *  already terminal and the leftover lock is harmless. Best-effort. */
async function releasePublishLock(id: number): Promise<void> {
  await sql()`
    UPDATE agent_drafts
    SET metadata = COALESCE(metadata, '{}'::jsonb) - 'publish_lock'
    WHERE id = ${id} AND tenant_id = ${tenantId()}
  `.catch(() => {});
}

export async function publishContent(id: number, note?: string): Promise<ExecuteResult> {
  const draft = await getDraft(id);
  if (!draft) return { ok: false, error: `Draft ${id} not found` };
  // Idempotent: a prior attempt already published this draft — never re-post it.
  if (draft.status === 'published') return { ok: true, draft };
  if (draft.status !== 'approved') {
    return { ok: false, error: `Draft ${id} is ${draft.status}, must be 'approved' before execution` };
  }

  // Claim the draft before the (possibly minutes-long) external publish so a
  // concurrent request or a retry can't double-post. If we didn't win the claim,
  // another attempt is already in flight (or just finished) — don't publish again.
  if (!(await claimForPublish(id))) {
    const cur = await getDraft(id);
    if (cur?.status === 'published') return { ok: true, draft: cur };
    return { ok: false, error: `Draft ${id} is already being published — give it a moment before retrying.` };
  }

  const result = await dispatchPublish(draft, note);
  // On failure the draft stays 'approved' for a legitimate retry — release the lock
  // so the retry isn't blocked. On success the status flip already guards re-posts.
  if (!result.ok) await releasePublishLock(id);
  return result;
}

/** Perform the real platform publish for an already-claimed, approved draft. */
async function dispatchPublish(draft: DraftRow, note?: string): Promise<ExecuteResult> {
  const id = draft.id;
  // Route by platform — read from metadata.platform (set when the draft was
  // created). Wired end-to-end today: YouTube + Instagram comment replies, and
  // top-level posts to X, LinkedIn (member feed), and Facebook Pages. Anything
  // else still simulates so the autonomy flow keeps working until a connector
  // lands. Each branch fails closed: a connector error returns ok:false with
  // the tagged cause and the draft stays 'approved' for a retry.
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

  if (platform === 'x') {
    try {
      const { postTweet } = await import('./x');
      const tweetId = await postTweet(draft.payload);
      return await executeApproved(id, 'published', note ?? `x post ${tweetId}`);
    } catch (e) {
      return { ok: false, error: `x publish failed: ${(e as Error).message}` };
    }
  }

  if (platform === 'linkedin') {
    try {
      const { createPost } = await import('./linkedin');
      const postUrn = await createPost(draft.payload);
      return await executeApproved(id, 'published', note ?? `linkedin post ${postUrn}`);
    } catch (e) {
      return { ok: false, error: `linkedin publish failed: ${(e as Error).message}` };
    }
  }

  if (platform === 'facebook') {
    try {
      const { createPagePost } = await import('./facebook');
      const postId = await createPagePost(draft.payload);
      return await executeApproved(id, 'published', note ?? `facebook post ${postId}`);
    } catch (e) {
      return { ok: false, error: `facebook publish failed: ${(e as Error).message}` };
    }
  }

  if (platform === 'youtube_video') {
    const vmeta = (meta as { youtube?: { title?: string; description?: string; tags?: string[]; privacy?: string }; video?: { blob_url?: string } }).video;
    const yt = (meta as { youtube?: { title?: string; description?: string; tags?: string[]; privacy?: string } }).youtube;
    const blobUrl = vmeta?.blob_url;
    if (!blobUrl) return { ok: false, error: 'youtube_video publish failed: missing video.blob_url in draft metadata' };
    try {
      const { uploadVideo } = await import('./youtube-upload');
      const result = await uploadVideo({
        videoUrl: blobUrl,
        title: yt?.title ?? draft.title,
        description: yt?.description,
        tags: yt?.tags,
        privacy: yt?.privacy as 'public' | 'unlisted' | 'private' | undefined,
      });
      return await executeApproved(id, 'published', note ?? `youtube video ${result.video_id} — ${result.url}`);
    } catch (e) {
      return { ok: false, error: `youtube_video publish failed: ${(e as Error).message}` };
    }
  }

  if (platform === 'instagram_reel') {
    const vmeta = (meta as { instagram?: { caption?: string }; video?: { blob_url?: string } }).video;
    const ig = (meta as { instagram?: { caption?: string } }).instagram;
    const blobUrl = vmeta?.blob_url;
    if (!blobUrl) return { ok: false, error: 'instagram_reel publish failed: missing video.blob_url in draft metadata' };
    try {
      const { publishReel } = await import('./instagram-publish');
      const result = await publishReel({
        videoUrl: blobUrl,
        caption: ig?.caption,
      });
      return await executeApproved(id, 'published', note ?? `instagram reel ${result.media_id} — ${result.permalink ?? '(no permalink)'}`);
    } catch (e) {
      return { ok: false, error: `instagram_reel publish failed: ${(e as Error).message}` };
    }
  }

  // Unknown/untagged platform (TikTok, drafts created before platform tagging,
  // …) — flip the status for auditability but say plainly that nothing went out.
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

  // AgentMail is the real send path. There is NO per-tenant Gmail/SMTP send
  // credential in this codebase today (/api/integrations/gmail is a legacy
  // env-var IMAP reader), so generic email drafts simulate until a proper
  // credential model exists — don't wire one ad hoc here.
  return executeApproved(id, 'sent', note ?? '(simulated — no external API wired yet)');
}

export async function confirmMeeting(id: number, note?: string): Promise<ExecuteResult> {
  // Still simulated: creating a real calendar event needs a Google OAuth
  // connection (calendar scope) that doesn't exist yet — there's no 'google'
  // provider in the Nango set today. The status flip keeps the audit trail
  // honest in the meantime.
  return executeApproved(id, 'confirmed', note ?? '(simulated — no external API wired yet)');
}
