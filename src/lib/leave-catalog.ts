// Leave request maths — PURE.
//
// The interesting part is not storing a request, it is answering "can they actually take
// this?" correctly, because the answer depends on the probation rule Olivia described:
// leave ACCRUES during the first three months but cannot be TAKEN as paid leave, and
// anything taken then is unpaid with the client credited — unless the assistant makes
// the hours up, which is the more common outcome.
//
// So a request inside probation is not REFUSED. It is marked unpaid, and everyone sees
// that before it is approved.

import type { LeaveKind } from './service-policy';

export type LeaveStatus = 'pending' | 'approved' | 'declined' | 'cancelled';

export interface LeaveRequest {
  id: string;
  kind: LeaveKind;
  starts_on: string;
  ends_on: string;
  days: number;
  note: string | null;
  status: LeaveStatus;
  unpaid: boolean;
  requester_email: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}

const DAY_INDEX: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

/**
 * Working days between two dates, inclusive, counted against the assistant's OWN
 * working days.
 *
 * Someone who works Tuesday to Saturday should not lose a Saturday of leave for a day
 * they were never rostered, and should not get a free Monday either.
 */
export function workingDays(startISO: string, endISO: string, workingDayNames: string[]): number {
  const on = new Set(
    (workingDayNames.length ? workingDayNames : ['mon', 'tue', 'wed', 'thu', 'fri'])
      .map(d => DAY_INDEX[String(d).toLowerCase().slice(0, 3)])
      .filter(n => n !== undefined),
  );
  const start = Date.parse(`${startISO}T00:00:00Z`);
  const end = Date.parse(`${endISO}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;

  let count = 0;
  for (let t = start; t <= end; t += 86_400_000) {
    if (on.has(new Date(t).getUTCDay())) count++;
  }
  return count;
}

export interface BalanceInput {
  /** Days accrued for this kind, from service-policy accrualStatus. */
  accrued: number;
  /** Existing requests for the same kind — pending counts against the balance too. */
  requests: ReadonlyArray<Pick<LeaveRequest, 'kind' | 'days' | 'status' | 'unpaid'>>;
  kind: LeaveKind;
}

/**
 * What is actually left.
 *
 * PENDING requests count against it. A balance that ignores them lets someone request
 * their whole allowance three times over before anyone approves the first one.
 *
 * UNPAID days do not, because they were never drawn from the entitlement.
 */
export function remaining(input: BalanceInput): number {
  const used = input.requests
    .filter(r => r.kind === input.kind && !r.unpaid)
    .filter(r => r.status === 'approved' || r.status === 'pending')
    .reduce((n, r) => n + Number(r.days || 0), 0);
  return Math.round((input.accrued - used) * 10) / 10;
}

export interface RequestCheck {
  ok: boolean;
  /** True when this would be unpaid: taken inside the probation window. */
  unpaid: boolean;
  /** Blocking problem, when there is one. */
  error?: string;
  /** Worth saying out loud before anyone approves, but not blocking. */
  warning?: string;
}

/**
 * Can this request be made?
 *
 * Refuses only what is genuinely nonsense — no days, backwards dates, a date in the
 * past. Everything else is allowed through WITH A WARNING, because the person approving
 * is the client and they are entitled to say yes to an exception. The job here is to
 * make sure nobody agrees to something without being told what it is.
 */
export function checkRequest(input: {
  days: number;
  startsOn: string;
  inProbation: boolean;
  remaining: number;
  today: string;
}): RequestCheck {
  if (!(input.days > 0)) {
    return { ok: false, unpaid: false, error: 'That range has no working days in it.' };
  }
  if (input.startsOn < input.today) {
    return { ok: false, unpaid: false, error: 'That start date is in the past.' };
  }

  if (input.inProbation) {
    return {
      ok: true,
      unpaid: true,
      warning:
        'This falls inside the first three months, so it would be unpaid. The client is ' +
        'credited for the time unless the hours are made up on another day.',
    };
  }

  if (input.days > input.remaining) {
    return {
      ok: true,
      unpaid: false,
      warning: `That is ${Math.round((input.days - input.remaining) * 10) / 10} day(s) more than has been accrued so far.`,
    };
  }

  return { ok: true, unpaid: false };
}
