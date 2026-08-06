// When is the assistant not here? — PURE.
//
// Leave requests answer "can I take this", holidays answer "what does the calendar
// say". Neither answers the question a founder actually asks, which is "who is covering
// the week of the 14th" — and that needs both together, because a statutory holiday
// costs you the same day as booked leave does.
//
// Merges the two into one forward-looking list. Nothing new is stored: approved leave
// already exists, and the holiday calendar is in service-policy.ts.

import { holidaysFor, type HolidayRegion } from './service-policy';
import type { LeaveRequest } from './leave-catalog';

export type AbsenceKind = 'leave' | 'holiday';

export interface Absence {
  kind: AbsenceKind;
  /** ISO yyyy-mm-dd. */
  startsOn: string;
  endsOn: string;
  label: string;
  /** Working days lost. Holidays are one day; leave carries its counted total. */
  days: number;
  /** True for leave taken during probation — unpaid, and the client is credited. */
  unpaid?: boolean;
}

export interface CoverageMonth {
  /** yyyy-mm, for a stable key. */
  key: string;
  label: string;
  absences: Absence[];
  days: number;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function monthLabel(iso: string): { key: string; label: string } {
  const [y, m] = iso.split('-');
  return { key: `${y}-${m}`, label: `${MONTHS[Number(m) - 1] ?? m} ${y}` };
}

/**
 * Everything that takes the assistant out, from today forward.
 *
 * APPROVED leave only. A pending request is a question, not a plan, and showing it as
 * an absence would have a founder planning around time off they have not agreed to.
 *
 * Grouped by month because that is how the question is asked, and capped by horizon so
 * a year of statutory holidays does not bury next week.
 */
export function coverage(input: {
  requests: ReadonlyArray<LeaveRequest>;
  region: HolidayRegion;
  now: number;
  horizonDays?: number;
}): CoverageMonth[] {
  const today = new Date(input.now).toISOString().slice(0, 10);
  const horizon = new Date(input.now + (input.horizonDays ?? 120) * 86_400_000)
    .toISOString().slice(0, 10);

  const absences: Absence[] = [];

  for (const r of input.requests) {
    if (r.status !== 'approved') continue;
    // Keep anything still running: leave that started last week but ends next Tuesday
    // is very much still an absence.
    if (r.ends_on < today || r.starts_on > horizon) continue;
    absences.push({
      kind: 'leave',
      startsOn: r.starts_on,
      endsOn: r.ends_on,
      label: r.kind === 'vacation' ? 'On holiday' : r.kind === 'sick' ? 'Off sick' : 'Personal emergency',
      days: Number(r.days || 0),
      unpaid: r.unpaid,
    });
  }

  for (const h of holidaysFor(input.region)) {
    if (h.date < today || h.date > horizon) continue;
    absences.push({ kind: 'holiday', startsOn: h.date, endsOn: h.date, label: h.name, days: 1 });
  }

  absences.sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.label.localeCompare(b.label));

  const byMonth = new Map<string, CoverageMonth>();
  for (const a of absences) {
    const { key, label } = monthLabel(a.startsOn);
    if (!byMonth.has(key)) byMonth.set(key, { key, label, absences: [], days: 0 });
    const m = byMonth.get(key)!;
    m.absences.push(a);
    m.days += a.days;
  }

  return [...byMonth.values()];
}

/** The next absence, for a one-line summary. Null when the horizon is clear. */
export function nextAbsence(months: CoverageMonth[]): Absence | null {
  return months[0]?.absences[0] ?? null;
}
