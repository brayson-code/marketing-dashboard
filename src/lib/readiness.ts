// Is this workspace actually ready for day one? — PURE.
//
// Client Success runs four separate tools to set a client up: build the workspace,
// capture the call, fill in the assistant's details, open it. Nothing tied those
// together, so "did anyone do step two for Teresa?" was a question you could only answer
// by opening three screens and remembering what good looked like.
//
// This is that memory, written down. It is also why the emptiness in production went
// unnoticed for so long: every individual tool worked, and nothing was counting.

import type { WorkspaceStatus } from './workspace-lifecycle-catalog';

export interface WorkspaceFacts {
  status: WorkspaceStatus;
  /** When the onboarding call was captured, if it ever was. */
  capturedAt: string | null;
  essentialsFilled: number;
  essentialsTotal: number;
  hasAssistantName: boolean;
  hasStartDate: boolean;
  /** People who can sign in. */
  members: number;
  hasAssistantLogin: boolean;
  goLiveOn: string | null;
}

export interface ReadinessStep {
  key: 'captured' | 'assistant' | 'logins' | 'open';
  label: string;
  done: boolean;
  /** What is actually missing, in words. Null when done. */
  detail: string | null;
  /**
   * True when this must be right BEFORE the client is let in. A workspace can be opened
   * without it, but the client's first five minutes will be poor — which is exactly how
   * fourteen workspaces ended up live with nothing in them.
   */
  blocksGoodDayOne: boolean;
}

export interface Readiness {
  steps: ReadinessStep[];
  done: number;
  total: number;
  /** Everything that makes day one good is in place. */
  ready: boolean;
  /** The one thing to do next, or null when there is nothing. */
  nextAction: string | null;
}

export function readiness(f: WorkspaceFacts): Readiness {
  const capturedOk = !!f.capturedAt && f.essentialsFilled >= f.essentialsTotal;
  const partialCapture = !!f.capturedAt && f.essentialsFilled < f.essentialsTotal;

  const steps: ReadinessStep[] = [
    {
      key: 'captured',
      label: 'Onboarding call captured',
      done: capturedOk,
      detail: capturedOk
        ? null
        : partialCapture
          ? `${f.essentialsTotal - f.essentialsFilled} of ${f.essentialsTotal} essentials still blank`
          : 'Nothing captured yet',
      // Without this every agent guesses, and the client opens a blank form on day one.
      blocksGoodDayOne: true,
    },
    {
      key: 'assistant',
      label: "Assistant's details",
      done: f.hasAssistantName && f.hasStartDate,
      detail: f.hasAssistantName && f.hasStartDate
        ? null
        : !f.hasAssistantName && !f.hasStartDate
          ? 'No name or start date'
          : !f.hasAssistantName ? 'No name yet' : 'No start date, so leave cannot be calculated',
      blocksGoodDayOne: true,
    },
    {
      key: 'logins',
      label: 'Logins created',
      done: f.members > 0,
      detail: f.members > 0
        ? (f.hasAssistantLogin ? null : 'Client only, no assistant login')
        : 'Nobody can sign in',
      // Not "good day one" — it IS day one. Opening the workspace creates these.
      blocksGoodDayOne: false,
    },
    {
      key: 'open',
      label: 'Open to the client',
      done: f.status === 'active',
      detail: f.status === 'active' ? null : `Currently ${f.status}`,
      blocksGoodDayOne: false,
    },
  ];

  const done = steps.filter(s => s.done).length;
  const ready = steps.filter(s => s.blocksGoodDayOne).every(s => s.done);

  // One next action, not a list. A list of four things nobody does is how this got here.
  const firstBlocking = steps.find(s => s.blocksGoodDayOne && !s.done);
  const firstAny = steps.find(s => !s.done);
  const next = firstBlocking ?? firstAny ?? null;

  return {
    steps,
    done,
    total: steps.length,
    ready,
    nextAction: next ? `${next.label}${next.detail ? ` — ${next.detail}` : ''}` : null,
  };
}

/**
 * Sort key for an operator's worklist: the workspaces that are LIVE and missing things
 * come first, because a client is already using those.
 */
export function urgency(f: WorkspaceFacts, r: Readiness): number {
  if (f.status === 'active' && !r.ready) return 0;   // live and unfinished — worst
  if (f.status === 'provisioned' && !r.ready) return 1; // due to open, unfinished
  if (!r.ready) return 2;
  return 3;
}
