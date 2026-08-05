// Relationship lens over the contact list — PURE.
//
// The page underneath is a sales pipeline: tiers, scores, funnel stages. That's the
// right tool for a salesperson and the wrong one for an Executive Assistant, whose job
// is "who is owed a reply, who has gone quiet, who do I prepare the founder for".
//
// This answers those questions from data the pipeline ALREADY stores — last_touch_at,
// next_action_at, notes — so it's a different reading of the same records rather than a
// second system to keep in sync. No new tables, no new writes.

export interface RelContact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
  notes: string | null;
  last_touch_at: string | null;
  next_action_at: string | null;
  /** Stored as a number in some paths and a boolean in others — accept both and treat
   *  anything truthy as paused, rather than casting at the call site and hiding it. */
  pause_outreach?: boolean | number | null;
}

export type RelBucket = 'overdue' | 'soon' | 'quiet';

export interface RelItem {
  contact: RelContact;
  bucket: RelBucket;
  /** Plain-language reason, e.g. "follow-up was due 3 days ago". */
  reason: string;
  /** Days since last contact, when known — used only for ordering. */
  days: number;
}

export const QUIET_AFTER_DAYS = 21;

export function displayName(c: RelContact): string {
  const n = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
  return n || c.company || 'Unnamed contact';
}

const DAY = 86_400_000;
const daysBetween = (a: number, b: number) => Math.floor((a - b) / DAY);

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Sort contacts into what an assistant should act on.
 *
 *   overdue — a follow-up date has passed. The clearest possible signal.
 *   soon    — a follow-up falls in the next week.
 *   quiet   — no follow-up planned and nobody has spoken in QUIET_AFTER_DAYS.
 *             This is the one a pipeline never surfaces: the relationship isn't
 *             failing at any stage, it's just quietly decaying.
 *
 * Contacts explicitly paused are excluded everywhere — someone has already decided
 * not to chase them, and nagging about it is how a queue loses credibility.
 *
 * `now` is injected rather than read from the clock so this is testable and gives the
 * same answer for the same inputs.
 */
export function relationshipQueue(
  contacts: ReadonlyArray<RelContact>,
  now: number,
  quietAfterDays = QUIET_AFTER_DAYS,
): RelItem[] {
  const out: RelItem[] = [];

  for (const c of contacts) {
    if (c.pause_outreach) continue; // 0 / false / null all mean 'not paused'

    const next = c.next_action_at ? new Date(c.next_action_at).getTime() : NaN;
    const last = c.last_touch_at ? new Date(c.last_touch_at).getTime() : NaN;
    const sinceLast = Number.isFinite(last) ? daysBetween(now, last) : Infinity;

    if (Number.isFinite(next) && next <= now) {
      const d = daysBetween(now, next);
      out.push({
        contact: c,
        bucket: 'overdue',
        reason: d <= 0 ? 'follow-up is due today' : `follow-up was due ${plural(d, 'day')} ago`,
        days: d,
      });
      continue;
    }

    if (Number.isFinite(next) && next - now <= 7 * DAY) {
      const d = daysBetween(next, now);
      out.push({
        contact: c,
        bucket: 'soon',
        reason: d <= 0 ? 'follow-up is due today' : `follow-up due in ${plural(d, 'day')}`,
        days: -d,
      });
      continue;
    }

    if (!Number.isFinite(next) && sinceLast >= quietAfterDays) {
      out.push({
        contact: c,
        bucket: 'quiet',
        reason: Number.isFinite(last)
          ? `no contact in ${plural(sinceLast, 'day')}, nothing planned`
          : 'never contacted, nothing planned',
        days: Number.isFinite(sinceLast) ? sinceLast : 9999,
      });
    }
  }

  // Most overdue first within each bucket; buckets in order of urgency.
  const rank: Record<RelBucket, number> = { overdue: 0, soon: 1, quiet: 2 };
  return out.sort(
    (a, b) => rank[a.bucket] - rank[b.bucket]
      || b.days - a.days
      || displayName(a.contact).localeCompare(displayName(b.contact)),
  );
}

export const BUCKET_LABEL: Record<RelBucket, string> = {
  overdue: 'Owed a reply',
  soon: 'Coming up this week',
  quiet: 'Gone quiet',
};
