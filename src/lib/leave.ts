// Leave requests — SERVER.
//
// Who may do what is enforced here, not in the UI:
//   the ASSISTANT (role 'va') requests, and may cancel their own while it is pending
//   the CLIENT (owner/member) approves or declines
// An assistant approving their own leave would make the whole feature theatre.

import { sql } from './db/client';
import { tenantId, currentUserId } from './tenant';
import { getSubject } from './authz';
import type { LeaveKind } from './service-policy';
import { workingDays, type LeaveRequest, type LeaveStatus } from './leave-catalog';

const KINDS = new Set<LeaveKind>(['vacation', 'sick', 'emergency']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toRow(r: Record<string, unknown>): LeaveRequest {
  return {
    id: String(r.id),
    kind: r.kind as LeaveKind,
    starts_on: new Date(r.starts_on as string).toISOString().slice(0, 10),
    ends_on: new Date(r.ends_on as string).toISOString().slice(0, 10),
    days: Number(r.days ?? 0),
    note: (r.note as string) ?? null,
    status: r.status as LeaveStatus,
    unpaid: !!r.unpaid,
    requester_email: (r.requester_email as string) ?? null,
    decided_by: (r.decided_by as string) ?? null,
    decided_at: r.decided_at ? new Date(r.decided_at as string).toISOString() : null,
    decision_note: (r.decision_note as string) ?? null,
    created_at: new Date(r.created_at as string).toISOString(),
  };
}

/** Everything for this workspace. Both sides see the same list — the client has to
 *  approve it and the assistant has to see where theirs got to. */
export async function listLeave(): Promise<LeaveRequest[]> {
  const rows = (await sql()`
    SELECT * FROM public.leave_requests
    WHERE tenant_id = ${tenantId()}
    ORDER BY
      CASE status WHEN 'pending' THEN 0 ELSE 1 END,
      starts_on DESC
    LIMIT 100
  `) as unknown as Array<Record<string, unknown>>;
  return rows.map(toRow);
}

export interface CreateResult { ok: boolean; id?: string; error?: string; days?: number }

export async function createLeaveRequest(input: {
  kind: string;
  startsOn: string;
  endsOn: string;
  note?: string | null;
  workingDayNames: string[];
  unpaid: boolean;
  requesterEmail: string | null;
}): Promise<CreateResult> {
  const kind = input.kind as LeaveKind;
  if (!KINDS.has(kind)) return { ok: false, error: 'Pick a type of leave.' };
  if (!ISO_DATE.test(input.startsOn) || !ISO_DATE.test(input.endsOn)) {
    return { ok: false, error: 'Pick a start and end date.' };
  }

  // Recomputed here rather than trusted from the client — the day count is what the
  // balance is measured against.
  const days = workingDays(input.startsOn, input.endsOn, input.workingDayNames);
  if (days <= 0) return { ok: false, error: 'That range has no working days in it.' };

  const rows = (await sql()`
    INSERT INTO public.leave_requests
      (tenant_id, requester_id, requester_email, kind, starts_on, ends_on, days, note, unpaid)
    VALUES (
      ${tenantId()}, ${currentUserId()}, ${input.requesterEmail},
      ${kind}, ${input.startsOn}, ${input.endsOn}, ${days},
      ${input.note ?? null}, ${input.unpaid}
    )
    RETURNING id
  `) as unknown as Array<{ id: string }>;

  return { ok: true, id: String(rows[0].id), days };
}

/**
 * Approve or decline. CLIENT ONLY.
 *
 * Checked against the live subject rather than anything the browser sent, and scoped to
 * this tenant, so a request id from another workspace cannot be decided from here.
 */
export async function decideLeave(
  id: string, decision: 'approved' | 'declined', by: string | null, note?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const subject = await getSubject();
  if (!subject.isMember || subject.role === 'va') {
    return { ok: false, error: 'Only the client can approve or decline leave.' };
  }

  const rows = (await sql()`
    UPDATE public.leave_requests
    SET status = ${decision}, decided_by = ${by}, decided_at = now(), decision_note = ${note ?? null}
    WHERE id = ${id} AND tenant_id = ${tenantId()} AND status = 'pending'
    RETURNING id
  `) as unknown as Array<{ id: string }>;

  // Nothing updated means it was already decided or belongs elsewhere. Same message for
  // both, so this cannot be used to probe for ids in other workspaces.
  return rows.length
    ? { ok: true }
    : { ok: false, error: 'That request is no longer pending.' };
}

/** An assistant withdrawing their own request while it is still pending. */
export async function cancelLeave(id: string): Promise<{ ok: boolean; error?: string }> {
  const rows = (await sql()`
    UPDATE public.leave_requests
    SET status = 'cancelled'
    WHERE id = ${id} AND tenant_id = ${tenantId()}
      AND status = 'pending' AND requester_id = ${currentUserId()}
    RETURNING id
  `) as unknown as Array<{ id: string }>;
  return rows.length ? { ok: true } : { ok: false, error: 'That request can no longer be withdrawn.' };
}
