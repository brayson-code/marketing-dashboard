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
import { encryptSecret, decryptSecret, upsertIntegration, clearIntegration } from '@/lib/integrations-store';
import { disconnect } from '@/lib/nango';

export type PendingAction = 'rotate_secret' | 'disconnect' | 'clear';

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
  | { ok: true; status: 'approved' | 'denied'; executed: PendingAction | null }
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
  const row = await getPendingApproval(id);
  if (!row) return { ok: false, error: 'Approval not found', code: 'not_found' };
  if (row.status !== 'pending') {
    return { ok: false, error: `Approval already ${row.status}`, code: 'already_resolved' };
  }

  if (decision === 'deny') {
    await sql()`
      UPDATE public.pending_approvals
         SET status = 'denied', resolved_at = now(), resolved_by = ${currentUserId()}
       WHERE tenant_id = ${tenantId()} AND id = ${id} AND status = 'pending'
    `;
    return { ok: true, status: 'denied', executed: null };
  }

  // decision === 'approve' → execute the would-be mutation server-side.
  try {
    if (row.action === 'rotate_secret') {
      const p = (row.payload ?? {}) as Partial<RotatePayload>;
      if (!p.provider || !p.secret_encrypted) {
        return { ok: false, error: 'Malformed rotate payload', code: 'execute_failed' };
      }
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
    } else {
      return { ok: false, error: `Unsupported action: ${row.action}`, code: 'unknown_action' };
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message || 'Execution failed', code: 'execute_failed' };
  }

  await sql()`
    UPDATE public.pending_approvals
       SET status = 'approved', resolved_at = now(), resolved_by = ${currentUserId()}
     WHERE tenant_id = ${tenantId()} AND id = ${id} AND status = 'pending'
  `;
  return { ok: true, status: 'approved', executed: row.action as PendingAction };
}
