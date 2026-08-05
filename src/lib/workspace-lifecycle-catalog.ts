// Workspace lifecycle — PURE. States, legal transitions, and the copy for each.
// No db import, so client components can render the controls from the same source the
// server enforces (same catalog/server split as command-center-catalog and
// founder-profile-catalog).

export type WorkspaceStatus = 'provisioned' | 'active' | 'paused' | 'offboarded';

export const STATUS_ORDER: WorkspaceStatus[] = ['provisioned', 'active', 'paused', 'offboarded'];

export const STATUS_LABEL: Record<WorkspaceStatus, string> = {
  provisioned: 'Built, not open',
  active: 'Open',
  paused: 'Paused',
  offboarded: 'Offboarded',
};

export const STATUS_BLURB: Record<WorkspaceStatus, string> = {
  provisioned: 'Set up on the onboarding call. Nobody can sign in yet.',
  active: 'The client and their assistant can sign in and work.',
  paused: 'Access revoked, everything kept. Can be reopened.',
  offboarded: 'Access revoked for good. Data stays for export.',
};

export type LifecycleAction = 'activate' | 'pause' | 'resume' | 'offboard';

export const ACTION_LABEL: Record<LifecycleAction, string> = {
  activate: 'Open for day one',
  pause: 'Pause access',
  resume: 'Reopen',
  offboard: 'Offboard',
};

/**
 * What each action does in plain words. These are shown on the confirm step, because
 * every one of them changes whether a real client can get into their workspace and the
 * operator should read the consequence before the button, not after.
 */
export const ACTION_CONSEQUENCE: Record<LifecycleAction, string> = {
  activate: 'Creates their logins and emails a sign-in link. They will be able to get in immediately.',
  pause: 'Signs them out and blocks sign-in. Nothing is deleted, and reopening restores access.',
  resume: 'Restores sign-in for everyone who had access before.',
  offboard: 'Removes access for good. The workspace and its data stay so it can be exported.',
};

/** Legal transitions. Anything not listed here is refused server-side. */
const TRANSITIONS: Record<WorkspaceStatus, Partial<Record<LifecycleAction, WorkspaceStatus>>> = {
  // A workspace built on the onboarding call opens on day one, or is cancelled if the
  // deal falls over before it starts.
  provisioned: { activate: 'active', offboard: 'offboarded' },
  active: { pause: 'paused', offboard: 'offboarded' },
  // Reopening a paused workspace goes back to active rather than re-running activation:
  // the logins already exist, so nobody needs a second sign-in link.
  paused: { resume: 'active', offboard: 'offboarded' },
  // Terminal. Reinstating an offboarded client is a new provisioning, deliberately —
  // it forces a conscious decision rather than a quiet un-delete.
  offboarded: {},
};

export function nextStatus(from: WorkspaceStatus, action: LifecycleAction): WorkspaceStatus | null {
  return TRANSITIONS[from]?.[action] ?? null;
}

export function allowedActions(from: WorkspaceStatus): LifecycleAction[] {
  return Object.keys(TRANSITIONS[from] ?? {}) as LifecycleAction[];
}

export function isWorkspaceStatus(v: unknown): v is WorkspaceStatus {
  return typeof v === 'string' && (STATUS_ORDER as string[]).includes(v);
}

/** True when people can sign in. The one question every other surface asks. */
export function isOpen(status: WorkspaceStatus): boolean {
  return status === 'active';
}
