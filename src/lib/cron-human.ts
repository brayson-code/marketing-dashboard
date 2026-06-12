// Pure cron-expression → human-readable label.
// 5-field cron only: min hour dom month dow

const DEFAULT_TZ = 'UTC';

// Days of week abbreviations, index 0=Sun
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Plural full names used when a single day is specified (e.g. "Mondays")
const DOW_PLURAL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Format hour+minute as H:MM (no leading zero on hour) */
function fmtTime(h: number, m: number): string {
  return `${h}:${pad2(m)}`;
}

/** Ordinal suffix: 1st, 2nd, 3rd, 4th… */
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

/** Convert a cron expression to a human-readable string.
 *  Appends the tz short label when tz is provided and non-default. */
export function cronToHuman(expr: string, tz?: string): string {
  const parts = (expr ?? '').trim().split(/\s+/);
  if (parts.length !== 5) return expr;

  const [minField, hourField, domField, , dowField] = parts;

  // ── Minute-level ──────────────────────────────────────────────────────────
  // Every N minutes: */N * * * *
  const minuteStepMatch = minField.match(/^\*\/(\d+)$/);
  if (minuteStepMatch && hourField === '*' && domField === '*' && dowField === '*') {
    const step = parseInt(minuteStepMatch[1], 10);
    if (step > 0 && step < 60) {
      return appendTz(`Every ${step} min`, tz);
    }
  }

  // Every hour: * * * * * or 0 * * * *
  if (hourField === '*' && domField === '*' && dowField === '*') {
    if (minField === '*' || minField === '0') {
      return appendTz('Every hour', tz);
    }
    // Hourly at :NN
    const m = parseInt(minField, 10);
    if (!Number.isNaN(m) && /^\d+$/.test(minField)) {
      return appendTz(`Hourly at :${pad2(m)}`, tz);
    }
    return expr;
  }

  // ── Hour must be a single integer from here on ────────────────────────────
  if (!/^\d+$/.test(hourField)) return expr;
  const h = parseInt(hourField, 10);
  if (Number.isNaN(h)) return expr;

  // Minute must be a single integer (or 0-padded)
  if (!/^\d+$/.test(minField)) return expr;
  const m = parseInt(minField, 10);
  if (Number.isNaN(m)) return expr;

  const timeStr = fmtTime(h, m);

  // ── DOM-based ─────────────────────────────────────────────────────────────
  // Monthly on the Nth: 0 9 1 * *
  if (/^\d+$/.test(domField) && dowField === '*') {
    const day = parseInt(domField, 10);
    return appendTz(`Monthly on the ${ordinal(day)} at ${timeStr}`, tz);
  }

  // Every N days: 0 9 */2 * *
  const domStepMatch = domField.match(/^\*\/(\d+)$/);
  if (domStepMatch && dowField === '*') {
    const step = parseInt(domStepMatch[1], 10);
    return appendTz(`Every ${step} days at ${timeStr}`, tz);
  }

  // ── DOW-based (dom must be *) ─────────────────────────────────────────────
  if (domField !== '*') return expr;

  // Daily: 0 9 * * *
  if (dowField === '*') {
    return appendTz(`Daily at ${timeStr}`, tz);
  }

  // Weekdays: 0 9 * * 1-5
  if (dowField === '1-5') {
    return appendTz(`Weekdays at ${timeStr}`, tz);
  }

  // Single named day: 0 9 * * 1
  if (/^\d$/.test(dowField)) {
    const idx = parseInt(dowField, 10);
    const dayName = DOW_PLURAL[idx];
    if (!dayName) return expr;
    return appendTz(`${dayName} at ${timeStr}`, tz);
  }

  // List of days: 0 9 * * 1,3,5
  if (/^[\d,]+$/.test(dowField)) {
    const indices = dowField.split(',').map(Number);
    if (indices.some((i) => Number.isNaN(i) || i < 0 || i > 6)) return expr;
    const names = indices.map((i) => DOW_SHORT[i]);
    if (names.some((n) => !n)) return expr;
    return appendTz(`${names.join(', ')} at ${timeStr}`, tz);
  }

  return expr;
}

/** Append tz label if it's non-empty and non-UTC. */
function appendTz(label: string, tz?: string): string {
  if (!tz || tz === DEFAULT_TZ || tz === 'Etc/UTC') return label;
  // Extract a short label: "America/New_York" → "New York", or just use as-is
  const short = tz.includes('/') ? tz.split('/').pop()!.replace(/_/g, ' ') : tz;
  return `${label} (${short})`;
}

// ── Schedule presets ──────────────────────────────────────────────────────────

export interface SchedulePreset {
  label: string;
  expr: string;
}

export const SCHEDULE_PRESETS: SchedulePreset[] = [
  { label: 'Every hour', expr: '0 * * * *' },
  { label: 'Daily 9:00', expr: '0 9 * * *' },
  { label: 'Weekdays 9:00', expr: '0 9 * * 1-5' },
  { label: 'Weekly Mon 9:00', expr: '0 9 * * 1' },
  { label: 'Monthly 1st 9:00', expr: '0 9 1 * *' },
];
