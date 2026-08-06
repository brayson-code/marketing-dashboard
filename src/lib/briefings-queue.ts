// The assistant's reading of Briefings — PURE.
//
// The page underneath is a document library: browse, search, promote. That is the right
// tool for someone looking for a specific thing, and the wrong one for the question an
// assistant actually has, which is "what did an agent write that nobody has read?"
//
// An unread agent report is the worst kind of waste: the work was done, the tokens were
// spent, and the finding is sitting where nobody will look. It also gets worse with
// age — a competitor note from six weeks ago may already be wrong.
//
// Same rows the library shows, different question. No new tables.

export interface QueueDoc {
  id: string;
  title: string | null;
  type: string | null;
  status: string | null;
  created_by: string | null;
  created_at: string;
}

export type QueueBucket = 'unread' | 'stale';

export interface QueueItem {
  doc: QueueDoc;
  bucket: QueueBucket;
  /** Plain-language reason, e.g. "written by an agent 9 days ago, still unread". */
  reason: string;
  days: number;
}

/** Past this, a raw draft has stopped being new and started being ignored. */
export const STALE_AFTER_DAYS = 14;

const DAY = 86_400_000;

/** Anything not created by a person. Agent-written drafts nobody requested. */
function byAgent(doc: QueueDoc): boolean {
  const who = String(doc.created_by ?? '').trim().toLowerCase();
  return who !== '' && who !== 'owner' && who !== 'user';
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function docTitle(d: QueueDoc): string {
  return (d.title ?? '').trim() || 'Untitled';
}

/**
 * Raw drafts worth someone's attention, most neglected first.
 *
 *   unread — an AGENT wrote this and nobody has promoted or archived it. Nobody asked
 *            for it, so nobody is looking for it.
 *   stale  — raw for longer than STALE_AFTER_DAYS, whoever wrote it.
 *
 * Anything already promoted to the wiki or archived is done and never appears.
 *
 * `now` is injected rather than read from the clock, so this is testable and gives the
 * same answer for the same inputs.
 */
export function briefingsQueue(
  docs: ReadonlyArray<QueueDoc>,
  now: number,
  staleAfterDays = STALE_AFTER_DAYS,
): QueueItem[] {
  const out: QueueItem[] = [];

  for (const doc of docs) {
    if (doc.status !== 'raw') continue;

    const created = Date.parse(doc.created_at);
    const days = Number.isFinite(created) ? Math.floor((now - created) / DAY) : 0;
    const agent = byAgent(doc);

    if (agent) {
      out.push({
        doc,
        bucket: 'unread',
        reason: days <= 0
          ? `written by ${doc.created_by} today, not read yet`
          : `written by ${doc.created_by} ${plural(days, 'day')} ago, still unread`,
        days,
      });
      continue;
    }

    if (days >= staleAfterDays) {
      out.push({
        doc,
        bucket: 'stale',
        reason: `sitting as a draft for ${plural(days, 'day')}`,
        days,
      });
    }
  }

  // Agent-written first — those are the ones nobody is looking for at all.
  const rank: Record<QueueBucket, number> = { unread: 0, stale: 1 };
  return out.sort(
    (a, b) => rank[a.bucket] - rank[b.bucket]
      || b.days - a.days
      || docTitle(a.doc).localeCompare(docTitle(b.doc)),
  );
}

export const BUCKET_LABEL: Record<QueueBucket, string> = {
  unread: 'Written by an agent, unread',
  stale: 'Drafts going stale',
};
