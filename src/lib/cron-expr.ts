// Minimal, dependency-free 5-field cron evaluator: "minute hour day-of-month
// month day-of-week". Supports '*', lists (a,b,c), ranges (a-b), and steps
// (*/n, a-b/n). Day-of-week is 0-6 with Sunday=0; 7 is also accepted as Sunday.
// Timezone-aware via Intl, so "0 9 * * 1-5 / America/New_York" means 9am ET on
// weekdays regardless of DST. We only need this because Vercel Cron schedules
// are fixed in vercel.json; user-defined jobs carry their own expression.

type Field = Set<number>;

function parseField(spec: string, min: number, max: number): Field {
  const out = new Set<number>();
  for (const rawPart of spec.split(',')) {
    const part = rawPart.trim();
    if (!part) continue;
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart === undefined ? 1 : parseInt(stepPart, 10);
    if (!Number.isFinite(step) || step < 1) throw new Error(`Bad step in "${spec}"`);
    let lo = min;
    let hi = max;
    if (rangePart !== '*' && rangePart !== '') {
      const [a, b] = rangePart.split('-');
      lo = parseInt(a, 10);
      hi = b !== undefined ? parseInt(b, 10) : lo;
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error(`Bad range in "${spec}"`);
      if (lo < min || hi > max || lo > hi) throw new Error(`Out-of-range value in "${spec}"`);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  if (out.size === 0) throw new Error(`Empty field "${spec}"`);
  return out;
}

export interface CronParsed {
  minute: Field;
  hour: Field;
  dom: Field;
  month: Field;
  dow: Field;
  domStar: boolean;
  dowStar: boolean;
}

export function parseCron(expr: string): CronParsed {
  const fields = String(expr ?? '').trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`Cron must have 5 fields, got ${fields.length}: "${expr}"`);
  const [mi, ho, dm, mo, dw] = fields;
  const dow = parseField(dw, 0, 7);
  if (dow.has(7)) { dow.add(0); dow.delete(7); }
  return {
    minute: parseField(mi, 0, 59),
    hour: parseField(ho, 0, 23),
    dom: parseField(dm, 1, 31),
    month: parseField(mo, 1, 12),
    dow,
    domStar: dm.trim() === '*',
    dowStar: dw.trim() === '*',
  };
}

/** True if the given cron expression is parseable. */
export function isValidCron(expr: string): boolean {
  try { parseCron(expr); return true; } catch { return false; }
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Next instant (UTC Date) at or after `from`+1min that matches `expr` in `tz`.
 * Returns null if no match within ~366 days (e.g. an impossible date).
 */
export function computeNextRun(expr: string, tz = 'UTC', from: Date = new Date()): Date | null {
  const c = parseCron(expr);
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'UTC',
      hour12: false,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', weekday: 'short',
    });
  } catch {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC', hour12: false,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', weekday: 'short',
    });
  }

  // Start at the next whole-minute boundary after `from`.
  const start = Math.floor(from.getTime() / 60_000) * 60_000 + 60_000;
  const MAX_MINUTES = 366 * 24 * 60;

  for (let i = 0; i < MAX_MINUTES; i++) {
    const cand = new Date(start + i * 60_000);
    const parts = fmt.formatToParts(cand);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const minute = parseInt(get('minute'), 10);
    if (!c.minute.has(minute)) continue;
    let hour = parseInt(get('hour'), 10);
    if (hour === 24) hour = 0; // some ICU builds emit 24 for midnight
    if (!c.hour.has(hour)) continue;
    const month = parseInt(get('month'), 10);
    if (!c.month.has(month)) continue;
    const day = parseInt(get('day'), 10);
    const weekday = WEEKDAY[get('weekday')] ?? 0;
    const dayMatch =
      c.domStar && c.dowStar ? true
        : c.domStar ? c.dow.has(weekday)
          : c.dowStar ? c.dom.has(day)
            : c.dom.has(day) || c.dow.has(weekday);
    if (!dayMatch) continue;
    return cand;
  }
  return null;
}
