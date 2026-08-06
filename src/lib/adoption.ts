// Is any of this actually being used? — PURE.
//
// Everything else in Portal Admin is per-workspace. Nothing answered the question across
// the whole book of business, which is how fourteen workspaces ended up live with
// nothing in them and nobody noticing for months. Every individual tool worked; nothing
// was counting.
//
// Deliberately separates SET UP from USED. A workspace can be perfectly configured and
// abandoned, and it can be busy while half-configured. Collapsing those into one
// "health" score would hide both.

import { readiness, type WorkspaceFacts } from './readiness';

export interface AdoptionInput extends WorkspaceFacts {
  name: string;
  lastActivityAt: string | null;
}

export interface Adoption {
  total: number;
  /** Everything that makes day one good is in place. */
  ready: number;
  /** Open to the client. */
  open: number;
  captured: number;
  withAssistant: number;
  /** Someone did something in the last 7 days. */
  activeThisWeek: number;
  /** Nothing has EVER happened in here. */
  neverUsed: number;
  /** Open to a client AND not ready — the ones costing something right now. */
  liveButUnfinished: string[];
  /** Open, ready, and silent for a fortnight. Set up and then abandoned. */
  goneQuiet: string[];
}

const DAY = 86_400_000;

export function adoption(rows: ReadonlyArray<AdoptionInput>, now: number): Adoption {
  let ready = 0, open = 0, captured = 0, withAssistant = 0, activeThisWeek = 0, neverUsed = 0;
  const liveButUnfinished: string[] = [];
  const goneQuiet: string[] = [];

  for (const w of rows) {
    const r = readiness(w);
    const isOpen = w.status === 'active';
    const last = w.lastActivityAt ? Date.parse(w.lastActivityAt) : NaN;
    const active7 = Number.isFinite(last) && now - last <= 7 * DAY;

    if (r.ready) ready++;
    if (isOpen) open++;
    if (w.capturedAt) captured++;
    if (w.hasAssistantName) withAssistant++;
    if (active7) activeThisWeek++;
    if (!Number.isFinite(last)) neverUsed++;

    // A client is already in here and it is not finished. Worst state on the list.
    if (isOpen && !r.ready) liveButUnfinished.push(w.name);
    // Set up properly and then abandoned — invisible without this, because every
    // per-workspace check says it is fine.
    if (isOpen && r.ready && Number.isFinite(last) && now - last > 14 * DAY) {
      goneQuiet.push(w.name);
    }
  }

  return {
    total: rows.length,
    ready, open, captured, withAssistant, activeThisWeek, neverUsed,
    liveButUnfinished, goneQuiet,
  };
}

/**
 * The single sentence worth reading.
 *
 * Names the worst true thing rather than a percentage: "9 of 14 are open with setup
 * unfinished" is actionable, "64% health" is not.
 */
export function adoptionHeadline(a: Adoption): string {
  if (a.total === 0) return 'No workspaces yet.';
  if (a.liveButUnfinished.length > 0) {
    return `${a.liveButUnfinished.length} of ${a.total} are open to a client with setup unfinished.`;
  }
  if (a.neverUsed > 0) {
    return `${a.neverUsed} of ${a.total} have never been used.`;
  }
  if (a.goneQuiet.length > 0) {
    return `${a.goneQuiet.length} set up properly and then went quiet.`;
  }
  return `All ${a.total} are set up, and ${a.activeThisWeek} were used this week.`;
}
