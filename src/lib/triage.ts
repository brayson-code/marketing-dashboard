// Triage sweep — the batch counterpart to the per-item "is this still needed?"
// buttons. On a schedule it re-validates a BOUNDED number of open drafts and open
// issues (oldest-untriaged first), writing a verdict onto each. It NEVER dismisses,
// approves, or executes anything on its own: stale items are merely *flagged* (via
// their verdict) so the owner can dismiss/keep them with one explicit click.
//
// Bounded by design: each item costs 1-3 Claude calls, so a sweep handles a few
// items and the hourly cadence churns through the backlog over time — the same
// "one wave per invocation" discipline used by the campaign engine.

import { listDraftsForTriage, type DraftRow } from './drafts';
import { revalidateDraft } from './revalidate-draft';
import { listIssuesForTriage } from './observability';
import { revalidateIssue } from './revalidate';

export interface TriageItemResult {
  kind: 'draft' | 'issue';
  id: string;
  title: string;
  ok: boolean;
  flagged: boolean; // verdict says stale / no longer needed / no longer present
  verdict?: string; // short label
  error?: string;
}

export interface TriageSweepResult {
  ran: number;
  flagged: number;
  items: TriageItemResult[];
  error?: string;
}

export interface TriageBudget {
  drafts?: number; // default 3
  issues?: number; // default 2
}

function draftIsStale(v: { still_needed: string; superseded: boolean }): boolean {
  return v.still_needed === 'no' || v.superseded === true;
}

function issueIsStale(v: { still_present: string }): boolean {
  return v.still_present === 'no';
}

export async function runTriageSweep(budget: TriageBudget = {}): Promise<TriageSweepResult> {
  const draftBudget = budget.drafts ?? 3;
  const issueBudget = budget.issues ?? 2;
  const items: TriageItemResult[] = [];

  try {
    const [drafts, issues] = await Promise.all([
      draftBudget > 0 ? listDraftsForTriage(draftBudget) : Promise.resolve([] as DraftRow[]),
      issueBudget > 0 ? listIssuesForTriage(issueBudget) : Promise.resolve([]),
    ]);

    // Sequential per kind to stay under the API rate limit (each call may fan into
    // a few model turns). Drafts first, then issues.
    for (const d of drafts) {
      const r = await revalidateDraft(d.id);
      if (!r.ok || !r.verdict) {
        items.push({ kind: 'draft', id: String(d.id), title: d.title, ok: false, flagged: false, error: r.error });
        continue;
      }
      const stale = draftIsStale(r.verdict);
      items.push({
        kind: 'draft', id: String(d.id), title: d.title, ok: true, flagged: stale,
        verdict: r.verdict.superseded ? 'superseded' : `still_needed=${r.verdict.still_needed}`,
      });
    }

    for (const iss of issues) {
      const r = await revalidateIssue(iss.id);
      if (!r.ok || !r.verdict) {
        items.push({ kind: 'issue', id: iss.id, title: iss.title, ok: false, flagged: false, error: r.error });
        continue;
      }
      const stale = issueIsStale(r.verdict);
      items.push({
        kind: 'issue', id: iss.id, title: iss.title, ok: true, flagged: stale,
        verdict: `still_present=${r.verdict.still_present}`,
      });
    }

    const ran = items.filter((i) => i.ok).length;
    const flagged = items.filter((i) => i.flagged).length;
    return { ran, flagged, items };
  } catch (err) {
    return { ran: items.filter((i) => i.ok).length, flagged: items.filter((i) => i.flagged).length, items, error: (err as Error).message };
  }
}
