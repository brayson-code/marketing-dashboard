// Owner step-up approvals — the SPECIAL case in the VA permission matrix.
//
// Key/secret rotation (and disconnect, which destroys a credential) is the ONE
// operational thing a VA/member may NOT do directly: it requires OWNER step-up
// confirmation. So instead of executing, a VA/member attempt creates a
// `pending_approvals` row (migration 0047). The owner approves it in-app and the
// rotation/disconnect runs SERVER-SIDE under the same tenant scope.
//
// SECURITY:
//  - The payload NEVER stores a raw plaintext secret. The would-be secret bag is
//    encrypted with the SAME AES-256-GCM-under-the-shared-key scheme the integrations
//    store uses (encryptSecret), and only decrypted at execute time, server-side.
//  - Every query here is tenant-scoped (WHERE tenant_id = ${tenantId()}). This module
//    never removes or weakens a tenant_id filter; it only adds rows / reads its own.
//  - resource_ref is the provider key; payload carries the encrypted secret + the
//    non-secret config needed to re-run the mutation. Decryption is keyed exactly as
//    the live integration secrets, so an approved rotation is byte-identical to the
//    owner having done it directly.

import { sql, jsonb, tenantId } from '@/lib/db/client';
import { currentUserId } from '@/lib/tenant';
import { emitSecurityEvent } from '@/lib/security-events';
import { encryptSecret, decryptSecret, upsertIntegration, clearIntegration } from '@/lib/integrations-store';
import { disconnect } from '@/lib/nango';

/**
 * Emit the two security-stream events that accompany every owner step-up request:
 *  - secret_step_up (info): marks the VA/member step-up ATTEMPT (high-volume, no alert).
 *  - pending_approval_created (warning): the new pending row the owner must resolve.
 * Best-effort — emitSecurityEvent never throws, so it cannot affect the INSERT result.
 */
function emitStepUp(action: PendingAction, provider: string): void {
  void emitSecurityEvent({
    type: 'secret_step_up',
    severity: 'info',
    resourceRef: provider,
    detail: { action },
  });
  void emitSecurityEvent({
    type: 'pending_approval_created',
    severity: 'warning',
    resourceRef: provider,
    detail: { action },
  });
}

export type PendingAction = 'rotate_secret' | 'disconnect' | 'clear' | 'tool_call';

