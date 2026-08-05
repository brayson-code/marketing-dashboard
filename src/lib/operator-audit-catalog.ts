// Turning audit rows into sentences — PURE.
//
// Every operator action has been logged since the lifecycle work landed, and there was
// no way to read any of it without running SQL. "Who opened this workspace, and when"
// is the first question anyone asks when a client onboarding goes wrong, and it should
// not need an engineer.
//
// Actions are matched by PREFIX so a new `portal.*` or `workspace.*` action shows up
// with a sensible label the day it ships rather than being silently dropped.

export interface AuditRow {
  id: string;
  ts: string;
  actor: string | null;
  action: string;
  target: string | null;
  detail: Record<string, unknown> | null;
  /** Resolved from a `tenant:<uuid>` target, when the workspace still exists. */
  workspace: string | null;
}

/** Only the actions an operator took. Everything else is agent and system noise. */
export const OPERATOR_ACTION_PREFIXES = ['workspace.', 'portal.', 'operator.'] as const;

export function isOperatorAction(action: string): boolean {
  return OPERATOR_ACTION_PREFIXES.some(p => action.startsWith(p));
}

const LABELS: Record<string, string> = {
  'workspace.provision': 'Built a workspace',
  'workspace.activate': 'Opened a workspace',
  'workspace.pause': 'Paused access',
  'workspace.resume': 'Reopened access',
  'workspace.offboard': 'Offboarded',
  'workspace.prep_access': 'Gave the assistant early access',
  'portal.onboarding.capture': 'Saved the onboarding call',
  'portal.onboarding.extract': 'Read call notes into the form',
  'portal.profile.upsert': "Updated the assistant's details",
  'portal.announcement.create': 'Published an announcement',
  'portal.announcement.delete': 'Removed an announcement',
  'operator.add': 'Added an operator',
  'operator.remove': 'Removed an operator',
  'operator.provision_login': 'Created an operator login',
};

export function actionLabel(action: string): string {
  if (LABELS[action]) return LABELS[action];
  // Unknown but in-family: make something readable rather than showing a dotted slug.
  const tail = action.split('.').slice(1).join(' ').replace(/_/g, ' ');
  return tail ? tail.charAt(0).toUpperCase() + tail.slice(1) : action;
}

/**
 * The one line that says what actually happened, including the outcome.
 *
 * A lifecycle row that says "Opened a workspace" but omits that nobody could be granted
 * access would be worse than no log at all, so failures are stated first.
 */
export function describe(row: AuditRow): string {
  const d = row.detail ?? {};

  if (d.ok === false) {
    const why = typeof d.error === 'string' && d.error ? d.error : 'it did not go through';
    return `Tried to ${actionLabel(row.action).toLowerCase()} — ${why}`;
  }

  const parts: string[] = [actionLabel(row.action)];

  const granted = Array.isArray(d.granted) ? (d.granted as string[]) : [];
  if (granted.length) {
    parts.push(`gave access to ${granted.map(g => g.replace(/^(owner|va):/, '')).join(', ')}`);
  }
  const failed = Array.isArray(d.failed) ? (d.failed as string[]) : [];
  if (failed.length) parts.push(`could not add ${failed.join('; ')}`);

  if (typeof d.revoked === 'number' && d.revoked > 0) {
    parts.push(`removed ${d.revoked} ${d.revoked === 1 ? 'login' : 'logins'}`);
  }
  if (typeof d.filled === 'number' && typeof d.total === 'number') {
    parts.push(`${d.filled} of ${d.total} answers`);
  }
  if (typeof d.found === 'number') parts.push(`found ${d.found} fields`);
  if (typeof d.name === 'string' && d.name) parts.push(`“${d.name}”`);
  if (typeof d.title === 'string' && d.title) parts.push(`“${d.title}”`);
  if (typeof d.email === 'string' && d.email) parts.push(d.email);

  return parts.join(' · ');
}
