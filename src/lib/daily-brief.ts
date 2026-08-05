// What needs doing today — PURE.
//
// The Overview is a customisable widget board. It shows what EXISTS; it does not answer
// the question either person actually opens the app with. For the founder that question
// is "what needs me". For the assistant it is "what does my founder need from me today"
// — and the assistant is the North Star's primary user, with no daily surface of their
// own until now.
//
// Same underlying facts, two different readings, because the two people can act on
// different things. Only a founder can approve; only an assistant is going to chase a
// birthday present three weeks out.
//
// Everything here comes from data that already exists — approvals, contact decay, the
// personal "act by" dates. Nothing new is stored to make this work.

import { relationshipQueue, type RelContact } from './relationships';
import { actByDate, type PersonalItem } from './personal';

export type BriefViewer = 'client' | 'va';

export interface BriefItem {
  key: string;
  /** now = today or already late · soon = this week · fyi = worth knowing. */
  urgency: 'now' | 'soon' | 'fyi';
  text: string;
  href: string;
}

export interface BriefFacts {
  /** Drafts and sequences sitting in the approval queue. */
  approvals: number;
  contacts: ReadonlyArray<RelContact>;
  personal: ReadonlyArray<PersonalItem>;
  /** How the founder wants to be addressed, when known. */
  founderName: string | null;
  now: number;
}

const DAY = 86_400_000;

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Build the brief, most urgent first.
 *
 * Returns an EMPTY array when there is genuinely nothing, and the caller renders
 * nothing at all. A panel that always says something trains people to stop reading it.
 */
export function dailyBrief(viewer: BriefViewer, f: BriefFacts): BriefItem[] {
  const items: BriefItem[] = [];
  const isVa = viewer === 'va';
  const who = f.founderName?.trim();

  // ── Approvals ─────────────────────────────────────────────────────────────
  // Only the founder can actually approve. For them it is an action; for the
  // assistant it is a nudge — the work is done and is waiting on someone else.
  if (f.approvals > 0) {
    items.push({
      key: 'approvals',
      urgency: 'now',
      text: isVa
        ? `${plural(f.approvals, 'thing is', 'things are')} waiting on ${who ?? 'your founder'} to approve`
        : `${plural(f.approvals, 'thing needs', 'things need')} your approval`,
      href: '/drafts',
    });
  }

  // ── Relationships ─────────────────────────────────────────────────────────
  const queue = relationshipQueue(f.contacts, f.now);
  const overdue = queue.filter(q => q.bucket === 'overdue');
  const quiet = queue.filter(q => q.bucket === 'quiet');

  if (overdue.length > 0) {
    items.push({
      key: 'overdue',
      urgency: 'now',
      text: isVa
        ? `${plural(overdue.length, 'person is', 'people are')} owed a reply`
        : `${plural(overdue.length, 'follow-up is', 'follow-ups are')} overdue`,
      href: '/crm',
    });
  }
  // Decay is the assistant's job to notice. Surfacing it to a founder is just a list of
  // things they are already not doing.
  if (isVa && quiet.length > 0) {
    items.push({
      key: 'quiet',
      urgency: 'soon',
      text: `${plural(quiet.length, 'relationship has', 'relationships have')} gone quiet`,
      href: '/crm',
    });
  }

  // ── Personal life ─────────────────────────────────────────────────────────
  // Uses the ACT-BY date, not the due date — a birthday three weeks out is something to
  // start on now, and that lead time is the whole point of the field.
  for (const p of f.personal) {
    const by = actByDate(p);
    if (!by) continue;
    const days = Math.floor((by.getTime() - f.now) / DAY);
    if (days > 7) continue;

    items.push({
      key: `personal:${p.id}`,
      urgency: days <= 0 ? 'now' : 'soon',
      text: days < 0
        ? `${p.title} — should have been started ${plural(-days, 'day', 'days')} ago`
        : days === 0
          ? `${p.title} — start today`
          : `${p.title} — start within ${plural(days, 'day', 'days')}`,
      href: '/personal',
    });
  }

  const rank = { now: 0, soon: 1, fyi: 2 } as const;
  return items.sort((a, b) => rank[a.urgency] - rank[b.urgency]);
}

export function briefTitle(viewer: BriefViewer, founderName: string | null): string {
  if (viewer !== 'va') return 'What needs you';
  const who = founderName?.trim();
  return who ? `What ${who} needs today` : 'What your founder needs today';
}