export interface PendingApprovalRow {
  id: string; // bigint comes back as string from postgres.js
  tenant_id: string;
  requested_by: string;
  action: string;
  resource_ref: string;
  payload: Record<string, unknown> | null;
  status: 'pending' | 'approved' | 'denied';
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

/** The encrypted, persistable form of a would-be integration rotation. */
interface RotatePayload {
  provider: string;
  label?: string | null;
  config?: Record<string, unknown> | null;
  scopes?: string | null;
  /** encryptSecret(JSON.stringify(secretBag)) — NEVER plaintext. */
  secret_encrypted: string;
}

/**
 * Record a `rotate_secret` request as a pending approval INSTEAD of executing it.
 * The secret bag is encrypted before it ever touches the row. Returns the new row id.
 */
export async function createRotateSecretApproval(input: {
  provider: string;
  label?: string;
  config?: Record<string, unknown>;
  scopes?: string;
  secret: Record<string, string>;
}): Promise<string> {
  const payload: RotatePayload = {
    provider: input.provider,
    label: input.label ?? null,
    config: input.config ?? null,
    scopes: input.scopes ?? null,
    secret_encrypted: encryptSecret(JSON.stringify(input.secret)),
  };
  const rows = (await sql()`
    INSERT INTO public.pending_approvals (tenant_id, requested_by, action, resource_ref, payload)
    VALUES (
      ${tenantId()}, ${currentUserId()}, ${'rotate_secret'},
      ${input.provider}, ${jsonb(payload as unknown as Record<string, unknown>)}
    )
    RETURNING id
  `) as unknown as Array<{ id: string }>;
  emitStepUp('rotate_secret', input.provider);
  return rows[0].id;
}

/**
 * Record a `disconnect` request as a pending approval INSTEAD of executing it.
 * No secret to carry — disconnect is keyed purely on the provider. Returns the row id.
 */
export async function createDisconnectApproval(provider: string): Promise<string> {
  const rows = (await sql()`
    INSERT INTO public.pending_approvals (tenant_id, requested_by, action, resource_ref, payload)
    VALUES (
      ${tenantId()}, ${currentUserId()}, ${'disconnect'},
      ${provider}, ${jsonb({ provider })}
    )
    RETURNING id
  `) as unknown as Array<{ id: string }>;
  emitStepUp('disconnect', provider);
  return rows[0].id;
}

/**
 * Record a `clear` request as a pending approval INSTEAD of executing it. Clearing
 * an integration DELETES the stored credential (same destructive blast radius as
 * disconnect), so a VA/member may not do it directly. Keyed purely on the provider.
 */
export async function createClearApproval(provider: string): Promise<string> {
  const rows = (await sql()`
    INSERT INTO public.pending_approvals (tenant_id, requested_by, action, resource_ref, payload)
    VALUES (
      ${tenantId()}, ${currentUserId()}, ${'clear'},
      ${provider}, ${jsonb({ provider })}
    )
    RETURNING id
  `) as unknown as Array<{ id: string }>;
  emitStepUp('clear', provider);
  return rows[0].id;
}

/** The persistable form of a held orchestrator tool call (NO secret — plain jsonb is fine). */
interface ToolCallPayload {
  /** The gated tool name, e.g. 'launch_campaign' | 'spawn_subagent'. Mirrors resource_ref. */
  tool: string;
  /** The validated tool input needed to REPLAY the call on approve (e.g. { request } or { type, task }). */
  input: Record<string, unknown>;
  /** A short, owner-readable description of what will run. Rendered as the card body. */
  summary: string;
}

/**
 * Record an orchestrator TOOL CALL (spawn_subagent / launch_campaign) as a pending approval
 * INSTEAD of executing it. Used ONLY when TOOL_APPROVALS_ENABLED === 'true' (the gate lives
 * in the orchestrator; this function is inert unless that gate calls it). The payload carries
 * exactly the {tool, input, summary} needed to replay the call on approve — NO secret, so it
 * is stored as plain jsonb (do NOT copy the encryptSecret step from rotate). Returns the row id.
 */
export async function createToolCallApproval(input: {
  tool: string;
  input: Record<string, unknown>;
  summary: string;
}): Promise<string> {
  const payload: ToolCallPayload = {
    tool: input.tool,
    input: input.input,
    summary: input.summary,
  };
  const rows = (await sql()`
    INSERT INTO public.pending_approvals (tenant_id, requested_by, action, resource_ref, payload)
    VALUES (
      ${tenantId()}, ${currentUserId()}, ${'tool_call'},
      ${input.tool}, ${jsonb(payload as unknown as Record<string, unknown>)}
    )
    RETURNING id
  `) as unknown as Array<{ id: string }>;
  emitStepUp('tool_call', input.tool);
  return rows[0].id;
}

/** List pending approvals for the active tenant (owner-facing). */
export async function listPendingApprovals(): Promise<PendingApprovalRow[]> {
  return (await sql()`
    SELECT id, tenant_id, requested_by, action, resource_ref, payload,
           status, created_at, resolved_at, resolved_by
    FROM public.pending_approvals
    WHERE tenant_id = ${tenantId()} AND status = 'pending'
    ORDER BY created_at ASC
  `) as unknown as PendingApprovalRow[];
}

/** Fetch a single pending approval by id, tenant-scoped (or undefined). */
async function getPendingApproval(id: string): Promise<PendingApprovalRow | undefined> {
  const rows = (await sql()`
    SELECT id, tenant_id, requested_by, action, resource_ref, payload,
           status, created_at, resolved_at, resolved_by
    FROM public.pending_approvals
    WHERE tenant_id = ${tenantId()} AND id = ${id}
    LIMIT 1
  `) as unknown as PendingApprovalRow[];
  return rows[0];
}

export type ResolveResult =
  | {
      ok: true;
      status: 'approved' | 'denied';
      /** Which action was executed on approve (null on deny). */
      executed: PendingAction | null;
      /** For a 'tool_call' approval, a short human-readable result of the replayed call. */
      result?: string;
    }
  | { ok: false; error: string; code: 'not_found' | 'already_resolved' | 'unknown_action' | 'execute_failed' };

/**
 * Resolve a pending approval. On 'deny', just marks it denied. On 'approve', executes
 * the rotation/disconnect SERVER-SIDE under the active tenant scope, then marks it
 * approved. The CALLER must have already confirmed the actor is the owner — this
 * function does not re-check the role (it does, however, stay tenant-scoped).
 *
 * Idempotent-ish: a row that is not 'pending' is rejected with already_resolved.
 */
export async function resolvePendingApproval(
  id: string,
  decision: 'approve' | 'deny',
): Promise<ResolveResult> {
  // Existence + state check first — distinguishes not_found from already_resolved for a
  // clearer error. The ATOMIC claim below (not this read) is the real concurrency guard.
  const existing = await getPendingApproval(id);
  if (!existing) return { ok: false, error: 'Approval not found', code: 'not_found' };
  if (existing.status !== 'pending') {
    return { ok: false, error: `Approval already ${existing.status}`, code: 'already_resolved' };
  }

  if (decision === 'deny') {
    // Atomic flip: only the resolver that moves it off 'pending' wins (RETURNING). A
    // concurrent loser sees 0 rows → already_resolved.
    const denied = (await sql()`
      UPDATE public.pending_approvals
         SET status = 'denied', resolved_at = now(), resolved_by = ${currentUserId()}
       WHERE tenant_id = ${tenantId()} AND id = ${id} AND status = 'pending'
       RETURNING id
    `) as unknown as Array<{ id: string }>;
    if (!denied.length) return { ok: false, error: 'Approval already resolved', code: 'already_resolved' };
    return { ok: true, status: 'denied', executed: null };
  }

  // APPROVE — CLAIM the row atomically BEFORE executing (TOCTOU guard). Exactly one
  // UPDATE flips 'pending'→'approved' and returns the row; a concurrent approve gets 0
  // rows and can't double-run the action. On an execution failure we REVERT the claim
  // back to 'pending' so the owner can retry.
  const claimed = (await sql()`
    UPDATE public.pending_approvals
       SET status = 'approved', resolved_at = now(), resolved_by = ${currentUserId()}
     WHERE tenant_id = ${tenantId()} AND id = ${id} AND status = 'pending'
     RETURNING action, resource_ref, payload
  `) as unknown as Array<Pick<PendingApprovalRow, 'action' | 'resource_ref' | 'payload'>>;
  if (!claimed.length) return { ok: false, error: 'Approval already resolved', code: 'already_resolved' };
  const row = claimed[0];

  const revertClaim = async () => {
    await sql()`
      UPDATE public.pending_approvals
         SET status = 'pending', resolved_at = NULL, resolved_by = NULL
       WHERE tenant_id = ${tenantId()} AND id = ${id} AND status = 'approved'
    `.catch(() => { /* best-effort revert */ });
  };

  // Execute the would-be mutation server-side, under THIS tenant scope. EVERY failure
  // path throws → the single catch reverts the claim → execute_failed. For 'tool_call'
  // rows we capture a short human-readable result to thread back to the owner.
  let toolResult: string | undefined;
  try {
    if (row.action === 'rotate_secret') {
      const p = (row.payload ?? {}) as Partial<RotatePayload>;
      if (!p.provider || !p.secret_encrypted) throw new Error('Malformed rotate payload');
      const secret = JSON.parse(decryptSecret(p.secret_encrypted)) as Record<string, string>;
      await upsertIntegration({
        provider: p.provider,
        label: p.label ?? undefined,
        config: p.config ?? undefined,
        secret,
        scopes: p.scopes ?? undefined,
      });
    } else if (row.action === 'disconnect') {
      await disconnect(row.resource_ref);
    } else if (row.action === 'clear') {
      await clearIntegration(row.resource_ref);
    } else if (row.action === 'tool_call') {
      // Replay the held orchestrator tool call server-side, under THIS tenant scope.
      // LAZY dynamic imports keep pending-approvals free of any static dependency on
      // the orchestrator/executor graph (no orchestrator⇄pending-approvals cycle).
      const p = (row.payload ?? {}) as Partial<ToolCallPayload>;
      const tool = p.tool ?? row.resource_ref;
      const input = (p.input ?? {}) as Record<string, unknown>;
      if (tool === 'launch_campaign') {
        const request = typeof input.request === 'string' ? input.request.trim() : '';
        if (!request) throw new Error('Malformed launch_campaign payload (missing request)');
        const { launchResearchCampaign } = await import('@/lib/campaign-intake');
        const launched = await launchResearchCampaign(request);
        // The original branch fired runAndChain(launched.id) via after(); the resolve path
        // is its own API request, so call it inline (fire-and-forget) rather than via after().
        const { runAndChain } = await import('@/lib/waves');
        void runAndChain(launched.id).catch((e) =>
          console.error('[approval:tool_call launch_campaign] wave 1 failed:', (e as Error).message),
        );
        toolResult = `Launched campaign "${launched.title}" (goal ${launched.goalId}). Wave 1 is running.`;
      } else if (tool === 'spawn_subagent') {
        const type = typeof input.type === 'string' ? input.type : '';
        const task = typeof input.task === 'string' ? input.task : '';
        if (!type || !task) throw new Error('Malformed spawn_subagent payload (missing type/task)');
        // No live parentTaskId here (we're outside the original orchestrator turn) — optional.
        const { spawnSubAgent } = await import('@/lib/subagent');
        const r = await spawnSubAgent(type, task);
        if (!r.ok) throw new Error(`Sub-agent ${type} failed: ${r.error ?? 'unknown error'}`);
        toolResult = `Sub-agent ${type} completed.`;
      } else {
        throw new Error(`Unsupported gated tool: ${tool}`);
      }
    } else {
      throw new Error(`Unsupported action: ${row.action}`);
    }
  } catch (e) {
    await revertClaim();
    return { ok: false, error: (e as Error).message || 'Execution failed', code: 'execute_failed' };
  }

  return { ok: true, status: 'approved', executed: row.action as PendingAction, result: toolResult };
}
