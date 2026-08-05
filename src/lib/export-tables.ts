// What a workspace export contains — PURE.
//
// ── WHY THIS IS A DENY-LIST, NOT AN ALLOW-LIST ──────────────────────────────
// The export used to name 30 tables explicitly. 37 other tenant-scoped tables had
// appeared since and were silently missing — Personal Life, brand assets, competitor
// research, strategy genes, time-savings history. The manifest meanwhile promised
// "everything your workspace created", which was not true.
//
// An allow-list fails SILENTLY and in the wrong direction: the newest data is the most
// likely to be missing, and nobody notices until a client leaves and finds the gap.
// Inverting it means a new table is exported by default, and NOT exporting something
// becomes a deliberate, reviewable decision recorded here.
//
// The client's data is theirs. The only things withheld are platform plumbing and
// material that would be unsafe or meaningless to hand over.

/** Tables deliberately withheld, each with the reason shown in the manifest. */
export const EXPORT_EXCLUSIONS: Record<string, string> = {
  // Security material. Exporting key material is a risk, and these are useless outside
  // the platform anyway. Connected PROVIDER NAMES are exported separately.
  client_integrations: 'Holds encrypted third-party secrets. Your connected providers are listed in the manifest.',
  salesops_tokens: 'Access tokens.',
  mcp_servers: 'Contains connection credentials.',
  connections: 'Contains connection credentials.',

  // Platform plumbing, not the client's assets.
  security_events: 'Platform security monitoring.',
  audit_log: 'Platform audit trail.',
  error_events: 'Platform error monitoring.',
  agent_heartbeats: 'Internal liveness pings.',
  issues: 'Internal engineering issue tracker.',
  pending_approvals: 'Internal step-up approval queue.',
  generation_jobs: 'Transient job queue.',

  // Other people's personal data, or a record of KeyPlayers' side of the relationship.
  tenant_members: 'Account records for the people in your workspace.',
  service_profiles: "Your KeyPlayers service record, held by us.",
};

/**
 * Table names that must never be exported regardless of the list above, so a table
 * added later cannot leak credentials just because nobody updated this file.
 */
const UNSAFE_NAME = /(token|secret|credential|password|api_key)/i;

export function isExportable(table: string): boolean {
  if (Object.prototype.hasOwnProperty.call(EXPORT_EXCLUSIONS, table)) return false;
  if (UNSAFE_NAME.test(table)) return false;
  return true;
}

/** Why a table was withheld, for the manifest. */
export function exclusionReason(table: string): string {
  return EXPORT_EXCLUSIONS[table]
    ?? (UNSAFE_NAME.test(table) ? 'Withheld automatically: the name indicates credentials.' : 'Not exported.');
}
