// KeyPlayers service policy — PURE. Leave entitlements, probation, holidays, accrual.
//
// This is CONTRACTUAL policy, confirmed by Olivia (Client Success Lead) 2026-08-05. It
// lives in code rather than a settings table on purpose: it changes rarely, it's the
// kind of thing that must never be half-edited, and in code it's reviewable in a PR and
// versioned with the app. Move it to a table only when someone actually needs to change
// it without a deploy.
//
// The accrual maths is the point of the file. "10 days a year" is easy to say and hard
// to answer in practice — a client wants to know what their assistant has available
// TODAY, and whether they're still inside probation. Getting that wrong in either
// direction is a real conversation with a real client, so it's computed and testable
// rather than described in prose on a page.

export type LeaveKind = 'vacation' | 'sick' | 'emergency';

export interface LeaveEntitlement {
  kind: LeaveKind;
  label: string;
  daysPerYear: number;
  blurb: string;
}

/** Annual paid entitlements, per client placement. */
export const ENTITLEMENTS: LeaveEntitlement[] = [
  {
    kind: 'vacation',
    label: 'Paid vacation',
    daysPerYear: 10,
    blurb: 'Accrues from their start date with you. They can only take what has accrued.',
  },
  {
    kind: 'sick',
    label: 'Paid sick days',
    daysPerYear: 5,
    blurb: 'For illness. Same accrual rules as vacation.',
  },
  {
    kind: 'emergency',
    label: 'Paid personal emergency days',
    daysPerYear: 5,
    blurb: 'For genuine emergencies that cannot be planned around.',
  },
];

export const PROBATION_MONTHS = 3;

/**
 * The probation rule, stated once so the page and any agent answer it the same way.
 *
 * Two halves people mix up: leave ACCRUES during probation but cannot be TAKEN as paid
 * leave until probation ends. And if time is taken during probation it is unpaid — the
 * client is credited for it, unless the assistant makes the hours up on another day,
 * which Olivia says is the more common outcome.
 */
export const PROBATION_RULE = {
  summary: `No paid leave in the first ${PROBATION_MONTHS} months with you.`,
  accrues: 'Leave still accrues during probation, and becomes available the day it ends.',
  ifTaken: 'Time taken during probation is unpaid. You are credited for it, unless your assistant makes the hours up on another day (which is what usually happens).',
} as const;

export const WORKING_HOURS_NOTE =
  'Assistants work in your timezone, usually between 9am and 5pm, weekdays. Both the hours and the days are flexible if your business needs something different.';

// ── Holidays ────────────────────────────────────────────────────────────────
// Assistants follow the client's national bank/statutory holidays (Canada or US).
// The one Philippine holiday observed regardless is Christmas.

export type HolidayRegion = 'CA' | 'US';

export interface Holiday {
  date: string;   // ISO yyyy-mm-dd
  name: string;
  regions: HolidayRegion[] | 'all';
}

// 2026 dates. NOTE: this list is year-specific and needs extending each year — the page
// says so rather than silently showing an empty calendar.
export const HOLIDAY_YEAR = 2026;

export const HOLIDAYS: Holiday[] = [
  { date: '2026-01-01', name: "New Year's Day",            regions: 'all' },
  { date: '2026-01-19', name: 'Martin Luther King Jr. Day', regions: ['US'] },
  { date: '2026-02-16', name: 'Family Day / Presidents Day', regions: 'all' },
  { date: '2026-04-03', name: 'Good Friday',                regions: ['CA'] },
  { date: '2026-05-18', name: 'Victoria Day',               regions: ['CA'] },
  { date: '2026-05-25', name: 'Memorial Day',               regions: ['US'] },
  { date: '2026-06-19', name: 'Juneteenth',                 regions: ['US'] },
  { date: '2026-07-01', name: 'Canada Day',                 regions: ['CA'] },
  { date: '2026-07-03', name: 'Independence Day (observed)', regions: ['US'] },
  { date: '2026-09-07', name: 'Labour Day',                 regions: 'all' },
  { date: '2026-10-12', name: 'Thanksgiving (CA)',          regions: ['CA'] },
  { date: '2026-11-11', name: 'Remembrance Day / Veterans Day', regions: 'all' },
  { date: '2026-11-26', name: 'Thanksgiving (US)',          regions: ['US'] },
  { date: '2026-12-25', name: 'Christmas Day',              regions: 'all' },
  { date: '2026-12-26', name: 'Boxing Day',                 regions: ['CA'] },
];

export function holidaysFor(region: HolidayRegion): Holiday[] {
  return HOLIDAYS.filter(h => h.regions === 'all' || h.regions.includes(region));
}

/** The next few holidays on or after `now`, so the page shows what's coming, not a list. */
export function upcomingHolidays(region: HolidayRegion, now: number, limit = 4): Holiday[] {
  const today = new Date(now).toISOString().slice(0, 10);
  return holidaysFor(region).filter(h => h.date >= today).slice(0, limit);
}

// ── Accrual ─────────────────────────────────────────────────────────────────

const DAY = 86_400_000;

export interface AccrualStatus {
  /** Whole months completed since the start date. */
  monthsElapsed: number;
  /** True while inside the probation window. */
  inProbation: boolean;
  /** ISO date probation ends (or ended). */
  probationEndsOn: string;
  /** Days until probation ends; 0 once past. */
  daysToProbationEnd: number;
  /** Accrued days per leave kind, rounded to one decimal. */
  accrued: Record<LeaveKind, number>;
  /** Accrued AND usable today — zero while in probation. */
  available: Record<LeaveKind, number>;
}

function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  // Clamp a rolled-over short month (31 Jan + 1mo should be 28/29 Feb, not 3 Mar).
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/**
 * What the assistant has accrued and what they can actually use today.
 *
 * Accrual is monthly and pro-rata (10 days/year → 5/6 of a day per completed month),
 * counted from their start date WITH THIS CLIENT — Olivia: "It is on a per client
 * basis." Entitlement resets annually, so accrual is capped at one year's worth.
 *
 * `now` is injected rather than read from the clock: this has to be testable and give
 * the same answer for the same inputs.
 */
export function accrualStatus(startedOn: string, now: number): AccrualStatus | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startedOn ?? '')) return null;
  const start = new Date(`${startedOn}T00:00:00Z`).getTime();
  if (!Number.isFinite(start)) return null;

  // Whole months completed, by calendar rather than by 30-day blocks.
  let monthsElapsed = 0;
  while (new Date(`${addMonths(startedOn, monthsElapsed + 1)}T00:00:00Z`).getTime() <= now) {
    monthsElapsed++;
    if (monthsElapsed > 600) break; // guard against a nonsense start date
  }

  const probationEndsOn = addMonths(startedOn, PROBATION_MONTHS);
  const probationEnd = new Date(`${probationEndsOn}T00:00:00Z`).getTime();
  const inProbation = now < probationEnd;

  const accrued = {} as Record<LeaveKind, number>;
  const available = {} as Record<LeaveKind, number>;
  for (const e of ENTITLEMENTS) {
    // Cap at a full year's entitlement — it resets annually rather than compounding.
    const months = Math.min(monthsElapsed, 12);
    const days = Math.round((e.daysPerYear * months / 12) * 10) / 10;
    accrued[e.kind] = days;
    available[e.kind] = inProbation ? 0 : days;
  }

  return {
    monthsElapsed,
    inProbation,
    probationEndsOn,
    daysToProbationEnd: inProbation ? Math.max(0, Math.ceil((probationEnd - now) / DAY)) : 0,
    accrued,
    available,
  };
}
